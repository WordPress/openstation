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
	let elevatedLayer: HTMLElement | null = null;
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

	/**
	 * Geometry for LINK drawing — like {@link rectOf}, but windows
	 * snapped into split view are treated as not drawable (`null`,
	 * the same signal minimized windows send). A half-screen tile
	 * has no free border to anchor on: its edges are flush with the
	 * desktop bounds and the split seam, so a spline either crosses
	 * the partner window or re-anchors on the screen edge — noise,
	 * not information. Snapped windows still participate as
	 * OBSTACLES (they occlude other windows' borders just fine).
	 */
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

		// The drawable ties — direction and mutual-merge already
		// resolved by the engine; here we only attach live geometry.
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
				// Only ties TOUCHING the focused window ride the
				// elevated layer — an edge between two unfocused
				// windows must never draw over a window that happens
				// to share a group with the focused one.
				elevated:
					focusedId !== null &&
					( edge.fromWindowId === focusedId ||
						edge.toWindowId === focusedId ),
			} );
		}

		// EVERY visible window is a potential occluder for the
		// visible-edge anchoring — group membership doesn't matter,
		// an unrelated window covering a member's border hides it
		// just the same.
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
		if ( layer && layer.isConnected && elevatedLayer?.isConnected ) {
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
		// A SIBLING (not a child): the base layer's own z-index makes
		// it a stacking context, so a child could never rise above the
		// windows no matter its z. The host lifts THIS layer to the
		// focused group's ceiling; the base layer never moves.
		elevatedLayer = document.createElement( 'div' );
		elevatedLayer.id = `${ LAYER_ID }-elevated`;
		elevatedLayer.className =
			'desktop-mode-window-links desktop-mode-window-links--elevated';
		elevatedLayer.setAttribute( 'aria-hidden', 'true' );
		// After the widget layer so DOM order mirrors the z-order
		// (widgets z 1 → links z 50 → windows z 100+).
		const widgets = document.getElementById( 'desktop-mode-widgets' );
		if ( widgets && widgets.parentElement === area ) {
			widgets.insertAdjacentElement( 'afterend', elevatedLayer );
			widgets.insertAdjacentElement( 'afterend', layer );
		} else {
			area.prepend( layer, elevatedLayer );
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

	/** The feature master switch (OS Settings → Features). */
	const isEnabled = (): boolean => snapshot.windowLinksEnabled !== false;

	const applyVisibility = (): void => {
		if ( ! layer ) {
			return;
		}
		const visible =
			isEnabled() &&
			( snapshot.windowLinkVisibility === 'always' ||
				( snapshot.windowLinkVisibility === 'focus' &&
					focusedNeighbors().size > 0 ) );
		layer.classList.toggle( VISIBLE_CLASS, visible );
		elevatedLayer?.classList.toggle( VISIBLE_CLASS, visible );
	};

	/**
	 * Surface the windows DIRECTLY tied to the focused one (silent
	 * restack — no focus events, minimized windows stay minimized).
	 * Direction-aware via the derived edges: focusing the ROOT pulls
	 * up every child (each child carries an edge to it); focusing a
	 * CHILD pulls up its parent and reference peers only — its
	 * siblings share a group but no edge, and yanking the whole
	 * cohort forward for a click on one comment buried the rest of
	 * the desktop.
	 */
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

	/**
	 * Ride the ELEVATED layer along with the raised group: while a
	 * group member is focused, that layer's z-index lifts to match the
	 * HIGHEST window of the group, so the focused window's own ties
	 * (the only ones renderers put there — `edge.elevated`) draw over
	 * every other window, while the top window itself still paints
	 * above them (equal z, later in the DOM). Edges anchor on window
	 * borders, so nothing crosses the top window's content — its
	 * endpoint dots sit right on its edge. The BASE layer never moves;
	 * ties between unfocused windows stay behind everything. Cleared
	 * back to the stylesheet default when focus leaves the group.
	 */
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

	// ------------------------------------------------------------------
	// The one recompute that reconciles everything
	// ------------------------------------------------------------------

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
	// window without going through the live-drag pipeline. The two
	// snap hooks matter for split view: a snap commit (edge drag or
	// split-overview partner pick) writes its geometry AFTER the drag
	// session ended, so without them the last drag frame would go
	// stale — and the just-snapped window's ties must disappear (see
	// `drawableRectOf`).
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

	// The user changed a window-links setting — renderer or visibility
	// in Effects, or the feature/behavior switches in Features.
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
