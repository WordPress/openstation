/**
 * Desktop Mode — Window-manager geometry helpers.
 *
 * Pure math for the `tile()` grid picker, the snap cell-size validator,
 * and the Overview thumbnail layout. No DOM side effects, no class
 * references — everything takes numbers + returns numbers.
 */

import type { Window } from '../window';

/**
 * Validate a plugin-supplied grid choice from the
 * `desktop-mode.arrange.tile.dimensions` filter. Rejects non-finite
 * numbers, non-positive dimensions, and grids smaller than the window
 * count (which would silently drop windows).
 */
export function isValidGrid(
	candidate: unknown,
	windowCount: number,
): candidate is { cols: number; rows: number } {
	if ( ! candidate || typeof candidate !== 'object' ) {
		return false;
	}
	const c = ( candidate as { cols?: unknown } ).cols;
	const r = ( candidate as { rows?: unknown } ).rows;
	if ( typeof c !== 'number' || typeof r !== 'number' ) {
		return false;
	}
	if ( ! Number.isFinite( c ) || ! Number.isFinite( r ) ) {
		return false;
	}
	if ( c < 1 || r < 1 ) {
		return false;
	}
	return Math.floor( c ) * Math.floor( r ) >= windowCount;
}

/**
 * Validate a plugin-supplied snap cell size from the
 * `desktop-mode.arrange.snap.cell-size` filter. Both dimensions must be
 * positive finite numbers; anything else falls back to the algorithmic
 * default to avoid divide-by-zero downstream.
 */
export function isValidCellSize(
	candidate: unknown,
): candidate is { cellWidth: number; cellHeight: number } {
	if ( ! candidate || typeof candidate !== 'object' ) {
		return false;
	}
	const w = ( candidate as { cellWidth?: unknown } ).cellWidth;
	const h = ( candidate as { cellHeight?: unknown } ).cellHeight;
	if ( typeof w !== 'number' || typeof h !== 'number' ) {
		return false;
	}
	if ( ! Number.isFinite( w ) || ! Number.isFinite( h ) ) {
		return false;
	}
	return w > 0 && h > 0;
}

/**
 * Choose the (cols × rows) grid for `tile()` that maximises individual
 * window size while still fitting all `n` windows in a `width × height`
 * area. Scoring: minimise the absolute difference between the cell
 * aspect ratio and the area aspect ratio, with a small penalty for
 * empty trailing cells (so 5 windows pick 3×2 over 5×1 when the area is
 * roughly square).
 *
 * Capped at 6×6 — beyond that, individual windows are too small to be
 * useful and the user is better off with cascade or overview.
 */
export function pickGridDimensions(
	n: number,
	width: number,
	height: number,
): { cols: number; rows: number } {
	if ( n <= 1 ) {
		return { cols: 1, rows: 1 };
	}
	const areaAspect = width / Math.max( 1, height );
	const max = 6;
	let best = { cols: n, rows: 1, score: Infinity };
	for ( let cols = 1; cols <= Math.min( max, n ); cols++ ) {
		const rows = Math.min( max, Math.ceil( n / cols ) );
		if ( cols * rows < n ) {
			continue;
		}
		const cellAspect = ( width / cols ) / Math.max( 1, height / rows );
		const aspectDelta = Math.abs( cellAspect - areaAspect );
		const emptyCells = cols * rows - n;
		const score = aspectDelta + emptyCells * 0.05;
		if ( score < best.score ) {
			best = { cols, rows, score };
		}
	}
	return { cols: best.cols, rows: best.rows };
}

/** One cell in the Overview grid. */
export interface OverviewLayoutItem {
	win: Window;
	x: number;
	y: number;
	scale: number;
}

/**
 * Compute the grid layout for Overview mode.
 *
 * Arranges windows in a near-square grid (slightly wider than tall
 * because most screens are landscape). Each window scales to fit its
 * grid cell while preserving aspect ratio, centered in the cell.
 * Padding and inter-cell gaps keep thumbnails from crowding each other
 * and the viewport edges.
 *
 * **Coordinate system:** the returned `x` / `y` values are in the
 * same coordinate space as the windows' `offsetLeft` / `offsetTop`
 * — i.e. relative to the desktop area's origin. The `rect` argument
 * carries `{ left, top, width, height }` in that same area-local
 * space, so callers can target a sub-region (e.g. the right half
 * during split-overview) simply by passing a rect with a non-zero
 * `left`. For full overview the caller passes `{ left: 0, top: 0 }`.
 */
export function computeOverviewLayout(
	windows: Window[],
	rect: DOMRect,
	topInset = 0,
): OverviewLayoutItem[] {
	const n = windows.length;
	if ( n === 0 ) {
		return [];
	}
	// Column count rounded up from sqrt — produces a square-ish grid,
	// with the last row possibly under-filled. Better visually than a
	// long horizontal strip for ≥ 4 windows.
	const cols = Math.ceil( Math.sqrt( n ) );
	const rows = Math.ceil( n / cols );

	const padding = 40;
	const gap = 24;
	/*
	 * Vertical space reserved at the top of each cell for the
	 * thumbnail's label. Must stay in sync with the `-34` offset
	 * applied in `createOverviewLabel` (28 px label height + 6 px
	 * visual gap between label and thumbnail). Without this reserve,
	 * rows ≥ 2 would have their labels land on top of the thumbnails
	 * of the row above — the label sits 34 px above its thumbnail,
	 * but the row gap is only 24 px, so 10 px of label would overflow
	 * into the previous row's thumbnail area.
	 */
	const labelReserve = 34;

	const cellWidth =
		( rect.width - padding * 2 - gap * ( cols - 1 ) ) / cols;
	// `topInset` carves out vertical space for the desktops top bar.
	// Cells SHRINK to fit the remaining height AND shift down by
	// `topInset` so the first row's label clears the bar instead of
	// landing behind it.
	const cellHeight =
		( rect.height - padding * 2 - topInset - gap * ( rows - 1 ) ) / rows;
	// Actual space available to the thumbnail inside each cell, AFTER
	// the label reserve.
	const thumbCellHeight = Math.max( 40, cellHeight - labelReserve );

	return windows.map( ( win, i ) => {
		const col = i % cols;
		const row = Math.floor( i / cols );
		// Cells are positioned relative to the rect's origin, not the
		// area's — that's what lets the split-overview place thumbs
		// in the right half (rect.left = areaWidth / 2) without
		// colliding with a window anchored on the left.
		const cellX = rect.left + padding + col * ( cellWidth + gap );
		// cellY is the cell's top; the thumbnail anchors below the
		// label reserve, so the label (positioned at `item.y - 34`)
		// lands inside the reserve without overlapping the row above.
		// `topInset` pushes the entire grid downward.
		const cellY =
			rect.top + topInset + padding + row * ( cellHeight + gap ) + labelReserve;

		// Preserve the window's aspect ratio, fit into the thumbnail
		// area (not the full cell — the label took the top slice).
		// `scale` can be > 1 on tiny source windows; that's fine — a
		// small window scaled up looks right for an overview.
		const sourceW = win.element.offsetWidth;
		const sourceH = win.element.offsetHeight;
		const scale = Math.min(
			cellWidth / sourceW,
			thumbCellHeight / sourceH,
		);
		const scaledW = sourceW * scale;
		const scaledH = sourceH * scale;

		return {
			win,
			x: cellX + ( cellWidth - scaledW ) / 2,
			y: cellY + ( thumbCellHeight - scaledH ) / 2,
			scale,
		};
	} );
}
