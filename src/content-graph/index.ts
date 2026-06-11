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
 * The `<wpd-*>` web components are defined by the main desktop
 * bundle; this module only consumes them.
 *
 * @public
 * @since 0.8.2
 */

import { __, sprintf } from '../i18n';
import { fetchGraph, fetchPostDetail, fetchPostTypes, getConfig } from './rest';
import { renderToolbar, type ContentGraphView } from './toolbar';
import { renderPanel } from './panel';
import { GraphScene } from './scene';
import { GalaxyScene } from './galaxy-scene';
import type { SatelliteRef } from './satellites';
import type { DesktopApiLike } from './pixi-types';
import type {
	GalaxyTab,
	GraphNode,
	GraphPayload,
	GroupFacet,
} from './types';

// The framework's actual signature is wider (`() => void | (() => void) |
// Promise<…>`) but every feature bundle re-declares it as a narrow
// `() => void` and global declarations must agree, so keep this in
// lock-step. The async function below is still valid because TS lets
// you assign a `Promise<…>`-returning function to a `() => void` type
// — the framework reads the return value at runtime regardless.
type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		desktopModeNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

const WINDOW_ID = 'desktop-mode-content-graph';

interface ActiveState {
	abort: () => void;
}

interface ActiveScene {
	view: ContentGraphView;
	graph: GraphScene | null;
	galaxy: GalaxyScene | null;
}

async function renderContentGraph( body: HTMLElement ): Promise< ActiveState > {
	const root = body.querySelector< HTMLElement >(
		'[data-desktop-mode-content-graph-root]',
	);
	if ( ! root ) {
		body.textContent = __( 'Content Graph container missing.' );
		return { abort: () => {} };
	}
	const cfg = getConfig();

	const toolbarHost = root.querySelector< HTMLElement >(
		'[data-desktop-mode-content-graph-toolbar]',
	)!;
	const stageHost = root.querySelector< HTMLElement >(
		'[data-desktop-mode-content-graph-stage]',
	)!;
	const panelHost = root.querySelector< HTMLElement >(
		'[data-desktop-mode-content-graph-panel]',
	)!;
	const loading = root.querySelector< HTMLElement >(
		'[data-desktop-mode-content-graph-loading]',
	);

	const desktopApi = ( window.wp as { desktop?: DesktopApiLike } | undefined )
		?.desktop ?? {};

	let activeTypes: string[] = cfg.postTypes.map( ( t ) => t.slug );
	let detailRequestId = 0;
	let aborted = false;
	let currentPayload: GraphPayload | null = null;
	let currentGrouping: GroupFacet | null = null;

	const showLoading = ( show: boolean ): void => {
		if ( ! loading ) {
			return;
		}
		loading.hidden = ! show;
	};

	const panel = renderPanel( panelHost, cfg, {
		onClose: () => {
			panel.hide();
			activeScene.graph?.clearFocus();
			activeScene.galaxy?.clearFocus();
		},
		// Mirror the panel's visible view onto the satellite layer so
		// the bubble matching the dossier picks up its selected state
		// (and clears when the user navigates back to the post view).
		onViewChange: ( key ) => {
			activeScene.graph?.setSatelliteSelectedKey( key );
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
		activeScene.graph?.focusNode( node.id );
		activeScene.galaxy?.focusNode( node.id );
		panel.setLoading( node.id, node.title );
		const myId = ++detailRequestId;
		void ( async () => {
			try {
				const detail = await fetchPostDetail( cfg, node.id );
				if ( aborted || myId !== detailRequestId ) {
					return;
				}
				panel.setDetail( detail );
				activeScene.graph?.setFocusedDetail( detail );
				activeScene.galaxy?.setFocusedDetail( detail );
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

	const closeFocus = (): void => {
		// Bump the request id so any in-flight detail fetch's late
		// resolution doesn't re-open the panel after we close it.
		detailRequestId++;
		panel.hide();
		activeScene.graph?.clearFocus();
		activeScene.galaxy?.clearFocus();
	};

	const initialView: ContentGraphView =
		cfg.lastView === 'galaxy' ? 'galaxy' : 'graph';

	const activeScene: ActiveScene = {
		view: initialView,
		graph: null,
		galaxy: null,
	};

	const buildToolbarCallbacks = () => ( {
		onTypesChange: ( types: string[] ) => {
			activeTypes = types;
			void loadGraph();
		},
		onFitToView: () => {
			activeScene.graph?.fitToView();
			activeScene.galaxy?.fitToView();
		},
		onSearchSelect: ( node: GraphNode ) => focusNode( node ),
		onGroupChange: ( facet: GroupFacet | null ) => {
			// Session-local: no persistence. The selector resets to None
			// on every window open by virtue of the toolbar being
			// constructed fresh each render.
			currentGrouping = facet;
			activeScene.graph?.setGrouping( facet );
			activeScene.galaxy?.setGrouping( facet );
		},
		getNodes: () =>
			activeScene.graph?.getNodes() ??
			activeScene.galaxy?.getNodes() ??
			[],
		onViewChange: ( next: ContentGraphView ) => {
			void swapView( next );
		},
		onGalaxyTabChange: ( tab: GalaxyTab ) => {
			activeScene.galaxy?.setTab( tab );
		},
		onMinCommentsChange: ( min: number ) => {
			activeScene.galaxy?.setMinComments( min );
		},
		onZoomChange: ( zoom: number ) => {
			activeScene.galaxy?.setZoom( zoom );
		},
	} );

	let toolbar = renderToolbar(
		toolbarHost,
		cfg,
		cfg.postTypes,
		buildToolbarCallbacks(),
	);

	const swapView = async ( next: ContentGraphView ): Promise< void > => {
		if ( next === activeScene.view ) {
			return;
		}
		// Tear down the outgoing scene BEFORE constructing the incoming
		// one so the two Pixi Applications never coexist (the v8 batched
		// renderer's destroy race documented in `categories-mindmap.ts`
		// and `tags-cloud.ts`).
		if ( activeScene.graph ) {
			activeScene.graph.destroy();
			activeScene.graph = null;
		}
		if ( activeScene.galaxy ) {
			activeScene.galaxy.destroy();
			activeScene.galaxy = null;
		}
		stageHost.classList.remove( 'is-galaxy' );
		activeScene.view = next;
		try {
			await mountActiveScene();
		} catch ( err ) {
			stageHost.textContent = __( 'Could not initialise the graph renderer.' );
			// eslint-disable-next-line no-console
			console.warn( '[content-graph] scene swap failed', err );
			return;
		}
		// Restore data + grouping into the new scene. Read through
		// `getScene()` so TS doesn't carry the `null`-narrowing from
		// the inline assignments above through the await — the
		// freshly-mounted scene replaced one of the slots.
		if ( currentPayload ) {
			const fresh = getScene();
			fresh.graph?.setData( currentPayload );
			fresh.galaxy?.setData( currentPayload );
			if ( currentGrouping ) {
				fresh.graph?.setGrouping( currentGrouping );
				fresh.galaxy?.setGrouping( currentGrouping );
			}
			fresh.graph?.fitToView();
			fresh.galaxy?.fitToView();
		}
	};

	const getScene = (): ActiveScene => activeScene;

	const mountActiveScene = async (): Promise< void > => {
		if ( activeScene.view === 'galaxy' ) {
			const scene = new GalaxyScene( stageHost, {
				onNodeClick: ( node ) => {
					if ( activeScene.galaxy?.getFocusedId() === node.id ) {
						closeFocus();
						return;
					}
					focusNode( node );
				},
				onBackgroundClick: closeFocus,
				onVisibleCountChange: ( visible, total ) => {
					toolbar.setVisibleCount( visible, total );
				},
			} );
			await scene.mount( desktopApi );
			activeScene.galaxy = scene;
			return;
		}
		const scene = new GraphScene(
			stageHost,
			{
				onNodeClick: ( node ) => {
					// Click on the already-focused node = toggle off. Lets
					// the user dismiss the focus with the same gesture
					// they used to open it, instead of having to find the
					// panel's close button or click empty canvas.
					if ( activeScene.graph?.getFocusedId() === node.id ) {
						closeFocus();
						return;
					}
					focusNode( node );
				},
				onBackgroundClick: closeFocus,
			},
			handleSatelliteClick,
			cfg.postTypes,
		);
		await scene.mount( desktopApi );
		activeScene.graph = scene;
	};

	try {
		await mountActiveScene();
	} catch ( err ) {
		stageHost.textContent = __( 'Could not initialise the graph renderer.' );
		// eslint-disable-next-line no-console
		console.warn( '[content-graph] scene mount failed', err );
		return { abort: () => {} };
	}

	const loadGraph = async (): Promise< void > => {
		if ( aborted ) {
			return;
		}
		showLoading( true );
		toolbar.setStatus( __( 'Loading graph…' ) );
		try {
			const payload = await fetchGraph( cfg, activeTypes );
			if ( aborted ) {
				return;
			}
			currentPayload = payload;
			activeScene.graph?.setData( payload );
			activeScene.galaxy?.setData( payload );
			toolbar.setStatus(
				sprintf(
					/* translators: 1: number of nodes (posts/pages) in the graph. 2: number of links between them. */
					__( '%1$d nodes · %2$d links' ),
					payload.stats.nodes,
					payload.stats.edges,
				),
			);
			activeScene.graph?.fitToView();
			activeScene.galaxy?.fitToView();
			activeScene.graph?.clearFocus();
			activeScene.galaxy?.clearFocus();
			panel.hide();
			if ( currentGrouping ) {
				activeScene.graph?.setGrouping( currentGrouping );
				activeScene.galaxy?.setGrouping( currentGrouping );
			}
		} catch ( err ) {
			if ( aborted ) {
				return;
			}
			toolbar.setStatus( __( 'Failed to load graph.' ) );
			// eslint-disable-next-line no-console
			console.warn( '[content-graph] graph fetch failed', err );
		} finally {
			showLoading( false );
		}
	};

	// First-load: refresh post-type counts so chips reflect live state,
	// then load the graph itself.
	try {
		const refreshed = await fetchPostTypes( cfg );
		// Replace the live toolbar handle so subsequent setStatus calls
		// target the new DOM. Without this the original handle silently
		// writes to a removed element.
		toolbar.destroy();
		toolbar = renderToolbar(
			toolbarHost,
			cfg,
			refreshed,
			buildToolbarCallbacks(),
		);
	} catch {
		// Non-fatal — keep the chips that came from the window config.
	}

	await loadGraph();

	return {
		abort: () => {
			aborted = true;
			toolbar.destroy();
			panel.destroy();
			activeScene.graph?.destroy();
			activeScene.graph = null;
			activeScene.galaxy?.destroy();
			activeScene.galaxy = null;
		},
	};
}

const registry =
	( window.desktopModeNativeWindows ??
		( window.desktopModeNativeWindows = {} ) ) as Record<
		string,
		RenderCallback | undefined
	>;
// Return the render Promise so the framework keeps its W loading
// overlay up until the graph has actually fetched + painted. Without
// this `await` we used to see a "double loading" — the framework
// thought we were done the instant the registry callback returned,
// hid the overlay, and our own toolbar then briefly showed
// "Loading graph…" while the REST fetch finished. Bonus: forward the
// returned `abort` as the framework's teardown so close-time cleanup
// (Pixi destroy, panel destroy, toolbar destroy) actually fires.
registry[ WINDOW_ID ] = async ( body: HTMLElement ) => {
	const state = await renderContentGraph( body );
	return state.abort;
};
