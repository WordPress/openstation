/**
 * OpenStation — Window-manager geometry helpers.
 *
 * Pure math for the `tile()` grid picker, the snap cell-size validator,
 * and the Overview thumbnail layout. No DOM side effects, no class
 * references — everything takes numbers + returns numbers.
 */

import type { Window } from '../window';

/**
 * Validate a plugin-supplied grid choice from the
 * `os.arrange.tile.dimensions` filter. Rejects non-finite
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
 * `os.arrange.snap.cell-size` filter. Both dimensions must be
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

/**
 * Where a placement starts across, and how wide it is. Relative to the
 * left edge of whatever row the caller is splitting.
 */
export interface RowSpan {
	x: number;
	width: number;
}

/**
 * Split a row between two windows: the first takes `preferredFirst`,
 * the second the remainder, and each keeps its own minimum width.
 *
 * A second window that would be narrower than its minimum takes its
 * minimum out of the first; a first window narrower than its own takes
 * it back. When both minimums cannot fit (`minFirst + gap + minSecond`
 * is more than the row), each window keeps its minimum anyway and stays
 * inside the row, the first flush left and the second flush right, and
 * the two overlap in the middle. A window below its floor is broken
 * (columns clip, toolbars wrap); one overlapping its neighbour is only
 * covered, and the user can raise it.
 *
 * Neither width ever exceeds the row.
 */
export function splitRowByMinWidth(
	total: number,
	gap: number,
	preferredFirst: number,
	minFirst: number,
	minSecond: number,
): { first: RowSpan; second: RowSpan } {
	let first = preferredFirst;
	let second = total - gap - first;
	if ( second < minSecond ) {
		second = minSecond;
		first = total - gap - second;
	}
	if ( first < minFirst ) {
		first = minFirst;
		second = Math.max( minSecond, total - gap - first );
	}
	first = Math.max( 0, Math.min( first, total ) );
	second = Math.max( 0, Math.min( second, total ) );
	return {
		first: { x: 0, width: first },
		second: { x: total - second, width: second },
	};
}

/**
 * The rectangle a half-screen snap gives a window in `area` (the work
 * area, in desktop-area coordinates).
 *
 * The split starts at half and moves for minimum widths: the window
 * gets at least `minWidth`, and leaves the other side at least
 * `partnerMinWidth` (the widest minimum among the windows snapped
 * there, `0` when none is). When both cannot fit, the window keeps its
 * minimum against its own edge and overlaps the other side. See
 * {@link splitRowByMinWidth}.
 */
export function snapHalfRect(
	area: { x: number; y: number; width: number; height: number },
	zone: 'left' | 'right',
	minWidth: number,
	partnerMinWidth: number,
): { x: number; y: number; width: number; height: number } {
	const half = Math.floor( area.width / 2 );
	const split =
		zone === 'left'
			? splitRowByMinWidth( area.width, 0, half, minWidth, partnerMinWidth )
			: splitRowByMinWidth( area.width, 0, half, partnerMinWidth, minWidth );
	const span = zone === 'left' ? split.first : split.second;
	return {
		x: area.x + span.x,
		y: area.y,
		width: span.width,
		height: area.height,
	};
}

/**
 * Share a row between `mins.length` windows separated by `gap`, giving
 * every window at least its minimum width and splitting what is left
 * evenly between the rest.
 *
 * With no minimum above the even share this is exactly the even split
 * (`floor( ( total - gaps ) / n )` each, laid left to right). A window
 * whose minimum is above the share takes its minimum, and the others
 * share the remainder, repeated until every window's share covers its
 * floor.
 *
 * When the minimums cannot all fit, every window keeps its minimum and
 * the row is spread instead: the first flush left, the last flush
 * right, the rest at even steps between, overlapping their neighbours.
 * The same rule as {@link splitRowByMinWidth}, for any count.
 */
export function shareRowByMinWidth(
	total: number,
	gap: number,
	mins: number[],
): RowSpan[] {
	const n = mins.length;
	if ( n === 0 ) {
		return [];
	}
	const widths = new Array< number >( n ).fill( 0 );
	const fixed = new Array< boolean >( n ).fill( false );
	let budget = total - gap * ( n - 1 );
	let free = n;
	let changed = true;
	while ( changed && free > 0 ) {
		changed = false;
		const share = Math.floor( budget / free );
		for ( let i = 0; i < n; i++ ) {
			if ( ! fixed[ i ] && mins[ i ] > share ) {
				fixed[ i ] = true;
				widths[ i ] = Math.min( mins[ i ], total );
				budget -= widths[ i ];
				free--;
				changed = true;
			}
		}
	}
	const share = free > 0 ? Math.floor( budget / free ) : 0;
	for ( let i = 0; i < n; i++ ) {
		if ( ! fixed[ i ] ) {
			widths[ i ] = share;
		}
	}

	if ( budget >= 0 ) {
		let x = 0;
		return widths.map( ( width ) => {
			const span = { x, width };
			x += width + gap;
			return span;
		} );
	}

	// Over-full: every window holds its minimum, spread edge to edge.
	const lastX = total - widths[ n - 1 ];
	return widths.map( ( width, i ) => {
		const step = n > 1 ? Math.round( ( lastX * i ) / ( n - 1 ) ) : 0;
		return { x: Math.max( 0, Math.min( step, total - width ) ), width };
	} );
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
