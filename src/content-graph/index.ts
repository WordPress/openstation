/**
 * Content Graph — render entry point.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `desktop-mode-content-graph` window opens. Wires the toolbar +
 * Pixi scene + focused-status row; pulls `{ nodes, edges }` from the
 * `desktop-mode/v1/content-graph` REST routes. On node focus the host
 * fetches `/post/<id>` and pushes the detail to the scene, which fans
 * out per-relationship satellites that the user can click to deep-link
 * into authors, terms, comments, media, and revisions.
 *
 * Loading has two tiers. The window shell's own overlay covers the
 * cold part — bundle, Pixi, scene mount — and drops the moment the
 * window is interactive. Every graph fetch after that (the first one
 * included) runs behind the toolbar's "Loading graph…" status, and
 * the full-canvas overlay in the template only paints if the fetch
 * turns out to be long (`loading-overlay.ts`). When the fetch lands,
 * `board-notice.ts` decides whether the board needs to explain
 * itself: nothing to pin, everything filtered out, or cards with no
 * thread between them yet.
 *
 * The `<os-*>` web components this module consumes are defined by
 * the main desktop bundle; the one it constructs itself
 * (`<os-empty-state>`, in `board-notice.ts`) is side-effect-imported
 * there so the window does not depend on registration order.
 *
 * @public
 */

import { __, sprintf } from '../i18n';
import { registerWindowAction } from '../window-actions/registry';
import { deriveBoardNotice, renderBoardNotice } from './board-notice';
import { createLoadingOverlay } from './loading-overlay';
import { fetchGraph, fetchPostDetail, fetchPostTypes, getConfig } from './rest';
import { renderToolbar } from './toolbar';
import { renderPanel } from './panel';
import { GraphScene, type NodeStyle } from './scene';
import type { SatelliteRef } from './satellites';
import type { DesktopApiLike } from './pixi-types';
import type { GraphNode, GroupFacet, PostTypeDescriptor } from './types';

// The framework's actual signature is wider (`() => void | (() => void) |
// Promise<…>`) but every feature bundle re-declares it as a narrow
// `() => void` and global declarations must agree, so keep this in
// lock-step. The async function below is still valid because TS lets
// you assign a `Promise<…>`-returning function to a `() => void` type
// — the framework reads the return value at runtime regardless.
type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

const WINDOW_ID = 'desktop-mode-content-graph';

/**
 * Web-storage key for the node-body preference. Frozen `desktop-mode`
 * prefix — see AGENTS.md ("`desktop_mode_*` values are frozen").
 */
const NODE_STYLE_KEY = 'desktop-mode/corkboard-node-style';

/**
 * Every live Corkboard scene. The ⋯ menu row is registered once at
 * module load — not per render — because the row's identity is "the
 * Corkboard's node style", not "this particular mount's node style".
 * Registering per render would replace the entry (same id) on every
 * reopen and leave the toggle reaching for a scene that had already
 * been destroyed.
 */
const liveScenes = new Set< GraphScene >();

/** Session + across-session node-body preference. */
let nodeStyle: NodeStyle = readNodeStyle();

function readNodeStyle(): NodeStyle {
	try {
		return window.localStorage.getItem( NODE_STYLE_KEY ) === 'icon'
			? 'icon'
			: 'disc';
	} catch {
		// Private-mode / blocked storage — fall back to the default.
		return 'disc';
	}
}

function writeNodeStyle( style: NodeStyle ): void {
	try {
		window.localStorage.setItem( NODE_STYLE_KEY, style );
	} catch {
		// Non-fatal: the preference just doesn't survive the session.
	}
}

/**
 * "Show pins" in the Corkboard's ⋯ menu — the way back to the
 * dashicon-glyph nodes the window shipped with. Registered at module
 * load, which happens the first time the window opens (the bundle is
 * lazy-loaded by the native-window sync); the menu repaints its plugin
 * rows on every open, and while open on every registry change, so the
 * row lands in the menu of the window that just loaded this bundle.
 *
 * Registered once for the window kind rather than per mount: the
 * preference belongs to "the Corkboard", not to one instance of it.
 * Re-registering per render would replace the entry (same id) on every
 * reopen and leave `checked` closing over a scene already destroyed.
 */
registerWindowAction( {
	id: 'desktop-mode/corkboard-pins',
	label: __( 'Show pins' ),
	checkable: true,
	checked: () => nodeStyle === 'icon',
	isVisible: ( win ) =>
		( ( win.config as { baseId?: string } ).baseId ?? win.id ) ===
		WINDOW_ID,
	onSelect: () => {
		nodeStyle = nodeStyle === 'icon' ? 'disc' : 'icon';
		writeNodeStyle( nodeStyle );
		for ( const scene of liveScenes ) {
			scene.setNodeStyle( nodeStyle );
		}
	},
} );

interface ActiveState {
	abort: () => void;
}

async function renderContentGraph( body: HTMLElement ): Promise< ActiveState > {
	const root = body.querySelector< HTMLElement >(
		'[data-os-content-graph-root]',
	);
	if ( ! root ) {
		body.textContent = __( 'Corkboard container missing.' );
		return { abort: () => {} };
	}
	const cfg = getConfig();

	const toolbarHost = root.querySelector< HTMLElement >(
		'[data-os-content-graph-toolbar]',
	)!;
	const stageHost = root.querySelector< HTMLElement >(
		'[data-os-content-graph-stage]',
	)!;
	const panelHost = root.querySelector< HTMLElement >(
		'[data-os-content-graph-panel]',
	)!;
	const loading = root.querySelector< HTMLElement >(
		'[data-os-content-graph-loading]',
	);

	const desktopApi = ( window.wp as { os?: DesktopApiLike } | undefined )
		?.os ?? {};

	let activeTypes: string[] = cfg.postTypes.map( ( t ) => t.slug );
	// Descriptors with live counts once `/post-types` has answered;
	// until then the config's (count-less) list. The board notice
	// reads the counts to tell "the site is empty" from "the toolbar
	// hid everything".
	let postTypes: PostTypeDescriptor[] = cfg.postTypes;
	let scene: GraphScene | null = null;
	let detailRequestId = 0;
	let aborted = false;

	const loadingOverlay = createLoadingOverlay( loading );
	const notice = renderBoardNotice( stageHost );

	const panel = renderPanel( panelHost, cfg, {
		onClose: () => {
			panel.hide();
			scene?.clearFocus();
		},
		// Mirror the panel's visible view onto the satellite layer so
		// the bubble matching the dossier picks up its selected state
		// (and clears when the user navigates back to the post view).
		onViewChange: ( key ) => {
			scene?.setSatelliteSelectedKey( key );
		},
	} );

	// Satellite click → contextual panel view (NOT a navigation away).
	// The panel reuses the data already fetched for the post detail; no
	// extra REST round-trip per click.
	const handleSatelliteClick = ( ref: SatelliteRef ): void => {
		switch ( ref.kind ) {
			case 'user':
				panel.showUser( ref.userId );
				break;
			case 'term':
				panel.showTerm( ref.termId, ref.taxonomy );
				break;
			case 'comment':
				panel.showComment( ref.commentId );
				break;
			case 'media':
				panel.showMedia( ref.mediaId );
				break;
			case 'revision':
				panel.showRevision( ref.revisionId );
				break;
		}
	};

	const focusNode = ( node: GraphNode ): void => {
		scene?.focusNode( node.id );
		panel.setLoading( node.id, node.title );
		const myId = ++detailRequestId;
		void ( async () => {
			try {
				const detail = await fetchPostDetail( cfg, node.id );
				if ( aborted || myId !== detailRequestId ) {
					return;
				}
				panel.setDetail( detail );
				scene?.setFocusedDetail( detail );
			} catch ( err ) {
				if ( aborted || myId !== detailRequestId ) {
					return;
				}
				panel.setError(
					sprintf(
						/* translators: %d: numeric post id that failed to load. */
						__( 'Could not load post #%d.' ),
						node.id,
					),
				);
				// eslint-disable-next-line no-console
				console.warn( '[content-graph] detail fetch failed', err );
			}
		} )();
	};

	const buildToolbarCallbacks = () => ( {
		onTypesChange: ( types: string[] ) => {
			activeTypes = types;
			void loadGraph();
		},
		onFitToView: () => scene?.fitToView(),
		onSearchSelect: ( node: GraphNode ) => focusNode( node ),
		onGroupChange: ( facet: GroupFacet | null ) => {
			// Session-local: no persistence. The selector resets to None
			// on every window open by virtue of the toolbar being
			// constructed fresh each render.
			scene?.setGrouping( facet );
			// A clustered board has its own top-left labels; the
			// "No threads yet" note would sit on top of them.
			notice.setSuppressed( facet !== null );
		},
		getNodes: () => scene?.getNodes() ?? [],
	} );

	const toolbar = renderToolbar(
		toolbarHost,
		cfg.postTypes,
		buildToolbarCallbacks(),
	);

	const loadGraph = async (): Promise< void > => {
		if ( aborted ) {
			return;
		}
		loadingOverlay.show();
		toolbar.setStatus( __( 'Loading graph…' ) );
		try {
			const payload = await fetchGraph( cfg, activeTypes );
			if ( aborted ) {
				return;
			}
			scene?.setData( payload );
			toolbar.setStatus(
				sprintf(
					/* translators: 1: number of nodes (posts/pages) in the graph. 2: number of links between them. */
					__( '%1$d nodes · %2$d links' ),
					payload.stats.nodes,
					payload.stats.edges,
				),
			);
			notice.set(
				deriveBoardNotice( {
					nodes: payload.stats.nodes,
					edges: payload.stats.edges,
					types: postTypes,
					activeTypes,
				} ),
			);
			scene?.fitToView();
			scene?.clearFocus();
			panel.hide();
		} catch ( err ) {
			if ( aborted ) {
				return;
			}
			notice.set( { kind: 'none' } );
			toolbar.setStatus( __( 'Failed to load graph.' ) );
			// eslint-disable-next-line no-console
			console.warn( '[content-graph] graph fetch failed', err );
		} finally {
			loadingOverlay.hide();
		}
	};

	const closeFocus = (): void => {
		// Bump the request id so any in-flight detail fetch's late
		// resolution doesn't re-open the panel after we close it.
		detailRequestId++;
		panel.hide();
		scene?.clearFocus();
	};

	scene = new GraphScene(
		stageHost,
		{
			onNodeClick: ( node ) => {
				// Click on the already-focused node = toggle off. Lets
				// the user dismiss the focus with the same gesture
				// they used to open it, instead of having to find the
				// panel's close button or click empty canvas.
				if ( scene?.getFocusedId() === node.id ) {
					closeFocus();
					return;
				}
				focusNode( node );
			},
			onBackgroundClick: closeFocus,
		},
		handleSatelliteClick,
		cfg.postTypes,
		nodeStyle,
	);
	liveScenes.add( scene );

	try {
		await scene.mount( desktopApi );
	} catch ( err ) {
		stageHost.textContent = __( 'Could not initialise the graph renderer.' );
		// eslint-disable-next-line no-console
		console.warn( '[content-graph] scene mount failed', err );
		liveScenes.delete( scene );
		return { abort: () => {} };
	}

	// First load: refresh post-type counts so chips reflect live
	// state, then load the graph itself. Not awaited — the window is
	// interactive from here (toolbar painted, empty board under it),
	// and the fetch runs behind the toolbar status + the late-painting
	// stage overlay rather than behind the shell's full-window loader.
	void ( async () => {
		try {
			const refreshed = await fetchPostTypes( cfg );
			if ( aborted ) {
				return;
			}
			postTypes = refreshed;
			// In place, not a rebuild: the toolbar is already live and
			// the user may have toggled a chip or started typing while
			// `/post-types` was in flight. Both lists come from the
			// same `openstation_content_graph_post_types()`, so only
			// the counts differ.
			toolbar.updateCounts( refreshed );
		} catch {
			// Non-fatal — keep the chips that came from the window config.
		}
		await loadGraph();
	} )();

	return {
		abort: () => {
			aborted = true;
			loadingOverlay.destroy();
			notice.destroy();
			toolbar.destroy();
			panel.destroy();
			if ( scene ) {
				liveScenes.delete( scene );
				scene.destroy();
			}
			scene = null;
		},
	};
}

const registry =
	( window.openStationNativeWindows ??
		( window.openStationNativeWindows = {} ) ) as Record<
		string,
		RenderCallback | undefined
	>;
// Return the render Promise so the framework keeps its loading
// overlay up until the window is interactive: bundle loaded, Pixi
// initialised, toolbar painted. The graph fetch itself is deliberately
// NOT inside that promise — holding the full-window overlay through a
// fetch that usually takes a fraction of a second made every open
// look slow. The fetch runs behind the toolbar status, and the stage's
// own overlay paints only when the wait turns out to be long. Also
// forward the returned `abort` as the framework's teardown so
// close-time cleanup (Pixi destroy, panel destroy, toolbar destroy,
// in-flight fetch ignored) actually fires.
registry[ WINDOW_ID ] = async ( body: HTMLElement ) => {
	const state = await renderContentGraph( body );
	return state.abort;
};
