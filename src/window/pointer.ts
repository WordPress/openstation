/**
 * Desktop Mode — Window drag + resize pointer handlers.
 *
 * Extracted from the class body because the two flows each own a
 * nested event loop (pointerdown opens a move/up/cancel triple) and
 * because together they carried ~200 lines of bookkeeping that dwarfed
 * the class's other methods.
 *
 * Each handler takes the `Window` instance and the originating
 * `PointerEvent`; the class's `bindEvents` routes its two listeners
 * through here.
 *
 * @since 0.8.1
 */

import { doAction, HOOKS } from '../hooks';
import { DRAG_THRESHOLD_SQUARED, EDGE_MARGIN, GRAB_MARGIN } from './constants';
import type { Window } from './index';

/**
 * Build a rAF-coalesced emitter for `WINDOW_BOUNDS_CHANGED` during a
 * drag or resize session.
 *
 * The emitter can be called at every `pointermove` but the actual
 * hook fire happens at most once per animation frame — matches the
 * cadence canvas wallpapers paint at, so a collision-aware wallpaper
 * can use the payload directly without re-reading DOM rects. Frames
 * where no move arrived are silent; frames with many coalesce into
 * one fire carrying the latest geometry.
 *
 * The phase flag (`drag` vs. `resize`) is baked in at construction
 * so subscribers can distinguish the two without inspecting window
 * state. On the trailing edge — the frame in which the user has
 * just released — the scheduled fire is suppressed: the
 * `WINDOW_DRAG_END` / `WINDOW_RESIZE_END` hooks already carry the
 * settled geometry, so firing bounds-changed there too would be a
 * duplicate with ambiguous ordering.
 */
function makeBoundsEmitter(
	win: Window,
	phase: 'drag' | 'resize',
): () => void {
	let pending = false;
	return () => {
		if ( pending ) {
			return;
		}
		pending = true;
		requestAnimationFrame( () => {
			pending = false;
			// Trailing-edge guard: if the session ended between
			// scheduling and the rAF callback firing, skip.
			if ( phase === 'drag' && ! win._isDragging ) {
				return;
			}
			if ( phase === 'resize' && ! win._isResizing ) {
				return;
			}
			// Extra guard: if the window has been destroyed or detached
			// between scheduling and firing (e.g. a close during drag),
			// skip rather than touch a dead node. Also silences a
			// test-only race where jsdom flushes a queued rAF after
			// the test has torn down the hooks stub.
			if ( win._isDestroyed || ! win.element.isConnected ) {
				return;
			}
			try {
				doAction( HOOKS.WINDOW_BOUNDS_CHANGED, {
					windowId: win.id,
					x: win.element.offsetLeft,
					y: win.element.offsetTop,
					width: win.element.offsetWidth,
					height: win.element.offsetHeight,
					state: win.state,
					phase,
				} );
			} catch {
				/* Pathological: the hook bus was removed mid-drag. No
				 * good recovery — swallow so one wayward plugin can't
				 * break pointer handling for the rest of the shell. */
			}
		} );
	};
}

/** Snapshot of everything needed to commit a max/snap un-state. */
interface UnstateParams {
	isMaximized: boolean;
	cursorRatioX: number;
	titleBarHeight: number;
	areaLeft: number;
	areaTop: number;
	targetW: number;
	targetH: number;
}

/** Title-bar pointerdown → drag session. */
export function handleDragStart( win: Window, e: PointerEvent ): void {
	// Only drag from the title bar background, not from any buttons.
	//
	// The class-level guard (`__btn` / `__custom-buttons`) catches
	// anything that's a chrome button regardless of which container
	// it sits in — load-bearing for plugin-registered title-bar
	// buttons, which live in the `__custom-buttons--*` slots and
	// would otherwise capture the pointer here. Without this, a
	// static click (no mouse movement between down and up) on a
	// plugin button gets swallowed by the drag tracker because
	// `setPointerCapture` redirects the pointerup away from the
	// button's own click pipeline. Plugin authors hit this as
	// "click handler fires ~1 in 10 times unless I move the mouse."
	//
	// The container guards stay too — they cover the built-in chrome
	// (controls, screen-meta, ⋯ menu) and existed before plugin
	// buttons were a concept. Defence in depth.
	const target = e.target as HTMLElement;
	if (
		target.closest( '.desktop-mode-window__btn' ) ||
		target.closest( '.desktop-mode-window__custom-buttons' ) ||
		target.closest( '.desktop-mode-window__controls' ) ||
		target.closest( '.desktop-mode-window__screen-meta' ) ||
		target.closest( '.desktop-mode-window__menu-btn' ) ||
		target.closest( '.desktop-mode-window__menu-panel' )
	) {
		return;
	}

	const isMaximized = win.state === 'maximized';
	const isSnapped =
		win.state === 'snapped-left' || win.state === 'snapped-right';
	const needsUnstate = isMaximized || isSnapped;

	// Capture the params we'd need IF the drag turns real. Nothing is
	// mutated yet — a plain click (pointerdown + pointerup before
	// crossing DRAG_THRESHOLD_PX) on a maximized/snapped title bar
	// should leave the window exactly as it was.
	const startClientX = e.clientX;
	const startClientY = e.clientY;
	const pointerId = e.pointerId;
	const unstateParams: UnstateParams | null = needsUnstate
		? captureUnstateParams( win, e )
		: null;

	// Pointer capture has to happen on pointerdown to receive
	// subsequent move/up events on the same element. Safe to release
	// in the no-op cleanup if the drag never commits.
	win._titleBar.setPointerCapture( pointerId );

	// Snapshot snap-to-grid config once so the move loop doesn't pay
	// a bounding-rect read every frame. Captured here rather than on
	// drag-start because the user might hit snap cells BEFORE the
	// threshold crosses (which would warrant starting with the grid
	// quantization already in effect).
	const snap = win.snapConfigProvider?.() ?? { enabled: false, cellWidth: 0, cellHeight: 0 };

	// Emitter for `WINDOW_BOUNDS_CHANGED` — rAF-coalesced so a
	// pointermove storm collapses to one fire per paint. Built
	// eagerly because the emitter carries per-drag state
	// (pending-flag) and we want a fresh one for each session.
	const emitBoundsChanged = makeBoundsEmitter( win, 'drag' );

	// `started` flips true once the drag has actually begun. For
	// windows that don't need un-state (state === 'normal' etc.) we
	// begin immediately, matching pre-threshold behavior. For
	// max/snap we defer until DRAG_THRESHOLD_PX is crossed so a
	// stationary click doesn't un-state the window.
	let started = false;
	const beginDrag = ( cursorX: number, cursorY: number ): void => {
		if ( started ) {
			return;
		}
		started = true;

		// If this drag was armed on a maximized / snapped window,
		// commit the un-state NOW — the user has moved enough to
		// declare intent. `commitUnstate` returns the `{ left, top }`
		// it just wrote so we can compute drag offsets from the new
		// geometry directly, without a round-trip through
		// `offsetLeft` (which lags inline-style writes until layout
		// flushes — jsdom never flushes, so tests would read 0).
		let newLeft: number;
		let newTop: number;
		if ( unstateParams ) {
			const placed = commitUnstate( win, unstateParams, cursorX, cursorY );
			newLeft = placed.left;
			newTop = placed.top;
		} else {
			newLeft = win.element.offsetLeft;
			newTop = win.element.offsetTop;
		}

		// --dragging class disables the base 0.25 s transition on
		// left/top/width/height so drag motion is pixel-accurate.
		// Added AFTER the un-state geometry jump so the browser
		// doesn't try to animate the flip from maximized → floating.
		win.element.classList.add( 'desktop-mode-window--dragging' );
		if ( snap.enabled ) {
			// A shorter transition for snap-drag so cell-to-cell jumps
			// feel tactile instead of teleporting.
			win.element.classList.add( 'desktop-mode-window--snap-drag' );
		}

		win._isDragging = true;
		win._dragOffsetX = cursorX - newLeft;
		win._dragOffsetY = cursorY - newTop;

		doAction( HOOKS.WINDOW_DRAG_START, { windowId: win.id } );
	};

	// Normal (non-max/snap) windows have no visible geometry change
	// from "started" vs "not started" — they can begin immediately.
	if ( ! needsUnstate ) {
		beginDrag( startClientX, startClientY );
	}

	const onDragMove = ( ev: PointerEvent ): void => {
		// Threshold gate. While still armed-but-not-started, a tiny
		// pointer jitter must NOT un-state the window.
		if ( ! started ) {
			const dx = ev.clientX - startClientX;
			const dy = ev.clientY - startClientY;
			if ( dx * dx + dy * dy < DRAG_THRESHOLD_SQUARED ) {
				return;
			}
			beginDrag( ev.clientX, ev.clientY );
		}
		if ( ! win._isDragging ) {
			return;
		}
		let x = ev.clientX - win._dragOffsetX;
		let y = ev.clientY - win._dragOffsetY;

		// Constrain to desktop bounds keeping GRAB_MARGIN visible.
		const desktop = win.element.parentElement;
		if ( desktop ) {
			const safe = clampWindowPosition( x, y, win.element.offsetWidth, desktop.clientWidth, desktop.clientHeight );
			x = safe.x;
			y = safe.y;
		}

		// Quantise to the live grid when snap is on. Round (not floor)
		// so the window settles onto the nearest grid intersection
		// rather than always biasing left/up.
		if ( snap.enabled ) {
			x = Math.round( x / snap.cellWidth ) * snap.cellWidth;
			y = Math.round( y / snap.cellHeight ) * snap.cellHeight;
		}

		win.element.style.left = `${ x }px`;
		win.element.style.top = `${ y }px`;

		// Edge snap-zone detection. The manager wires `onDragMove` to
		// update the snap preview + arm the commit. Dragging outside
		// the zone clears preview state.
		win.onDragMove?.( win, ev.clientX, ev.clientY );

		// Live bounds-changed hook — rAF-coalesced. Collision-aware
		// wallpapers (snow piling on window tops, rain splash) listen
		// here instead of polling `getBoundingClientRect` each frame.
		emitBoundsChanged();
	};

	const releaseCapture = (): void => {
		try {
			win._titleBar.releasePointerCapture( pointerId );
		} catch {
			/* already released; nothing to do */
		}
	};

	const detachListeners = (): void => {
		win._titleBar.removeEventListener( 'pointermove', onDragMove );
		win._titleBar.removeEventListener( 'pointerup', onDragEnd );
		win._titleBar.removeEventListener( 'pointercancel', onDragEnd );
		win._titleBar.removeEventListener( 'lostpointercapture', onDragEnd );
	};

	const onDragEnd = (): void => {
		// Released before crossing the threshold: treat as a plain
		// click. Don't un-state the window, don't fire any drag
		// hooks, don't even flip `_isDragging`. The user's intent
		// was probably to focus/activate the window, not to drag it.
		if ( ! started ) {
			releaseCapture();
			detachListeners();
			return;
		}

		if ( ! win._isDragging ) {
			return;
		}
		win._isDragging = false;
		win.element.classList.remove( 'desktop-mode-window--dragging' );
		win.element.classList.remove( 'desktop-mode-window--snap-drag' );
		releaseCapture();
		detachListeners();

		// Let the manager consume this drag-end as a snap commit if a
		// preview is armed. When it does, we skip the usual moved /
		// drag-end hooks — the snap-zone lifecycle fires its own
		// actions (`snap.zone-committed`) with richer payload.
		const consumed = win.onDragEnd?.( win ) ?? false;
		if ( consumed ) {
			return;
		}

		win._emitChange( 'moved' );
		const payload = {
			windowId: win.id,
			x: win.element.offsetLeft,
			y: win.element.offsetTop,
		};
		doAction( HOOKS.WINDOW_DRAG_END, payload );
		doAction( HOOKS.WINDOW_MOVED, payload );
	};

	win._titleBar.addEventListener( 'pointermove', onDragMove );
	win._titleBar.addEventListener( 'pointerup', onDragEnd );
	win._titleBar.addEventListener( 'pointercancel', onDragEnd );
	win._titleBar.addEventListener( 'lostpointercapture', onDragEnd );
}

/**
 * Snapshot every value we'd need to commit a maximize / snap un-state
 * later — if and only if the drag crosses the threshold. Captured at
 * pointerdown time because a few things (title-bar rect, parent
 * bounding rect) can shift slightly after the class flip, and we want
 * consistent geometry.
 */
function captureUnstateParams(
	win: Window,
	e: PointerEvent,
): UnstateParams {
	const titleRect = win._titleBar.getBoundingClientRect();
	const cursorRatioX =
		titleRect.width > 0
			? ( e.clientX - titleRect.left ) / titleRect.width
			: 0.5;

	// Resolve floating width/height. Prefer the saved pre-state
	// geometry; fall back to a sensible default (60 % of the desktop
	// area) when the window was born maximized / snapped and never had
	// a floating size to remember.
	const parent = win.element.parentElement;
	const fallbackW = parent
		? Math.min( 960, Math.round( parent.clientWidth * 0.6 ) )
		: 640;
	const fallbackH = parent
		? Math.min( 640, Math.round( parent.clientHeight * 0.7 ) )
		: 480;
	const w = win._savedGeometry?.width ?? fallbackW;
	const h = win._savedGeometry?.height ?? fallbackH;

	const parentRect = parent?.getBoundingClientRect();

	return {
		isMaximized: win.state === 'maximized',
		cursorRatioX,
		titleBarHeight: titleRect.height,
		// `clientX` / `clientY` are viewport-relative but
		// `style.left` / `.top` resolve against the window's
		// offsetParent (the desktop area). Subtract the area's own
		// viewport origin so the re-anchor math lands in the right
		// space — otherwise an admin bar above + a dock on the left
		// would shift the window below + right of the cursor.
		areaLeft: parentRect?.left ?? 0,
		areaTop: parentRect?.top ?? 0,
		targetW: w,
		targetH: h,
	};
}

/**
 * Execute the un-state flip now that the drag has committed. Called
 * from `beginDrag` with the CURRENT cursor position so the window's
 * new title bar lands exactly under the pointer with no catch-up
 * frame.
 */
function commitUnstate(
	win: Window,
	params: UnstateParams,
	cursorX: number,
	cursorY: number,
): { left: number; top: number } {
	win.element.classList.remove(
		'desktop-mode-window--maximized',
		'desktop-mode-window--snapped-left',
		'desktop-mode-window--snapped-right',
	);
	win.element.style.width = `${ params.targetW }px`;
	win.element.style.height = `${ params.targetH }px`;
	// Clamp the initial re-anchor to EDGE_MARGIN (0) on the left so the
	// window doesn't start the drag already half off-screen. The drag-move
	// loop (clampWindowPosition) uses a looser bound — GRAB_MARGIN - width —
	// which allows the window to bleed past the left edge as long as
	// GRAB_MARGIN px of the title bar stays visible. Using EDGE_MARGIN here
	// is intentionally tighter: we want the snap-to-float commit to land in
	// a fully-reachable position, and any subsequent left-bleed is then the
	// user's own drag choice.
	// Background: a snapped-LEFT window whose floating width exceeds the
	// half-screen would otherwise re-anchor at a NEGATIVE left (cursor
	// ratio × restored width reaches past the desktop's left edge),
	// and since the drag offsets derive from the position written here,
	// every subsequent move stays negative too — the move-loop clamp then
	// pins the window at x=0 until the cursor has traveled the whole
	// overshoot, which reads as "the left window can't be dragged out of
	// split view." Snapped-RIGHT never overshoots (its cursor sits in the
	// right half, so the anchor math stays positive) — that asymmetry was
	// the bug's tell.
	const left = Math.max(
		EDGE_MARGIN,
		Math.round(
			cursorX - params.areaLeft - params.targetW * params.cursorRatioX,
		),
	);
	const top = Math.max(
		EDGE_MARGIN,
		Math.round( cursorY - params.areaTop - params.titleBarHeight / 2 ),
	);
	win.element.style.left = `${ left }px`;
	win.element.style.top = `${ top }px`;
	win.state = 'normal';
	win._emitChange( 'state' );
	if ( params.isMaximized ) {
		doAction( HOOKS.WINDOW_UNMAXIMIZED, { windowId: win.id } );
	}
	return { left, top };
}

/** Which axes a given corner grip moves. */
type ResizeDir = 'ne' | 'nw' | 'se' | 'sw';

/** Resize-handle pointerdown → resize session. */
export function handleResizeStart( win: Window, e: PointerEvent ): void {
	// Maximized/fullscreen windows take the whole area — a resize
	// drag would fight the max-geometry loop in window-manager's
	// ResizeObserver, so bail early. Snapped windows DO allow resize
	// so the user can shrink a half-screened window back to floating.
	if ( win.state === 'maximized' || win.state === 'fullscreen' ) {
		return;
	}

	e.preventDefault();
	e.stopPropagation();

	const handle = e.target as HTMLElement;
	const dir = ( handle.dataset.dir as ResizeDir | undefined ) ?? 'se';

	win._isResizing = true;
	win._resizeStartX = e.clientX;
	win._resizeStartY = e.clientY;
	win._resizeStartW = win.element.offsetWidth;
	win._resizeStartH = win.element.offsetHeight;
	const startLeft = win.element.offsetLeft;
	const startTop = win.element.offsetTop;

	handle.setPointerCapture( e.pointerId );
	win.element.classList.add( 'desktop-mode-window--resizing' );
	doAction( HOOKS.WINDOW_RESIZE_START, { windowId: win.id } );

	// Per-session rAF-coalesced bounds emitter — same pattern as
	// drag. Live wallpaper plugins hook the single
	// `WINDOW_BOUNDS_CHANGED` action for both gestures and branch
	// on the `phase` field.
	const emitBoundsChanged = makeBoundsEmitter( win, 'resize' );

	const snap = win.snapConfigProvider?.() ?? { enabled: false, cellWidth: 0, cellHeight: 0 };
	if ( snap.enabled ) {
		win.element.classList.add( 'desktop-mode-window--snap-drag' );
	}

	// Resizing a snapped window breaks the "exactly half" invariant,
	// so clear the snap state. The class carries cosmetic tweaks
	// (resize handles stay, rounded corners stay, etc.) that no
	// longer apply to a user-sized window.
	if ( win.state === 'snapped-left' || win.state === 'snapped-right' ) {
		win.element.classList.remove(
			'desktop-mode-window--snapped-left',
			'desktop-mode-window--snapped-right',
		);
		win.state = 'normal';
	}

	const onResizeMove = ( ev: PointerEvent ): void => {
		if ( ! win._isResizing ) {
			return;
		}
		const dx = ev.clientX - win._resizeStartX;
		const dy = ev.clientY - win._resizeStartY;
		const geom = computeResize(
			dir,
			dx,
			dy,
			startLeft,
			startTop,
			win._resizeStartW,
			win._resizeStartH,
			win.config.minWidth,
			win.config.minHeight,
			snap,
		);

		win.element.style.left = `${ geom.x }px`;
		win.element.style.top = `${ geom.y }px`;
		win.element.style.width = `${ geom.width }px`;
		win.element.style.height = `${ geom.height }px`;

		emitBoundsChanged();
	};

	const onResizeEnd = (): void => {
		if ( ! win._isResizing ) {
			return;
		}
		win._isResizing = false;
		win.element.classList.remove( 'desktop-mode-window--resizing' );
		win.element.classList.remove( 'desktop-mode-window--snap-drag' );
		handle.removeEventListener( 'pointermove', onResizeMove );
		handle.removeEventListener( 'pointerup', onResizeEnd );
		handle.removeEventListener( 'pointercancel', onResizeEnd );
		handle.removeEventListener( 'lostpointercapture', onResizeEnd );
		win._emitChange( 'resized' );
		const payload = {
			windowId: win.id,
			width: win.element.offsetWidth,
			height: win.element.offsetHeight,
		};
		doAction( HOOKS.WINDOW_RESIZE_END, payload );
		doAction( HOOKS.WINDOW_RESIZED, payload );
	};

	handle.addEventListener( 'pointermove', onResizeMove );
	handle.addEventListener( 'pointerup', onResizeEnd );
	handle.addEventListener( 'pointercancel', onResizeEnd );
	handle.addEventListener( 'lostpointercapture', onResizeEnd );
}

/**
 * Compute new `{ x, y, width, height }` for a corner resize drag.
 *
 * For the SE corner, width/height grow from the top-left anchor.
 * For NE / SW / NW corners one or both axes start from the OPPOSITE
 * anchor — shrinking from those sides means left/top ALSO move so
 * the non-dragged edges stay pinned. Factored out so the move
 * callback stays linear and the math is unit-testable.
 *
 * All resulting dimensions are clamped to the window's configured
 * minimums. When snap-to-grid is enabled, width/height (and the
 * resulting x/y when the top-left moves) are quantized to whole
 * cells.
 */
export function computeResize(
	dir: ResizeDir,
	dx: number,
	dy: number,
	startLeft: number,
	startTop: number,
	startW: number,
	startH: number,
	minWidth: number,
	minHeight: number,
	snap: { enabled: boolean; cellWidth: number; cellHeight: number },
): { x: number; y: number; width: number; height: number } {
	let width = startW;
	let height = startH;
	let x = startLeft;
	let y = startTop;

	// East edge grows / shrinks the right — left stays put.
	if ( dir === 'ne' || dir === 'se' ) {
		width = Math.max( minWidth, startW + dx );
	}
	// West edge: width shrinks from the LEFT, so x moves.
	if ( dir === 'nw' || dir === 'sw' ) {
		const nextWidth = Math.max( minWidth, startW - dx );
		x = startLeft + ( startW - nextWidth );
		width = nextWidth;
	}
	// South edge grows / shrinks the bottom — top stays put.
	if ( dir === 'se' || dir === 'sw' ) {
		height = Math.max( minHeight, startH + dy );
	}
	// North edge: height shrinks from the TOP, so y moves.
	if ( dir === 'ne' || dir === 'nw' ) {
		const nextHeight = Math.max( minHeight, startH - dy );
		y = startTop + ( startH - nextHeight );
		height = nextHeight;
	}

	if ( snap.enabled ) {
		// Quantize dimensions to whole cells. Re-clamp to the
		// configured minimums afterward because the round-down could
		// otherwise drop a dimension below the minimum.
		const nextWidth = Math.max(
			minWidth,
			Math.round( width / snap.cellWidth ) * snap.cellWidth,
		);
		const nextHeight = Math.max(
			minHeight,
			Math.round( height / snap.cellHeight ) * snap.cellHeight,
		);
		// If the top-left moved, re-anchor to keep the opposite edge
		// pinned after snapping.
		if ( dir === 'nw' || dir === 'sw' ) {
			x = startLeft + ( width - nextWidth );
		}
		if ( dir === 'nw' || dir === 'ne' ) {
			y = startTop + ( height - nextHeight );
		}
		width = nextWidth;
		height = nextHeight;
	}

	// Constrain upper-left bounds to prevent the window/title bar from
	// being resized off-screen. Shrink the dimension by the clamped
	// difference so the opposite (pinned) edge stays exactly in place —
	// clamping the position alone would let the bottom/right edge slide
	// while the user drags the top/left handle.
	if ( x < EDGE_MARGIN ) {
		const diff = EDGE_MARGIN - x;
		x = EDGE_MARGIN;
		width = Math.max( minWidth, width - diff );
	}
	if ( y < EDGE_MARGIN ) {
		const diff = EDGE_MARGIN - y;
		y = EDGE_MARGIN;
		height = Math.max( minHeight, height - diff );
	}

	return { x, y, width, height };
}

/**
 * Clamp a window's left/top coordinate to ensure a minimum clickable grab area
 * (GRAB_MARGIN) remains visible within the parent desktop boundaries, and the top
 * edge is strictly constrained above the top menu (EDGE_MARGIN).
 */
export function clampWindowPosition(
	x: number,
	y: number,
	width: number,
	desktopW: number,
	desktopH: number,
): { x: number; y: number } {
	const minX = GRAB_MARGIN - width;
	const maxX = desktopW - GRAB_MARGIN;
	const safeX = Math.max( minX, Math.min( x, maxX ) );

	const minY = EDGE_MARGIN;
	const maxY = desktopH - GRAB_MARGIN;
	const safeY = Math.max( minY, Math.min( y, maxY ) );

	return { x: safeX, y: safeY };
}
