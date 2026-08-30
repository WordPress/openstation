/**
 * OpenStation — Grid snap.
 *
 * Hold Option (Alt on Windows and Linux) while dragging a window and
 * the desk becomes a 6×6 grid. The cell under the pointer when the key
 * went down is the **anchor**; the cell under it now is the
 * **cursor**; the window will land on the rectangle spanning the two.
 * Drag from (1,1) to (2,2) and the window is 2×2 at the top-left. Drag
 * from (2,2) to (1,1) and it is the same 2×2 — the span is a bounding
 * box, so it works backwards. Shake the pointer and the anchor moves
 * to the cell the shake happened in, so a placement can be restarted
 * without letting go.
 *
 * ## Responsive by construction
 *
 * The grid is never stored in pixels. Every cell is a fraction of the
 * work area — `col / 6` of its width, `row / 6` of its height — and is
 * resolved against the live rect on every pointermove. A 6×6 desk on a
 * 5K display and on a laptop are the same six columns at the same
 * proportions, and a dock that moves mid-drag moves the grid with it.
 *
 * ## The work area, not the whole desk
 *
 * Edge snap and maximize deliberately use the whole desktop area, dock
 * band included — the band is the user's to use on purpose. Grid snap
 * is different in kind: a cell is a landing zone the user picks by
 * pointing at it, and a cell hidden under the dock is one they cannot
 * point at. So the grid is laid over the work area, the rectangle the
 * user can reach, and its bottom row sits above the dock.
 *
 * ## Layers
 *
 * `cellAt` / `cellRect` / `spanRect` are pure geometry, tested as a
 * table. The session functions below mutate one `_gridSnap` field on
 * the manager and one overlay element, the same shape `snap-zones.ts`
 * takes, so `pointer.ts` can drive both without reaching through two
 * class boundaries.
 */

import { applyFilters, doAction, HOOKS } from '../hooks';
import type { Window } from '../window';
import { workAreaRectOf, type WorkAreaRect } from '../work-area';
import { abortSnapIfPending } from './snap-zones';
import type { WindowManager } from './index';

/** The grid: six across, six down. Filterable — see `gridSnapDimensions`. */
export const GRID_SNAP_COLUMNS = 6;
export const GRID_SNAP_ROWS = 6;

/**
 * Why the anchor is where it is.
 *
 * - `modifier` — the key went down here.
 * - `shake`    — the pointer was shaken here.
 *
 * Carried on every hook payload so a listener can tell "the user
 * started" from "the user started over".
 */
export const GridSnapAnchorReason = {
	Modifier: 'modifier',
	Shake: 'shake',
} as const;
export type GridSnapAnchorReason =
	( typeof GridSnapAnchorReason )[ keyof typeof GridSnapAnchorReason ];

/** One cell, zero-indexed from the top-left. */
export interface GridCell {
	col: number;
	row: number;
}

/** Cols × rows the grid is laid out with. */
export interface GridDimensions {
	cols: number;
	rows: number;
}

/** An area-relative rectangle, whole pixels. */
export interface GridRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * The live state of a grid-snap drag. Exactly one exists while the
 * modifier is held; `null` means the drag is an ordinary one.
 */
export interface GridSnapSession {
	windowId: string;
	dims: GridDimensions;
	anchor: GridCell;
	cursor: GridCell;
	/** The rect the window will land on. Recomputed every move. */
	rect: GridRect;
	/** The grid lines and the target highlight, inside `.os-area`. */
	overlayEl: HTMLElement;
	targetEl: HTMLElement;
}

/**
 * The grid this desk uses, after the `os.grid-snap.dimensions` filter.
 *
 * A return that is not a pair of positive integers falls back to the
 * shipped 6×6 rather than being clamped: a plugin returning nonsense
 * gets the default, not a silently different grid.
 */
export function gridSnapDimensions( area: WorkAreaRect ): GridDimensions {
	const shipped: GridDimensions = {
		cols: GRID_SNAP_COLUMNS,
		rows: GRID_SNAP_ROWS,
	};
	const filtered = applyFilters<
		GridDimensions,
		[ { areaWidth: number; areaHeight: number } ]
	>( HOOKS.GRID_SNAP_DIMENSIONS, shipped, {
		areaWidth: area.width,
		areaHeight: area.height,
	} );
	const ok =
		!! filtered &&
		Number.isInteger( filtered.cols ) &&
		Number.isInteger( filtered.rows ) &&
		filtered.cols >= 1 &&
		filtered.rows >= 1 &&
		filtered.cols <= 24 &&
		filtered.rows <= 24;
	return ok ? { cols: filtered.cols, rows: filtered.rows } : shipped;
}

/**
 * The cell under an area-relative point. A point outside the area
 * lands on the nearest edge cell, so a pointer dragged past the desk's
 * bottom still means "the bottom row".
 */
export function cellAt(
	x: number,
	y: number,
	area: WorkAreaRect,
	dims: GridDimensions,
): GridCell {
	const fx = ( x - area.x ) / Math.max( 1, area.width );
	const fy = ( y - area.y ) / Math.max( 1, area.height );
	return {
		col: clampIndex( Math.floor( fx * dims.cols ), dims.cols ),
		row: clampIndex( Math.floor( fy * dims.rows ), dims.rows ),
	};
}

function clampIndex( i: number, count: number ): number {
	if ( ! Number.isFinite( i ) ) {
		return 0;
	}
	return Math.max( 0, Math.min( count - 1, i ) );
}

/**
 * The rectangle one cell covers.
 *
 * Edges are placed by rounding the fractional boundary, not by
 * multiplying a rounded cell size: six cells of `round( w / 6 )` leave
 * a gutter at the far edge on most widths, and the sixth column would
 * stop short of the desk. Rounding each boundary makes adjacent cells
 * share an edge exactly and the last one reach the end.
 */
export function cellRect(
	cell: GridCell,
	area: WorkAreaRect,
	dims: GridDimensions,
): GridRect {
	return spanRect( cell, cell, area, dims );
}

/** The bounding box of two cells — order-independent. */
export function spanRect(
	a: GridCell,
	b: GridCell,
	area: WorkAreaRect,
	dims: GridDimensions,
): GridRect {
	const c0 = Math.min( a.col, b.col );
	const c1 = Math.max( a.col, b.col ) + 1;
	const r0 = Math.min( a.row, b.row );
	const r1 = Math.max( a.row, b.row ) + 1;
	const left = area.x + Math.round( ( area.width * c0 ) / dims.cols );
	const right = area.x + Math.round( ( area.width * c1 ) / dims.cols );
	const top = area.y + Math.round( ( area.height * r0 ) / dims.rows );
	const bottom = area.y + Math.round( ( area.height * r1 ) / dims.rows );
	return { x: left, y: top, width: right - left, height: bottom - top };
}

function sameCell( a: GridCell, b: GridCell ): boolean {
	return a.col === b.col && a.row === b.row;
}

/** Client → area-relative coordinates. */
function toArea(
	mgr: WindowManager,
	clientX: number,
	clientY: number,
): { x: number; y: number } {
	const r = mgr._desktop.getBoundingClientRect();
	return { x: clientX - r.left, y: clientY - r.top };
}

/** Paint the overlay's target highlight and the grid's own geometry. */
function paint( session: GridSnapSession, area: WorkAreaRect ): void {
	const { overlayEl, targetEl, dims, rect } = session;
	overlayEl.style.left = `${ area.x }px`;
	overlayEl.style.top = `${ area.y }px`;
	overlayEl.style.width = `${ area.width }px`;
	overlayEl.style.height = `${ area.height }px`;
	// The lines are a CSS gradient sized to the cell; the cell is a
	// fraction of the overlay, so the same rule draws any dimensions.
	overlayEl.style.setProperty( '--os-grid-snap-cols', String( dims.cols ) );
	overlayEl.style.setProperty( '--os-grid-snap-rows', String( dims.rows ) );
	// Target is positioned inside the overlay, so subtract its origin.
	targetEl.style.left = `${ rect.x - area.x }px`;
	targetEl.style.top = `${ rect.y - area.y }px`;
	targetEl.style.width = `${ rect.width }px`;
	targetEl.style.height = `${ rect.height }px`;
	targetEl.dataset.cols = String( Math.abs( session.cursor.col - session.anchor.col ) + 1 );
	targetEl.dataset.rows = String( Math.abs( session.cursor.row - session.anchor.row ) + 1 );
}

/**
 * Arm grid snap for the drag in progress: the cell under the pointer
 * becomes the anchor and the overlay appears. Idempotent — a second
 * call while armed does nothing, so a key-repeat storm is harmless.
 */
export function beginGridSnap(
	mgr: WindowManager,
	win: Window,
	clientX: number,
	clientY: number,
): void {
	if ( mgr._gridSnap ) {
		return;
	}
	// One preview at a time: an edge-snap preview under a grid overlay
	// would offer two landing rectangles for one release.
	abortSnapIfPending( mgr );

	const area = workAreaRectOf( mgr._desktop );
	const dims = gridSnapDimensions( area );
	const p = toArea( mgr, clientX, clientY );
	const anchor = cellAt( p.x, p.y, area, dims );

	const overlayEl = document.createElement( 'div' );
	overlayEl.className = 'os-grid-snap';
	overlayEl.setAttribute( 'aria-hidden', 'true' );
	const targetEl = document.createElement( 'div' );
	targetEl.className = 'os-grid-snap__target';
	overlayEl.appendChild( targetEl );
	mgr._desktop.appendChild( overlayEl );

	const session: GridSnapSession = {
		windowId: win.id,
		dims,
		anchor,
		cursor: anchor,
		rect: cellRect( anchor, area, dims ),
		overlayEl,
		targetEl,
	};
	mgr._gridSnap = session;
	paint( session, area );
	// Fade in on the next frame so the opacity transition has a
	// painted starting state to run from.
	requestAnimationFrame( () => {
		if ( mgr._gridSnap === session ) {
			overlayEl.classList.add( 'os-grid-snap--visible' );
		}
	} );

	doAction( HOOKS.GRID_SNAP_ARMED, {
		windowId: win.id,
		anchor: { ...anchor },
		dims: { ...dims },
	} );
	doAction( HOOKS.GRID_SNAP_CHANGED, {
		windowId: win.id,
		anchor: { ...anchor },
		cursor: { ...anchor },
		rect: { ...session.rect },
	} );
}

/**
 * Follow the pointer: the cursor cell moves, the span with it. Cheap
 * when nothing changed — most pointermoves stay inside one cell — and
 * fires `GRID_SNAP_CHANGED` only when the span actually differs.
 */
export function updateGridSnap(
	mgr: WindowManager,
	clientX: number,
	clientY: number,
): void {
	const session = mgr._gridSnap;
	if ( ! session ) {
		return;
	}
	const area = workAreaRectOf( mgr._desktop );
	const p = toArea( mgr, clientX, clientY );
	const cursor = cellAt( p.x, p.y, area, session.dims );
	const rect = spanRect( session.anchor, cursor, area, session.dims );
	const moved = ! sameCell( cursor, session.cursor );
	const resized =
		rect.x !== session.rect.x ||
		rect.y !== session.rect.y ||
		rect.width !== session.rect.width ||
		rect.height !== session.rect.height;
	session.cursor = cursor;
	session.rect = rect;
	// Always repaint: the area itself may have moved (a dock folding
	// away mid-drag) even when the cells did not.
	paint( session, area );
	if ( moved || resized ) {
		doAction( HOOKS.GRID_SNAP_CHANGED, {
			windowId: session.windowId,
			anchor: { ...session.anchor },
			cursor: { ...cursor },
			rect: { ...rect },
		} );
	}
}

/**
 * Start over from here: the anchor becomes the cell under the pointer
 * and the span collapses to that one cell. What a shake means.
 */
export function resetGridSnapAnchor(
	mgr: WindowManager,
	clientX: number,
	clientY: number,
	reason: GridSnapAnchorReason,
): void {
	const session = mgr._gridSnap;
	if ( ! session ) {
		return;
	}
	const area = workAreaRectOf( mgr._desktop );
	const p = toArea( mgr, clientX, clientY );
	const anchor = cellAt( p.x, p.y, area, session.dims );
	session.anchor = anchor;
	session.cursor = anchor;
	session.rect = cellRect( anchor, area, session.dims );
	paint( session, area );
	// A brief pulse on the target so the reset is seen, not inferred.
	session.targetEl.classList.remove( 'os-grid-snap__target--reset' );
	void session.targetEl.offsetWidth;
	session.targetEl.classList.add( 'os-grid-snap__target--reset' );

	doAction( HOOKS.GRID_SNAP_ANCHOR_RESET, {
		windowId: session.windowId,
		anchor: { ...anchor },
		reason,
	} );
	doAction( HOOKS.GRID_SNAP_CHANGED, {
		windowId: session.windowId,
		anchor: { ...anchor },
		cursor: { ...anchor },
		rect: { ...session.rect },
	} );
}

/** Animation used by the overlay fade and the commit slide. */
const GRID_SNAP_FADE_MS = 200;

/** Tear the overlay down. Shared by cancel and commit. */
function dispose( mgr: WindowManager ): GridSnapSession | null {
	const session = mgr._gridSnap;
	if ( ! session ) {
		return null;
	}
	mgr._gridSnap = null;
	const el = session.overlayEl;
	el.classList.remove( 'os-grid-snap--visible' );
	window.setTimeout( () => el.remove(), GRID_SNAP_FADE_MS );
	return session;
}

/**
 * Disarm without landing: the modifier was released mid-drag, or the
 * drag was cancelled. The window stays wherever the pointer has it.
 */
export function cancelGridSnap( mgr: WindowManager ): void {
	const session = dispose( mgr );
	if ( session ) {
		doAction( HOOKS.GRID_SNAP_CANCELED, { windowId: session.windowId } );
	}
}

/**
 * Entry point from the drag-end handler. Lands the window on the span
 * and returns `true` so the pointer layer skips its own move-end
 * hooks; `false` when no grid snap is armed.
 *
 * The base window transition covers left/top/width/height, so writing
 * the target geometry slides the window into place — the same
 * mechanism edge snap uses, and the same reason: one place decides
 * how a window arrives somewhere.
 */
export function commitGridSnapIfActive(
	mgr: WindowManager,
	win: Window,
): boolean {
	const session = dispose( mgr );
	if ( ! session ) {
		return false;
	}
	const { rect } = session;

	// A landing is an explicit geometry the user picked, and the
	// pre-drag box is not worth remembering the way a pre-maximize
	// box is — the user can grid-snap again or drag freely. Clear a
	// stale saved geometry so a later un-maximize does not restore a
	// size from before this placement.
	if ( win.state === 'normal' ) {
		win._savedGeometry = null;
	}

	win.element.style.left = `${ rect.x }px`;
	win.element.style.top = `${ rect.y }px`;
	win.element.style.width = `${ rect.width }px`;
	win.element.style.height = `${ rect.height }px`;

	win._emitChange( 'moved' );
	win._emitChange( 'resized' );

	const geometry = {
		windowId: win.id,
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height,
	};
	doAction( HOOKS.GRID_SNAP_COMMITTED, {
		...geometry,
		anchor: { ...session.anchor },
		cursor: { ...session.cursor },
		dims: { ...session.dims },
	} );
	// The generic lifecycle still fires: a listener that only knows
	// "windows move and resize" should not need to know about grids.
	doAction( HOOKS.WINDOW_DRAG_END, { windowId: win.id, x: rect.x, y: rect.y } );
	doAction( HOOKS.WINDOW_MOVED, { windowId: win.id, x: rect.x, y: rect.y } );
	doAction( HOOKS.WINDOW_RESIZED, {
		windowId: win.id,
		width: rect.width,
		height: rect.height,
	} );
	return true;
}
