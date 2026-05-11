/**
 * Content Graph — render entry point.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `desktop-mode-content-graph` window opens. Wires the toolbar +
 * Pixi scene + side panel + REST. As of 0.9.0 it also hydrates per-
 * user preferences (lens choice, taxonomy, edge-toggle state, post-
 * type chips), wires the new lens segmented control + taxonomy
 * dropdown + edges multi-toggle, and persists changes via a
 * debounced `savePrefs()` mirror of `src/boot/session-saver.ts`.
 *
 * The `<wpd-*>` web components are defined by the main desktop
 * bundle; this module only consumes them.
 *
 * @public
 * @since 0.8.2
 * @since 0.9.0 Multi-lens orchestration + preferences persistence.
 */

import { __, sprintf } from '../i18n';
import {
	fetchGraph,
	fetchPostDetail,
	fetchPostTypes,
	getConfig,
	savePrefs,
} from './rest';
import { renderToolbar, type ToolbarHandle } from './toolbar';
import { renderPanel } from './panel';
import { GraphScene } from './scene';
import type { SatelliteRef } from './satellites';
import type { DesktopApiLike } from './pixi-types';
import type {
	ContentGraphConfig,
	ContentGraphPrefs,
	EdgeKind,
	GraphNode,
	LensId,
} from './types';

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

/**
 * Reasons `loadGraph()` may be called. The reason gates fit-to-view
 * and clear-focus side effects (lens-switch reloads must NOT snap the
 * camera or drop focus, per AE4).
 *
 * @since 0.9.0
 */
type LoadReason = 'initial' | 'lens-switch' | 'filter-change';

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

	// Mutable view state, hydrated from cfg.prefs and updated by toolbar
	// callbacks. The debounced saver pulls a fresh snapshot before
	// firing.
	let activeLens: LensId = cfg.prefs.lens;
	let activeTypes: string[] = currentLensState( cfg, activeLens ).types;
	let activeEdges: EdgeKind[] = currentLensState( cfg, activeLens ).edges;
	let activeTaxonomy: string = cfg.prefs.byLens.galaxy.taxonomy;
	// Cached payload key — when a lens switch wouldn't change the
	// (types, edges, taxonomy) tuple, we skip the network round-trip.
	let lastFetchKey = '';
	let scene: GraphScene | null = null;
	let detailRequestId = 0;
	let aborted = false;

	const showLoading = ( show: boolean ): void => {
		if ( ! loading ) {
			return;
		}
		loading.hidden = ! show;
	};

	const panel = renderPanel( panelHost, cfg, {
		onClose: () => {
			panel.hide();
			scene?.clearFocus();
		},
	} );

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

	// Trailing-edge debounced prefs saver, ~250ms wait. Mirrors the
	// session-saver pattern but lighter: prefs are not safety-critical,
	// so no `sendBeacon` flush on unload.
	let saveTimer: ReturnType< typeof setTimeout > | null = null;
	const schedulePrefsSave = (): void => {
		if ( saveTimer ) {
			clearTimeout( saveTimer );
		}
		saveTimer = setTimeout( () => {
			saveTimer = null;
			void savePrefs( cfg, snapshotPrefs() ).catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.warn( '[content-graph] savePrefs failed', err );
			} );
		}, 250 );
	};

	const snapshotPrefs = (): Partial< ContentGraphPrefs > => {
		// Build a partial patch reflecting current UI state so the
		// server merges and persists it.
		return {
			lens: activeLens,
			byLens: {
				constellation: {
					types:
						activeLens === 'constellation'
							? activeTypes
							: cfg.prefs.byLens.constellation.types,
					edges:
						activeLens === 'constellation'
							? activeEdges
							: cfg.prefs.byLens.constellation.edges,
				},
				galaxy: {
					types:
						activeLens === 'galaxy'
							? activeTypes
							: cfg.prefs.byLens.galaxy.types,
					edges:
						activeLens === 'galaxy'
							? activeEdges
							: cfg.prefs.byLens.galaxy.edges,
					taxonomy: activeTaxonomy,
				},
			},
		};
	};

	const fetchKey = (): string =>
		[
			activeTypes.slice().sort().join( ',' ),
			activeEdges.slice().sort().join( ',' ),
			activeLens === 'galaxy' ? activeTaxonomy : '',
		].join( '|' );

	const loadGraph = async ( reason: LoadReason ): Promise< void > => {
		if ( aborted ) {
			return;
		}
		const key = fetchKey();
		if ( reason === 'lens-switch' && key === lastFetchKey ) {
			// No network round-trip needed; lens swap is purely visual.
			return;
		}
		showLoading( true );
		toolbar.setStatus( __( 'Loading graph…' ) );
		try {
			const taxonomies =
				activeLens === 'galaxy' && activeTaxonomy
					? [ activeTaxonomy ]
					: [];
			const payload = await fetchGraph(
				cfg,
				activeTypes,
				activeEdges,
				taxonomies,
			);
			if ( aborted ) {
				return;
			}
			scene?.setData( payload );
			lastFetchKey = key;
			toolbar.setStatus(
				sprintf(
					/* translators: 1: number of nodes (posts/pages) in the graph. 2: number of links between them. */
					__( '%1$d nodes · %2$d links' ),
					payload.stats.nodes,
					payload.stats.edges,
				),
			);
			if ( reason !== 'lens-switch' ) {
				scene?.fitToView();
				scene?.clearFocus();
				panel.hide();
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

	const buildToolbarCallbacks = () => ( {
		onTypesChange: ( types: string[] ) => {
			activeTypes = types;
			void loadGraph( 'filter-change' );
			schedulePrefsSave();
		},
		onLensChange: ( lens: LensId ) => {
			activeLens = lens;
			const lensState = currentLensState( cfg, lens );
			activeTypes = lensState.types;
			activeEdges = lensState.edges;
			scene?.setLens( lens );
			scene?.setVisibleEdgeKinds( activeEdges );
			if ( lens === 'galaxy' ) {
				scene?.setClusterTaxonomy( activeTaxonomy );
			} else {
				scene?.setClusterTaxonomy( null );
			}
			toolbar.setActiveTypes( activeTypes );
			toolbar.setActiveEdges( activeEdges );
			void loadGraph( 'lens-switch' );
			schedulePrefsSave();
		},
		onTaxonomyChange: ( slug: string ) => {
			activeTaxonomy = slug;
			scene?.setClusterTaxonomy( slug );
			void loadGraph( 'filter-change' );
			schedulePrefsSave();
		},
		onEdgesChange: ( edges: EdgeKind[] ) => {
			activeEdges = edges;
			scene?.setVisibleEdgeKinds( edges );
			void loadGraph( 'filter-change' );
			schedulePrefsSave();
		},
		onFitToView: () => scene?.fitToView(),
		onSearchSelect: ( node: GraphNode ) => focusNode( node ),
		getNodes: () => scene?.getNodes() ?? [],
	} );

	let toolbar: ToolbarHandle = renderToolbar(
		toolbarHost,
		cfg.postTypes,
		cfg.taxonomies,
		cfg.edgeKinds,
		{
			lens: activeLens,
			types:
				activeTypes.length > 0
					? activeTypes
					: cfg.postTypes.map( ( t ) => t.slug ),
			taxonomy: activeTaxonomy,
			edges: activeEdges,
		},
		buildToolbarCallbacks(),
	);

	scene = new GraphScene(
		stageHost,
		{
			onNodeClick: ( node ) => focusNode( node ),
			onBackgroundClick: () => {
				panel.hide();
				scene?.clearFocus();
			},
		},
		handleSatelliteClick,
		cfg.postTypes,
	);

	try {
		await scene.mount( desktopApi );
	} catch ( err ) {
		stageHost.textContent = __( 'Could not initialise the graph renderer.' );
		// eslint-disable-next-line no-console
		console.warn( '[content-graph] scene mount failed', err );
		return { abort: () => {} };
	}

	// Wire the edge palette + initial lens state into the scene.
	scene.setEdgePalette( cfg.edgeKinds );
	scene.setLens( activeLens );
	scene.setVisibleEdgeKinds( activeEdges );
	if ( activeLens === 'galaxy' ) {
		scene.setClusterTaxonomy( activeTaxonomy );
	}

	// First-load: refresh post-type counts so chips reflect live state,
	// then load the graph itself.
	try {
		const refreshed = await fetchPostTypes( cfg );
		toolbar.destroy();
		toolbar = renderToolbar(
			toolbarHost,
			refreshed,
			cfg.taxonomies,
			cfg.edgeKinds,
			{
				lens: activeLens,
				types:
					activeTypes.length > 0
						? activeTypes
						: refreshed.map( ( t ) => t.slug ),
				taxonomy: activeTaxonomy,
				edges: activeEdges,
			},
			buildToolbarCallbacks(),
		);
	} catch {
		// Non-fatal — keep the chips that came from the window config.
	}

	if ( activeTypes.length === 0 ) {
		activeTypes = cfg.postTypes.map( ( t ) => t.slug );
	}
	await loadGraph( 'initial' );

	return {
		abort: () => {
			aborted = true;
			if ( saveTimer ) {
				clearTimeout( saveTimer );
				saveTimer = null;
			}
			toolbar.destroy();
			panel.destroy();
			scene?.destroy();
			scene = null;
		},
	};
}

/**
 * Pull the current lens's per-lens state out of the cfg.prefs blob.
 * Defaults `types` to "all available" when no preference is stored
 * yet (consistent with today's "show everything by default" UX).
 *
 * @since 0.9.0
 */
function currentLensState(
	cfg: ContentGraphConfig,
	lens: LensId,
): { types: string[]; edges: EdgeKind[] } {
	const lensPrefs =
		lens === 'galaxy'
			? cfg.prefs.byLens.galaxy
			: cfg.prefs.byLens.constellation;
	return {
		types:
			lensPrefs.types.length > 0
				? lensPrefs.types
				: cfg.postTypes.map( ( t ) => t.slug ),
		edges: lensPrefs.edges,
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
