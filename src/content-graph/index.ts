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
import { renderToolbar } from './toolbar';
import { renderPanel } from './panel';
import { GraphScene } from './scene';
import type { DesktopApiLike } from './pixi-types';
import type { GraphNode } from './types';

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		desktopModeNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

interface DesktopApiUrlOpener {
	windowManager?: {
		open: ( args: {
			id?: string;
			baseId?: string;
			url: string;
			title: string;
			icon?: string;
		} ) => unknown;
	};
	deriveWindowId?: ( url: string ) => string;
}

const WINDOW_ID = 'desktop-mode-content-graph';

interface ActiveState {
	abort: () => void;
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
	const desktopUrl = (
		( window.wp as { desktop?: DesktopApiUrlOpener } | undefined )?.desktop ??
		{}
	) as DesktopApiUrlOpener;

	const openUrl = ( args: {
		url: string;
		title: string;
		icon: string;
	} ): void => {
		// Same pattern as posts-window's openAdminUrl: derive a stable
		// id from the URL so satellite navigations don't open duplicate
		// chromeless windows.
		if ( ! desktopUrl.windowManager || ! desktopUrl.deriveWindowId ) {
			window.location.href = args.url;
			return;
		}
		const id = desktopUrl.deriveWindowId( args.url );
		desktopUrl.windowManager.open( {
			id,
			baseId: id,
			...args,
		} );
	};

	let activeTypes: string[] = cfg.postTypes.map( ( t ) => t.slug );
	let scene: GraphScene | null = null;
	let detailRequestId = 0;
	let aborted = false;

	const showLoading = ( show: boolean ): void => {
		if ( ! loading ) {
			return;
		}
		loading.hidden = ! show;
	};

	const panel = renderPanel( panelHost, {
		onClose: () => {
			panel.hide();
			scene?.clearFocus();
		},
	} );

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
		onReheat: () => {
			// Routed through scene.reheat() so it bumps alpha AND adds
			// the random velocity kick. The previous local-only
			// velocity injection was a no-op once the sim had cooled
			// (alpha=0 means `vx * alpha = 0` regardless of vx).
			scene?.reheat( 1 );
		},
		onSearchSelect: ( node: GraphNode ) => focusNode( node ),
		getNodes: () => scene?.getNodes() ?? [],
	} );

	let toolbar = renderToolbar(
		toolbarHost,
		cfg.postTypes,
		buildToolbarCallbacks(),
	);

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
			scene?.setData( payload );
			toolbar.setStatus(
				sprintf(
					/* translators: 1: number of nodes (posts/pages) in the graph. 2: number of links between them. */
					__( '%1$d nodes · %2$d links' ),
					payload.stats.nodes,
					payload.stats.edges,
				),
			);
			scene?.fitToView();
			scene?.clearFocus();
			panel.hide();
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

	scene = new GraphScene(
		stageHost,
		{
			onNodeClick: ( node ) => focusNode( node ),
			onBackgroundClick: () => {
				panel.hide();
				scene?.clearFocus();
			},
		},
		openUrl,
	);

	try {
		await scene.mount( desktopApi );
	} catch ( err ) {
		stageHost.textContent = __( 'Could not initialise the graph renderer.' );
		// eslint-disable-next-line no-console
		console.warn( '[content-graph] scene mount failed', err );
		return { abort: () => {} };
	}

	// First-load: refresh post-type counts so chips reflect live state,
	// then load the graph itself.
	try {
		const refreshed = await fetchPostTypes( cfg );
		// Replace the live toolbar handle so subsequent setStatus calls
		// target the new DOM. Without this the original handle silently
		// writes to a removed element.
		toolbar.destroy();
		toolbar = renderToolbar( toolbarHost, refreshed, buildToolbarCallbacks() );
	} catch {
		// Non-fatal — keep the chips that came from the window config.
	}

	await loadGraph();

	return {
		abort: () => {
			aborted = true;
			toolbar.destroy();
			panel.destroy();
			scene?.destroy();
			scene = null;
		},
	};
}

const registry =
	( window.desktopModeNativeWindows ??
		( window.desktopModeNativeWindows = {} ) ) as Record<
		string,
		RenderCallback | undefined
	>;
registry[ WINDOW_ID ] = ( body: HTMLElement ) => {
	void renderContentGraph( body );
};
