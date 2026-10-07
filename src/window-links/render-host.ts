import { addAction, applyFilters, doAction, HOOKS } from '../hooks';
import {
	getDirectlyRelatedWindowIds,
	getRelatedWindowIds,
	getWindowContent,
	listWindowLinkEdges,
	listWindowLinkGroups,
	subscribeWindowLinks,
} from './engine';
import {
	getWindowLinkRenderer,
	subscribeWindowLinkRenderers,
	WINDOW_LINK_RENDERER_DEFAULT,
	WINDOW_LINK_RENDERER_NONE,
} from './renderer-registry';
import type {
	WindowContentRef,
	WindowLinkFrame,
	WindowLinkRendererContext,
} from './types';
import type { OsSettings } from '../settings';
import type { WindowManager } from '../window-manager';
import type { Window as DesktopWindow } from '../window';

import './renderers/svg-splines';

const LAYER_ID = 'os-window-links';

const LINKED_CLASS = 'os-window--linked';

const VISIBLE_CLASS = 'os-window-links--visible';

let _started = false;

export interface WindowLinkRenderHostDeps {
	manager: WindowManager;
	osSettings: OsSettings;
}

export function startWindowLinkRenderHost( {
	manager,
	osSettings,
}: WindowLinkRenderHostDeps ): void {
	if ( _started ) {
		return;
	}
	_started = true;

	let snapshot = osSettings.getOsSettingsSnapshot();
	let layer: HTMLElement | null = null;
	let elevatedLayer: HTMLElement | null = null;
	let mountedId: string | null = null;
	let teardown: ( () => void ) | null = null;

	let mountToken = 0;
	const frameSubscribers = new Set<( frame: WindowLinkFrame ) => void >();
	let framePending = false;
	const linkedWindows = new Set< string >();

	let overviewActive = false;

	const rectOf = (
		win: DesktopWindow,
	): { x: number; y: number; width: number; height: number } | null => {
		const el = win.element;
		if (
			! el ||
			! el.isConnected ||
			win.state === 'minimized' ||

			el.offsetParent === null
		) {
			return null;
		}
		return {
			x: el.offsetLeft,
			y: el.offsetTop,
			width: el.offsetWidth,
			height: el.offsetHeight,
		};
	};

	const drawableRectOf = (
		win: DesktopWindow,
	): { x: number; y: number; width: number; height: number } | null => {
		if (
			win.state === 'snapped-left' ||
			win.state === 'snapped-right'
		) {
			return null;
		}
		return rectOf( win );
	};

	const buildFrame = (): WindowLinkFrame => {
		const groups: WindowLinkFrame[ 'groups' ] = [];
		for ( const group of listWindowLinkGroups() ) {
			if (
				group.rootWindowIds.length === 0 ||
				group.children.length === 0
			) {
				continue;
			}
			const members: WindowLinkFrame[ 'groups' ][ number ][ 'members' ] =
				[];
			const push = (
				windowId: string,
				role: 'root' | 'child',
				content: WindowContentRef | undefined,
			): void => {
				const win = manager.getById( windowId );
				if ( ! win || ! content ) {
					return;
				}
				members.push( {
					windowId,
					role,
					content,
					rect: drawableRectOf( win ),
					focused: win.isFocused(),
					state: win.state,
				} );
			};
			for ( const id of group.rootWindowIds ) {
				push( id, 'root', getWindowContent( id ) );
			}
			for ( const child of group.children ) {
				push( child.windowId, 'child', child.content );
			}
			if ( members.length > 0 ) {
				groups.push( { key: group.key, root: group.root, members } );
			}
		}

		const zOf = ( win: DesktopWindow ): number | null => {
			const z = Number.parseInt(
				win.element?.style.zIndex || '',
				10,
			);
			return Number.isFinite( z ) ? z : null;
		};
		const focusedId = manager.getFocused()?.id ?? null;
		const edges: WindowLinkFrame[ 'edges' ] = [];
		for ( const edge of listWindowLinkEdges() ) {
			const fromWin = manager.getById( edge.fromWindowId );
			const toWin = manager.getById( edge.toWindowId );
			if ( ! fromWin || ! toWin ) {
				continue;
			}
			const focused =
				fromWin.isFocused() || toWin.isFocused();
			edges.push( {
				fromWindowId: edge.fromWindowId,
				toWindowId: edge.toWindowId,
				kind: edge.kind,
				bidirectional: edge.bidirectional,
				focused,
				from: drawableRectOf( fromWin ),
				to: drawableRectOf( toWin ),
				fromZIndex: zOf( fromWin ),
				toZIndex: zOf( toWin ),

				elevated:
					focusedId !== null &&
					( edge.fromWindowId === focusedId ||
						edge.toWindowId === focusedId ),
			} );
		}

		const obstacles: WindowLinkFrame[ 'obstacles' ] = [];
		for ( const win of manager.getAll() ) {
			const rect = rectOf( win );
			if ( ! rect ) {
				continue;
			}
			obstacles.push( {
				windowId: win.id,
				rect,
				zIndex: zOf( win ) ?? 0,
			} );
		}

		return {
			groups,
			edges,
			obstacles,
			container: {
				width: layer?.offsetWidth ?? 0,
				height: layer?.offsetHeight ?? 0,
			},
		};
	};

	const emitFrame = (): void => {
		if ( framePending || frameSubscribers.size === 0 ) {
			return;
		}
		framePending = true;
		requestAnimationFrame( () => {
			framePending = false;
			if ( ! mountedId ) {
				return;
			}
			const frame = buildFrame();
			for ( const cb of Array.from( frameSubscribers ) ) {
				try {
					cb( frame );
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							'[openstation] window-link frame subscriber threw:',
							err,
						);
					}
				}
			}
		} );
	};

	const ensureLayer = (): HTMLElement | null => {
		if ( layer && layer.isConnected && elevatedLayer?.isConnected ) {
			return layer;
		}
		const area = document.getElementById( 'os-area' );
		if ( ! area ) {
			return null;
		}
		layer = document.createElement( 'div' );
		layer.id = LAYER_ID;
		layer.className = 'os-window-links';
		layer.setAttribute( 'aria-hidden', 'true' );

		elevatedLayer = document.createElement( 'div' );
		elevatedLayer.id = `${ LAYER_ID }-elevated`;
		elevatedLayer.className =
			'os-window-links os-window-links--elevated';
		elevatedLayer.setAttribute( 'aria-hidden', 'true' );

		const widgets = document.getElementById( 'os-widgets' );
		if ( widgets && widgets.parentElement === area ) {
			widgets.insertAdjacentElement( 'afterend', elevatedLayer );
			widgets.insertAdjacentElement( 'afterend', layer );
		} else {
			area.prepend( layer, elevatedLayer );
		}
		return layer;
	};

	const isRenderable = (): boolean => listWindowLinkEdges().length > 0;

	const resolveRendererId = (): string => {
		let id = snapshot.windowLinkRenderer || WINDOW_LINK_RENDERER_DEFAULT;
		id = applyFilters< string >( HOOKS.WINDOW_LINK_RENDERER, id );
		if ( id === WINDOW_LINK_RENDERER_NONE ) {
			return WINDOW_LINK_RENDERER_NONE;
		}
		if ( getWindowLinkRenderer( id ) ) {
			return id;
		}

		return getWindowLinkRenderer( WINDOW_LINK_RENDERER_DEFAULT )
			? WINDOW_LINK_RENDERER_DEFAULT
			: WINDOW_LINK_RENDERER_NONE;
	};

	const unmountRenderer = (): void => {
		mountToken++;
		frameSubscribers.clear();
		framePending = false;
		if ( teardown ) {
			try {
				teardown();
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'window-link-renderer-teardown',
					error: err,
				} );
			}
			teardown = null;
		}
		mountedId = null;

		layer?.replaceChildren();
		elevatedLayer?.replaceChildren();
	};

	const mountRenderer = ( id: string ): void => {
		const def = getWindowLinkRenderer( id );
		const host = ensureLayer();
		if ( ! def || ! host || ! elevatedLayer ) {
			return;
		}
		mountedId = id;
		const token = ++mountToken;
		const ctx: WindowLinkRendererContext = {
			container: host,
			elevatedContainer: elevatedLayer,
			getFrame: buildFrame,
			onFrame: ( cb ) => {
				frameSubscribers.add( cb );
				return () => {
					frameSubscribers.delete( cb );
				};
			},
		};
		try {
			const result = def.mount( ctx );
			if ( result instanceof Promise ) {
				result
					.then( ( cleanup ) => {
						if ( token !== mountToken ) {
							if ( typeof cleanup === 'function' ) {
								cleanup();
							}
							return;
						}
						if ( typeof cleanup === 'function' ) {
							teardown = cleanup;
						}
					} )
					.catch( ( err ) => {
						doAction( HOOKS.SHELL_ERROR, {
							scope: 'window-link-renderer-mount',
							error: err,
						} );
						if ( token === mountToken ) {
							mountedId = null;
						}
					} );
			} else if ( typeof result === 'function' ) {
				teardown = result;
			}
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-link-renderer-mount',
				error: err,
			} );
			mountedId = null;
		}
		emitFrame();
	};

	const focusedNeighbors = (): Set< string > => {
		const focused = manager.getFocused();
		if ( ! focused ) {
			return new Set();
		}
		return new Set( getRelatedWindowIds( focused.id ) );
	};

	const isEnabled = (): boolean => snapshot.windowLinksEnabled !== false;

	const applyVisibility = (): void => {
		if ( ! layer ) {
			return;
		}
		const visible =
			! overviewActive &&
			isEnabled() &&
			( snapshot.windowLinkVisibility === 'always' ||
				( snapshot.windowLinkVisibility === 'focus' &&
					focusedNeighbors().size > 0 ) );
		layer.classList.toggle( VISIBLE_CLASS, visible );
		elevatedLayer?.classList.toggle( VISIBLE_CLASS, visible );
	};

	const raiseRelated = (): void => {
		if (
			! isEnabled() ||
			snapshot.windowLinkRaiseOnFocus === false ||
			snapshot.windowLinkVisibility === 'off'
		) {
			return;
		}
		const focused = manager.getFocused();
		if ( ! focused ) {
			return;
		}
		for ( const id of getDirectlyRelatedWindowIds( focused.id ) ) {
			const win = manager.getById( id );
			if ( win && win.state !== 'minimized' ) {
				manager.raise( id );
			}
		}
	};

	const applyLayerElevation = (): void => {
		if ( ! elevatedLayer ) {
			return;
		}
		const focused = manager.getFocused();
		const related = focusedNeighbors();
		if (
			! focused ||
			related.size === 0 ||
			! isEnabled() ||
			snapshot.windowLinkVisibility === 'off'
		) {
			elevatedLayer.style.zIndex = '';
			return;
		}
		let maxZ = -Infinity;
		for ( const id of [ focused.id, ...related ] ) {
			const win = manager.getById( id );
			const el = win?.element;
			if ( ! el || win.state === 'minimized' ) {
				continue;
			}
			const z = Number.parseInt( el.style.zIndex || '', 10 );
			if ( Number.isFinite( z ) ) {
				maxZ = Math.max( maxZ, z );
			}
		}
		elevatedLayer.style.zIndex = Number.isFinite( maxZ )
			? String( maxZ )
			: '';
	};

	const applyLinkedHighlight = (): void => {
		const next =
			isEnabled() &&
			snapshot.windowLinkHighlight !== false &&
			snapshot.windowLinkVisibility !== 'off'
				? focusedNeighbors()
				: new Set< string >();
		for ( const id of linkedWindows ) {
			if ( ! next.has( id ) ) {
				manager
					.getById( id )
					?.element?.classList.remove( LINKED_CLASS );
			}
		}
		for ( const id of next ) {
			manager.getById( id )?.element?.classList.add( LINKED_CLASS );
		}
		linkedWindows.clear();
		for ( const id of next ) {
			linkedWindows.add( id );
		}
	};

	const recompute = (): void => {
		const wantedId =
			isEnabled() &&
			snapshot.windowLinkVisibility !== 'off' &&
			isRenderable()
				? resolveRendererId()
				: WINDOW_LINK_RENDERER_NONE;

		if ( wantedId === WINDOW_LINK_RENDERER_NONE ) {
			if ( mountedId ) {
				unmountRenderer();
			}
		} else if ( wantedId !== mountedId ) {
			unmountRenderer();
			mountRenderer( wantedId );
		}
		applyVisibility();
		applyLinkedHighlight();
		applyLayerElevation();
		emitFrame();
	};

	addAction(
		HOOKS.WINDOW_BOUNDS_CHANGED,
		'desktop-mode/window-links-frame',
		() => emitFrame(),
	);

	for ( const hook of [
		HOOKS.WINDOW_MOVED,
		HOOKS.WINDOW_RESIZED,
		HOOKS.WINDOW_MINIMIZED,
		HOOKS.WINDOW_RESTORED,
		HOOKS.WINDOW_MAXIMIZED,
		HOOKS.WINDOW_UNMAXIMIZED,
		HOOKS.WINDOW_FULLSCREEN_ENTERED,
		HOOKS.WINDOW_FULLSCREEN_EXITED,
		HOOKS.SNAP_ZONE_COMMITTED,
		HOOKS.SNAP_SPLIT_FILLED,
		HOOKS.DESKTOP_SWITCHED,
		HOOKS.SHELL_RESIZED,
	] ) {
		addAction( hook, 'desktop-mode/window-links-frame', () =>
			emitFrame(),
		);
	}

	addAction(
		HOOKS.WINDOW_FOCUSED,
		'desktop-mode/window-links-focus',
		() => {
			raiseRelated();
			applyVisibility();
			applyLinkedHighlight();
			applyLayerElevation();
			emitFrame();
		},
	);
	addAction(
		HOOKS.WINDOW_BLURRED,
		'desktop-mode/window-links-blur',
		() => {
			applyVisibility();
			applyLinkedHighlight();
			applyLayerElevation();
			emitFrame();
		},
	);

	addAction(
		HOOKS.OVERVIEW_ENTERING,
		'desktop-mode/window-links-overview',
		() => {
			overviewActive = true;
			applyVisibility();
		},
	);
	addAction(
		HOOKS.OVERVIEW_EXITED,
		'desktop-mode/window-links-overview',
		() => {
			overviewActive = false;
			applyVisibility();

			emitFrame();
		},
	);

	subscribeWindowLinks( recompute );

	subscribeWindowLinkRenderers( recompute );

	osSettings.subscribeOsSettings( ( next ) => {
		const rendererChanged =
			next.windowLinkRenderer !== snapshot.windowLinkRenderer;
		const anyChanged =
			rendererChanged ||
			next.windowLinkVisibility !== snapshot.windowLinkVisibility ||
			next.windowLinksEnabled !== snapshot.windowLinksEnabled ||
			next.windowLinkRaiseOnFocus !== snapshot.windowLinkRaiseOnFocus ||
			next.windowLinkHighlight !== snapshot.windowLinkHighlight;
		snapshot = next;
		if ( anyChanged ) {
			if ( rendererChanged && mountedId ) {
				unmountRenderer();
			}
			recompute();
		}
	} );

	recompute();
}
