/**
 * Desktop Mode — Window-link render host.
 *
 * Owns *when and where* relation ties are drawn; the registered
 * renderer owns *how* (mirrors the unfocus-engine ↔ effect-def split).
 * Responsibilities:
 *
 *   - the link layer: a `pointer-events: none` element inside
 *     `#desktop-mode-area`, stacked between the widget layer (z 1)
 *     and the windows (z 100+), created lazily and only while at
 *     least one relation group is renderable (≥1 root + ≥1 child
 *     window open) — zero cost when the feature is unused;
 *   - resolving the ACTIVE renderer: OS Settings pick → the
 *     `desktop-mode.window-links.renderer` filter → registry lookup,
 *     falling back to the built-in `svg-splines` when the picked id
 *     vanished (plugin deactivated);
 *   - the visibility policy (`windowLinkVisibility` OS setting):
 *     `'focus'` fades the layer in while a group member is focused,
 *     `'always'` keeps it shown, `'off'` never mounts;
 *   - frame production: one rAF-coalesced pipeline collapsing
 *     per-frame drag geometry (`HOOKS.WINDOW_BOUNDS_CHANGED`),
 *     settled move/resize/state hooks, and group-membership changes
 *     into `onFrame` callbacks with fresh rects;
 *   - the related-window chrome highlight: while a group member is
 *     focused, its relatives carry `desktop-mode-window--linked`.
 *
 * @since 0.9.4
 */

import { addAction, applyFilters, doAction, HOOKS } from '../hooks';
import {
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

// The built-in renderer self-registers on import (same dogfooding as
// the built-in unfocus effects) — the host is its natural load point
// since the host is what falls back to it.
import './renderers/svg-splines';

/** Layer element id, mirrors `#desktop-mode-widgets` naming. */
const LAYER_ID = 'desktop-mode-window-links';

/** Class toggled on windows related to the focused group member. */
const LINKED_CLASS = 'desktop-mode-window--linked';

/** Class that fades the layer in under the `'focus'` policy. */
const VISIBLE_CLASS = 'desktop-mode-window-links--visible';

/**
 * Module-level once-guard — same rationale as the unfocus engine's:
 * the host wires hook-bus listeners that can't be cheaply deduped, and
 * it is only imported by the main shell bundle, so a plain flag is
 * enough (`vi.resetModules()` resets it between tests).
 */
let _started = false;

export interface WindowLinkRenderHostDeps {
	manager: WindowManager;
	osSettings: OsSettings;
}

/**
 * Wire the window-link render host. Idempotent per shell boot — call
 * once, after {@link startWindowLinksEngine}. Listeners live for the
 * page's lifetime, like every other shell engine.
 */
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
	let mountedId: string | null = null;
	let teardown: ( () => void ) | null = null;
	/** Guards async mounts racing an unmount / renderer swap. */
	let mountToken = 0;
	const frameSubscribers = new Set<( frame: WindowLinkFrame ) => void >();
	let framePending = false;
	const linkedWindows = new Set< string >();

	// ------------------------------------------------------------------
	// Frame production
	// ------------------------------------------------------------------

	/**
	 * Live geometry of a window, relative to `#desktop-mode-area`
	 * (which the layer and every window share as offset parent), or
	 * `null` when the window isn't visible on the active desktop.
	 */
	const rectOf = (
		win: DesktopWindow,
	): { x: number; y: number; width: number; height: number } | null => {
		const el = win.element;
		if (
			! el ||
			! el.isConnected ||
			win.state === 'minimized' ||
			// Hidden desktops / display-suppressed windows measure 0×0
			// and have no offsetParent — skip their edges entirely.
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
					rect: rectOf( win ),
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

		// The drawable ties — direction and mutual-merge already
		// resolved by the engine; here we only attach live geometry.
		const edges: WindowLinkFrame[ 'edges' ] = [];
		for ( const edge of listWindowLinkEdges() ) {
			const fromWin = manager.getById( edge.fromWindowId );
			const toWin = manager.getById( edge.toWindowId );
			if ( ! fromWin || ! toWin ) {
				continue;
			}
			edges.push( {
				fromWindowId: edge.fromWindowId,
				toWindowId: edge.toWindowId,
				kind: edge.kind,
				bidirectional: edge.bidirectional,
				focused: fromWin.isFocused() || toWin.isFocused(),
				from: rectOf( fromWin ),
				to: rectOf( toWin ),
			} );
		}

		return {
			groups,
			edges,
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
							'[desktop-mode] window-link frame subscriber threw:',
							err,
						);
					}
				}
			}
		} );
	};

	// ------------------------------------------------------------------
	// Layer + renderer lifecycle
	// ------------------------------------------------------------------

	const ensureLayer = (): HTMLElement | null => {
		if ( layer && layer.isConnected ) {
			return layer;
		}
		const area = document.getElementById( 'desktop-mode-area' );
		if ( ! area ) {
			return null;
		}
		layer = document.createElement( 'div' );
		layer.id = LAYER_ID;
		layer.className = 'desktop-mode-window-links';
		layer.setAttribute( 'aria-hidden', 'true' );
		// After the widget layer so DOM order mirrors the z-order
		// (widgets z 1 → links z 50 → windows z 100+).
		const widgets = document.getElementById( 'desktop-mode-widgets' );
		if ( widgets && widgets.parentElement === area ) {
			widgets.insertAdjacentElement( 'afterend', layer );
		} else {
			area.prepend( layer );
		}
		return layer;
	};

	/** Anything to draw — at least one derived edge between open windows? */
	const isRenderable = (): boolean => listWindowLinkEdges().length > 0;

	/**
	 * The renderer id that SHOULD be active right now: user pick →
	 * filter override → `none` sentinel or registry fallback.
	 */
	const resolveRendererId = (): string => {
		let id = snapshot.windowLinkRenderer || WINDOW_LINK_RENDERER_DEFAULT;
		id = applyFilters< string >( HOOKS.WINDOW_LINK_RENDERER, id );
		if ( id === WINDOW_LINK_RENDERER_NONE ) {
			return WINDOW_LINK_RENDERER_NONE;
		}
		if ( getWindowLinkRenderer( id ) ) {
			return id;
		}
		// The picked renderer isn't registered (plugin deactivated,
		// typo'd id) — fall back to the built-in rather than silently
		// drawing nothing.
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
		// Belt-and-braces: whatever the renderer left behind goes with
		// it, same safety net the wallpaper mount path uses.
		layer?.replaceChildren();
	};

	const mountRenderer = ( id: string ): void => {
		const def = getWindowLinkRenderer( id );
		const host = ensureLayer();
		if ( ! def || ! host ) {
			return;
		}
		mountedId = id;
		const token = ++mountToken;
		const ctx: WindowLinkRendererContext = {
			container: host,
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
							// A swap/unmount raced the async mount —
							// immediately undo the late arrival.
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

	// ------------------------------------------------------------------
	// Visibility + chrome highlight
	// ------------------------------------------------------------------

	/**
	 * Window ids tied to the focused window — its whole relation group
	 * (root + siblings) plus reference-edge endpoints.
	 */
	const focusedNeighbors = (): Set< string > => {
		const focused = manager.getFocused();
		if ( ! focused ) {
			return new Set();
		}
		return new Set( getRelatedWindowIds( focused.id ) );
	};

	const applyVisibility = (): void => {
		if ( ! layer ) {
			return;
		}
		const visible =
			snapshot.windowLinkVisibility === 'always' ||
			( snapshot.windowLinkVisibility === 'focus' &&
				focusedNeighbors().size > 0 );
		layer.classList.toggle( VISIBLE_CLASS, visible );
	};

	/**
	 * Surface the focused window's relation group: every tied window
	 * raises to just below the focused one (silent restack — no focus
	 * events, minimized windows stay minimized). "Click one window of
	 * a group, see the whole group."
	 */
	const raiseRelated = (): void => {
		if ( snapshot.windowLinkVisibility === 'off' ) {
			return;
		}
		for ( const id of focusedNeighbors() ) {
			const win = manager.getById( id );
			if ( win && win.state !== 'minimized' ) {
				manager.raise( id );
			}
		}
	};

	/**
	 * Ride the link layer along with the raised group: while a group
	 * member is focused, the layer's z-index lifts to match the LOWEST
	 * window of the group — above every unrelated window (which
	 * {@link raiseRelated} just pushed below the group), still under
	 * the group's own windows (equal z, but windows come later in the
	 * DOM, so they paint on top). Without this, an unrelated window
	 * sitting between two group members would cover their spline.
	 * Cleared back to the stylesheet default (behind all windows) when
	 * focus leaves the group.
	 */
	const applyLayerElevation = (): void => {
		if ( ! layer ) {
			return;
		}
		const focused = manager.getFocused();
		const related = focusedNeighbors();
		if (
			! focused ||
			related.size === 0 ||
			snapshot.windowLinkVisibility === 'off'
		) {
			layer.style.zIndex = '';
			return;
		}
		let minZ = Infinity;
		for ( const id of [ focused.id, ...related ] ) {
			const win = manager.getById( id );
			const el = win?.element;
			if ( ! el || win.state === 'minimized' ) {
				continue;
			}
			const z = Number.parseInt( el.style.zIndex || '', 10 );
			if ( Number.isFinite( z ) ) {
				minZ = Math.min( minZ, z );
			}
		}
		layer.style.zIndex = Number.isFinite( minZ ) ? String( minZ ) : '';
	};

	const applyLinkedHighlight = (): void => {
		const next =
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

	// ------------------------------------------------------------------
	// The one recompute that reconciles everything
	// ------------------------------------------------------------------

	const recompute = (): void => {
		const wantedId =
			snapshot.windowLinkVisibility !== 'off' && isRenderable()
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

	// ------------------------------------------------------------------
	// Subscriptions
	// ------------------------------------------------------------------

	// Per-frame drag/resize geometry — already rAF-coalesced by the
	// pointer module; our own emitFrame collapses it with everything
	// else that lands in the same frame.
	addAction(
		HOOKS.WINDOW_BOUNDS_CHANGED,
		'desktop-mode/window-links-frame',
		() => emitFrame(),
	);

	// Settled geometry / state transitions — anything that moves a
	// window without going through the live-drag pipeline.
	for ( const hook of [
		HOOKS.WINDOW_MOVED,
		HOOKS.WINDOW_RESIZED,
		HOOKS.WINDOW_MINIMIZED,
		HOOKS.WINDOW_RESTORED,
		HOOKS.WINDOW_MAXIMIZED,
		HOOKS.WINDOW_UNMAXIMIZED,
		HOOKS.WINDOW_FULLSCREEN_ENTERED,
		HOOKS.WINDOW_FULLSCREEN_EXITED,
		HOOKS.DESKTOP_SWITCHED,
		HOOKS.SHELL_RESIZED,
	] ) {
		addAction( hook, 'desktop-mode/window-links-frame', () =>
			emitFrame(),
		);
	}

	// Focus changes drive the `'focus'` visibility policy, the
	// related-window chrome highlight, the group raise, AND a frame
	// (edge emphasis — and edge targets follow focus recency when the
	// same content is open in several windows).
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

	// Membership changes: mount/unmount the layer, restructure edges.
	subscribeWindowLinks( recompute );

	// A renderer arriving (plugin activated live) or departing.
	subscribeWindowLinkRenderers( recompute );

	// The user picked a different renderer or visibility in OS Settings.
	osSettings.subscribeOsSettings( ( next ) => {
		const rendererChanged =
			next.windowLinkRenderer !== snapshot.windowLinkRenderer;
		const visibilityChanged =
			next.windowLinkVisibility !== snapshot.windowLinkVisibility;
		snapshot = next;
		if ( rendererChanged || visibilityChanged ) {
			if ( rendererChanged && mountedId ) {
				// Force the remount path even if the resolved id ends
				// up identical after filters — cheap, and keeps the
				// logic obvious.
				unmountRenderer();
			}
			recompute();
		}
	} );

	recompute();
}
