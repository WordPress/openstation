/**
 * OpenStation — the icon grid.
 *
 * Tiles align to a column-major grid (top-to-bottom, then
 * left-to-right) so the desktop reads as one tidy surface
 * instead of arbitrary pointer-position coordinates.
 *
 * **This module is the one place the grid's shape is expressed in
 * TypeScript, for every surface that lays out placements** — the
 * wallpaper, folder windows, and each canvas in WP Explorer.
 * They used to disagree: the desktop ran a 96×110 pitch and the site
 * folder a 108×112 one, so the same three icons had 8px between them
 * in one window and 20px in another. Worse, the desktop's 8px was a
 * fiction — the tile's own horizontal padding was added on top of
 * its width, filling the cell exactly, and icons touched.
 *
 * The declaration lives in `assets/css/variables.css`, because that
 * is where this codebase keeps design tokens and because a desktop
 * theme can then retune the grid. Layout maths can't read CSS, so
 * the numbers are mirrored here — and
 * `tests/vitest/grid-metrics.test.ts` parses the stylesheet to prove
 * the mirror is faithful. Change one, that test names the other.
 *
 * The CELL is derived, never declared. A gap you can see is the
 * thing worth tuning; the pitch is just tile + gap.
 *
 * **The other half of "one grid" is the reading order.** A canvas
 * reads in columns or in rows ({@link GridOrder}), it picks once, and
 * every path that allocates a cell on it — a drop, a sort, a rescue
 * of tiles that drifted out of view — goes through
 * {@link nextFreeCell} with that order. The desktop turning itself
 * into rows on some page loads and not others was three code paths
 * disagreeing about this: the server packed columns without a bound,
 * the client packed columns with one, and the rescue pass packed
 * rows. Whichever ran last won.
 *
 * `includes/desktop-files/grid.php` is the PHP mirror — same pitch,
 * same fallbacks, same order semantics — and
 * `Tests_OpenStation_DesktopFilesGrid` parses this file to prove it.
 */

/** Gutter from the top / inline-start edge of an icon canvas. */
export const GRID_PADDING = 16;

/**
 * Tile box, and the air around it. Mirrors `--os-tile-*` /
 * `--os-grid-gap-*`.
 *
 * `TILE_H` is a FIXED height, not a minimum: the tile box is what
 * the selection ring is drawn around, so a box that grew with its
 * label would give a row of selected icons a ragged top edge.
 */
export const TILE_W = 88;
export const TILE_H = 104;
export const GRID_GAP_X = 20;
export const GRID_GAP_Y = 16;

/** Image-led sections (`tileSize: 'large'`). Same gaps, bigger tile. */
export const TILE_W_LARGE = 132;
export const TILE_H_LARGE = 160;

export const GRID_CELL_W = TILE_W + GRID_GAP_X;
export const GRID_CELL_H = TILE_H + GRID_GAP_Y;

export const GRID_CELL_W_LARGE = TILE_W_LARGE + GRID_GAP_X;
export const GRID_CELL_H_LARGE = TILE_H_LARGE + GRID_GAP_Y;

/**
 * Cell pitch for an icon canvas, in the shape WP Explorer's
 * layout engine consumes. Exported so that surface reads the same
 * numbers rather than declaring its own.
 *
 * @public
 */
export interface GridMetrics {
	w: number;
	h: number;
	pad: number;
}

/** @public */
export const GRID_METRICS: GridMetrics = {
	w: GRID_CELL_W,
	h: GRID_CELL_H,
	pad: GRID_PADDING,
};

/** @public */
export const GRID_METRICS_LARGE: GridMetrics = {
	w: GRID_CELL_W_LARGE,
	h: GRID_CELL_H_LARGE,
	pad: GRID_PADDING,
};

export interface GridPos {
	col: number;
	row: number;
	x: number;
	y: number;
}

/**
 * Convert raw `(x, y)` into the nearest grid cell, clamped to
 * non-negative columns/rows.
 */
export function pointToCell( x: number, y: number ): GridPos {
	const col = Math.max( 0, Math.round( ( x - GRID_PADDING ) / GRID_CELL_W ) );
	const row = Math.max( 0, Math.round( ( y - GRID_PADDING ) / GRID_CELL_H ) );
	return cellToPos( col, row );
}

/** Build a `GridPos` from a `(col, row)` pair. */
export function cellToPos( col: number, row: number ): GridPos {
	return {
		col,
		row,
		x: GRID_PADDING + col * GRID_CELL_W,
		y: GRID_PADDING + row * GRID_CELL_H,
	};
}

/**
 * Which way a canvas reads.
 *
 * `'column'` fills the first column top-to-bottom then starts the
 * next one — the desktop's convention, and macOS Finder's. `'row'`
 * fills the top row left-to-right then drops to the next — the right
 * order for a folder window, which is wide and short.
 *
 * **An auto-pack must never change a canvas's order.** Repacking is
 * a rescue (a tile drifted out of view, the user asked for a sort);
 * the user reads it as the desktop rearranging itself. One order per
 * canvas, chosen at mount and passed to every allocator call.
 *
 * @public
 */
export type GridOrder = 'column' | 'row';

/**
 * How far a scan runs along the axis it wraps on when the canvas
 * can't be measured — no host, a host that isn't laid out yet, or a
 * caller with no DOM at all (PHP's auto-placer picks slots for a
 * viewport it will never see; `includes/desktop-files/grid.php`
 * mirrors both numbers).
 *
 * The two failure modes are not symmetric, which is why these are
 * deliberately small. Wrapping one cell early costs a column the
 * canvas had room for — the user sees a slightly wider spread and
 * nothing else. Wrapping one cell late puts a tile past the edge of a
 * layer that has no scrollbar, so it isn't below the fold, it is
 * gone. `GRID_FALLBACK_ROWS` fits a 616px canvas — a small laptop
 * with the devtools open — and the measured path takes over the
 * moment there is something to measure.
 */
export const GRID_FALLBACK_ROWS = 5;
export const GRID_FALLBACK_COLS = 4;

/** Rows that fit in `host`, or {@link GRID_FALLBACK_ROWS}. */
export function gridRows( host?: HTMLElement | null ): number {
	const h = host?.clientHeight ?? 0;
	if ( h <= 0 ) {
		// An unmeasurable host is not a one-row host. Reading `0` off
		// a canvas that hasn't been laid out yet and believing it is
		// how a column of icons turns into a row.
		return GRID_FALLBACK_ROWS;
	}
	return Math.max( 1, Math.floor( ( h - GRID_PADDING ) / GRID_CELL_H ) );
}

/** Columns that fit in `host`, or {@link GRID_FALLBACK_COLS}. */
export function gridCols( host?: HTMLElement | null ): number {
	const w = host?.clientWidth ?? 0;
	if ( w <= 0 ) {
		return GRID_FALLBACK_COLS;
	}
	return Math.max( 1, Math.floor( ( w - GRID_PADDING ) / GRID_CELL_W ) );
}

/**
 * Upper bound on a scan's unbounded axis. Packing 999 columns of
 * icons is not a layout, it's a runaway loop.
 */
const SCAN_LIMIT = 999;

/**
 * First empty cell in `order`, wrapping at the canvas's edge.
 *
 * `occupied` is the set of `"<col>,<row>"` keys already in use — the
 * caller builds it from the current placement list, and is free to
 * add each returned cell to keep allocating.
 *
 * The wrap axis is bounded by the canvas ({@link gridRows} for
 * `'column'`, {@link gridCols} for `'row'`) so a tile can never be
 * allocated past the edge of a layer that doesn't scroll. The other
 * axis runs to {@link SCAN_LIMIT}.
 */
export function nextFreeCell(
	occupied: Set< string >,
	order: GridOrder = 'column',
	host?: HTMLElement | null,
): GridPos {
	if ( 'row' === order ) {
		const cols = gridCols( host );
		for ( let row = 0; row < SCAN_LIMIT; row++ ) {
			for ( let col = 0; col < cols; col++ ) {
				if ( ! occupied.has( cellKey( col, row ) ) ) {
					return cellToPos( col, row );
				}
			}
		}
		return cellToPos( 0, 0 );
	}
	const rows = gridRows( host );
	for ( let col = 0; col < SCAN_LIMIT; col++ ) {
		for ( let row = 0; row < rows; row++ ) {
			if ( ! occupied.has( cellKey( col, row ) ) ) {
				return cellToPos( col, row );
			}
		}
	}
	return cellToPos( 0, 0 );
}

/**
 * Consecutive cells for `count` tiles, in `order`, skipping anything
 * `occupied` already holds.
 *
 * The engine behind both bulk layout passes — "sort by name" and the
 * rescue of tiles that drifted off the canvas. They used to carry a
 * copy each of the same allocator loop, which is how one of them
 * ended up row-major on a surface that reads in columns.
 *
 * `occupied` is not mutated; the reserved cells (pinned tiles) stay
 * the caller's to describe.
 */
export function packCells(
	count: number,
	occupied: Set< string >,
	order: GridOrder = 'column',
	host?: HTMLElement | null,
): GridPos[] {
	const taken = new Set( occupied );
	const out: GridPos[] = [];
	for ( let i = 0; i < count; i++ ) {
		const cell = nextFreeCell( taken, order, host );
		taken.add( cellKey( cell.col, cell.row ) );
		out.push( cell );
	}
	return out;
}

/**
 * Snap `(x, y)` to the nearest empty grid cell. When the nearest cell
 * is taken, falls through to {@link nextFreeCell} in the canvas's own
 * `order` — a tile displaced by a collision lands where the next tile
 * would have, not somewhere the canvas doesn't otherwise pack.
 */
export function snapToEmptyCell(
	x: number,
	y: number,
	occupied: Set< string >,
	host?: HTMLElement | null,
	order: GridOrder = 'column',
): GridPos {
	const target = pointToCell( x, y );
	if ( ! occupied.has( cellKey( target.col, target.row ) ) ) {
		return target;
	}
	return nextFreeCell( occupied, order, host );
}

/**
 * Build the occupied-set from a placement list. Anything that
 * hits a grid cell counts; placements positioned off-grid are
 * still recorded against the cell their corner snaps to so
 * a manual position doesn't leave a phantom hole.
 */
export function buildOccupiedSet(
	placements: ReadonlyArray< { x: number; y: number; id: number } >,
	excludeId?: number,
): Set< string > {
	const out = new Set< string >();
	for ( const p of placements ) {
		if ( excludeId !== undefined && p.id === excludeId ) {
			continue;
		}
		const cell = pointToCell( p.x, p.y );
		out.add( cellKey( cell.col, cell.row ) );
	}
	return out;
}

export function cellKey( col: number, row: number ): string {
	return `${ col },${ row }`;
}
