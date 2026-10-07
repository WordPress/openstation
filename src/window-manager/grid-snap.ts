import { applyFilters, doAction, HOOKS } from '../hooks';
import type { GridSpan } from '../types';
import type { Window } from '../window';
import {
	subscribeWorkArea,
	workAreaRectOf,
	type WorkAreaRect,
} from '../work-area';
import { abortSnapIfPending } from './snap-zones';
import type { WindowManager } from './index';

export const GRID_SNAP_COLUMNS = 6;
export const GRID_SNAP_ROWS = 6;

export const GRID_SNAP_GUTTER = 8;

export const GridSnapAnchorReason = {
	Modifier: 'modifier',
	Shake: 'shake',
} as const;
export type GridSnapAnchorReason =
	( typeof GridSnapAnchorReason )[ keyof typeof GridSnapAnchorReason ];

export interface GridCell {
	col: number;
	row: number;
}

export interface GridDimensions {
	cols: number;
	rows: number;
}

export interface GridRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface GridSnapSession {
	windowId: string;
	dims: GridDimensions;
	anchor: GridCell;
	cursor: GridCell;

	rect: GridRect;

	overlayEl: HTMLElement;
	targetEl: HTMLElement;

	windowEl: HTMLElement;
}

export const GRID_SNAPPING_CLASS = 'os-window--grid-snapping';

export const GRID_SNAPPING_AREA_CLASS = 'os-area--grid-snapping';

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

export function cellRect(
	cell: GridCell,
	area: WorkAreaRect,
	dims: GridDimensions,
): GridRect {
	return spanRect( cell, cell, area, dims );
}

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

export function placementRect(
	a: GridCell,
	b: GridCell,
	area: WorkAreaRect,
	dims: GridDimensions,
): GridRect {
	const cells = spanRect( a, b, area, dims );
	const inset = Math.round( GRID_SNAP_GUTTER / 2 );
	if ( cells.width <= inset * 4 || cells.height <= inset * 4 ) {
		return cells;
	}
	return {
		x: cells.x + inset,
		y: cells.y + inset,
		width: cells.width - inset * 2,
		height: cells.height - inset * 2,
	};
}

function sameCell( a: GridCell, b: GridCell ): boolean {
	return a.col === b.col && a.row === b.row;
}

function toArea(
	mgr: WindowManager,
	clientX: number,
	clientY: number,
): { x: number; y: number } {
	const r = mgr._desktop.getBoundingClientRect();
	return { x: clientX - r.left, y: clientY - r.top };
}

function paint( session: GridSnapSession, area: WorkAreaRect ): void {
	const { overlayEl, targetEl, dims, rect } = session;
	overlayEl.style.left = `${ area.x }px`;
	overlayEl.style.top = `${ area.y }px`;
	overlayEl.style.width = `${ area.width }px`;
	overlayEl.style.height = `${ area.height }px`;

	overlayEl.style.setProperty( '--os-grid-snap-cols', String( dims.cols ) );
	overlayEl.style.setProperty( '--os-grid-snap-rows', String( dims.rows ) );

	targetEl.style.left = `${ rect.x - area.x }px`;
	targetEl.style.top = `${ rect.y - area.y }px`;
	targetEl.style.width = `${ rect.width }px`;
	targetEl.style.height = `${ rect.height }px`;
	targetEl.dataset.cols = String( Math.abs( session.cursor.col - session.anchor.col ) + 1 );
	targetEl.dataset.rows = String( Math.abs( session.cursor.row - session.anchor.row ) + 1 );
}

export function beginGridSnap(
	mgr: WindowManager,
	win: Window,
	clientX: number,
	clientY: number,
): void {
	if ( mgr._gridSnap ) {
		return;
	}

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
		rect: placementRect( anchor, anchor, area, dims ),
		overlayEl,
		targetEl,
		windowEl: win.element,
	};
	mgr._gridSnap = session;

	win.element.classList.add( GRID_SNAPPING_CLASS );
	mgr._desktop.classList.add( GRID_SNAPPING_AREA_CLASS );
	paint( session, area );

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
	const rect = placementRect( session.anchor, cursor, area, session.dims );
	const moved = ! sameCell( cursor, session.cursor );
	const resized =
		rect.x !== session.rect.x ||
		rect.y !== session.rect.y ||
		rect.width !== session.rect.width ||
		rect.height !== session.rect.height;
	session.cursor = cursor;
	session.rect = rect;

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
	session.rect = placementRect( anchor, anchor, area, session.dims );
	paint( session, area );

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

const GRID_SNAP_FADE_MS = 200;

function dispose( mgr: WindowManager ): GridSnapSession | null {
	const session = mgr._gridSnap;
	if ( ! session ) {
		return null;
	}
	mgr._gridSnap = null;
	session.windowEl.classList.remove( GRID_SNAPPING_CLASS );
	mgr._desktop.classList.remove( GRID_SNAPPING_AREA_CLASS );
	const el = session.overlayEl;
	el.classList.remove( 'os-grid-snap--visible' );
	window.setTimeout( () => el.remove(), GRID_SNAP_FADE_MS );
	return session;
}

export function cancelGridSnap( mgr: WindowManager ): void {
	const session = dispose( mgr );
	if ( session ) {
		doAction( HOOKS.GRID_SNAP_CANCELED, { windowId: session.windowId } );
	}
}

export function commitGridSnapIfActive(
	mgr: WindowManager,
	win: Window,
): boolean {
	const session = dispose( mgr );
	if ( ! session ) {
		return false;
	}
	const { rect } = session;

	if ( win.state === 'normal' ) {
		win._savedGeometry = null;
	}

	win.element.style.left = `${ rect.x }px`;
	win.element.style.top = `${ rect.y }px`;
	win.element.style.width = `${ rect.width }px`;
	win.element.style.height = `${ rect.height }px`;

	win._emitChange( 'moved' );
	win._emitChange( 'resized' );

	win._gridSpan = {
		anchor: { ...session.anchor },
		cursor: { ...session.cursor },
		cols: session.dims.cols,
		rows: session.dims.rows,
	};

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

	doAction( HOOKS.WINDOW_DRAG_END, { windowId: win.id, x: rect.x, y: rect.y } );
	doAction( HOOKS.WINDOW_MOVED, { windowId: win.id, x: rect.x, y: rect.y } );
	doAction( HOOKS.WINDOW_RESIZED, {
		windowId: win.id,
		width: rect.width,
		height: rect.height,
	} );
	return true;
}

export function gridSpanRect( span: GridSpan, area: WorkAreaRect ): GridRect {
	return placementRect( span.anchor, span.cursor, area, {
		cols: span.cols,
		rows: span.rows,
	} );
}

export function reflowGridSpan( win: Window, area: WorkAreaRect ): boolean {
	const span = win._gridSpan;
	if ( ! span || ( win.state !== 'normal' && win.state !== 'minimized' ) ) {
		return false;
	}
	const rect = gridSpanRect( span, area );
	const el = win.element;
	const next = {
		left: `${ rect.x }px`,
		top: `${ rect.y }px`,
		width: `${ rect.width }px`,
		height: `${ rect.height }px`,
	};
	if (
		el.style.left === next.left &&
		el.style.top === next.top &&
		el.style.width === next.width &&
		el.style.height === next.height
	) {
		return false;
	}
	el.style.left = next.left;
	el.style.top = next.top;
	el.style.width = next.width;
	el.style.height = next.height;
	return true;
}

export function reflowGridSpans( mgr: WindowManager ): string[] {
	const area = workAreaRectOf( mgr._desktop );
	const moved: string[] = [];
	for ( const win of mgr._stack ) {
		if ( reflowGridSpan( win, area ) ) {
			win._emitChange( 'moved' );
			moved.push( win.id );
		}
	}
	if ( moved.length > 0 ) {
		doAction( HOOKS.GRID_SNAP_REFLOWED, { windowIds: moved } );
	}
	return moved;
}

export function installGridSpanReflow( mgr: WindowManager ): () => void {
	return subscribeWorkArea( () => {
		reflowGridSpans( mgr );
	} );
}
