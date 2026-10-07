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

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

const WINDOW_ID = 'desktop-mode-content-graph';

const NODE_STYLE_KEY = 'desktop-mode/corkboard-node-style';

const liveScenes = new Set< GraphScene >();

let nodeStyle: NodeStyle = readNodeStyle();

function readNodeStyle(): NodeStyle {
	try {
		return window.localStorage.getItem( NODE_STYLE_KEY ) === 'icon'
			? 'icon'
			: 'disc';
	} catch {
		return 'disc';
	}
}

function writeNodeStyle( style: NodeStyle ): void {
	try {
		window.localStorage.setItem( NODE_STYLE_KEY, style );
	} catch {

	}
}

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

		onViewChange: ( key ) => {
			scene?.setSatelliteSelectedKey( key );
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

						__( 'Could not load post #%d.' ),
						node.id,
					),
				);

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
			scene?.setGrouping( facet );

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

			console.warn( '[content-graph] graph fetch failed', err );
		} finally {
			loadingOverlay.hide();
		}
	};

	const closeFocus = (): void => {
		detailRequestId++;
		panel.hide();
		scene?.clearFocus();
	};

	scene = new GraphScene(
		stageHost,
		{
			onNodeClick: ( node ) => {
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

		console.warn( '[content-graph] scene mount failed', err );
		liveScenes.delete( scene );
		return { abort: () => {} };
	}

	void ( async () => {
		try {
			const refreshed = await fetchPostTypes( cfg );
			if ( aborted ) {
				return;
			}
			postTypes = refreshed;

			toolbar.updateCounts( refreshed );
		} catch {

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

registry[ WINDOW_ID ] = async ( body: HTMLElement ) => {
	const state = await renderContentGraph( body );
	return state.abort;
};
