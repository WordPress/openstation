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
 * Snap `(x, y)` to the nearest empty grid cell. If the nearest
 * cell is occupied, scans column-major (down each column then
 * across) for the first empty one — same convention macOS
 * Finder uses for "Clean Up".
 *
 * `occupied` is the set of `"<col>,<row>"` strings already in
 * use; the caller is responsible for building it from the
 * current placement list.
 *
 * `host` is optional — when provided, the scan respects the
 * host's height so tiles wrap to a new column when the bottom
 * is hit. Without it, columns extend infinitely (which is
 * fine for desktop windows that don't have a definite height).
 */
export function snapToEmptyCell(
	x: number,
	y: number,
	occupied: Set< string >,
	host?: HTMLElement | null,
): GridPos {
	const target = pointToCell( x, y );
	if ( ! occupied.has( cellKey( target.col, target.row ) ) ) {
		return target;
	}

	const maxRows = host
		? Math.max( 1, Math.floor( ( host.clientHeight - GRID_PADDING ) / GRID_CELL_H ) )
		: 999;

	// Column-major scan starting at column 0 — guarantees
	// deterministic packing regardless of where the user
	// dropped the new tile.
	for ( let col = 0; col < 999; col++ ) {
		for ( let row = 0; row < maxRows; row++ ) {
			if ( ! occupied.has( cellKey( col, row ) ) ) {
				return cellToPos( col, row );
			}
		}
	}
	// Fallback: target cell anyway. Should be unreachable
	// unless the desktop has 999 × 999 placements.
	return target;
}

/**
 * Find the first empty grid cell in row-major order — fills row 0
 * across all columns first, then row 1, etc. This is the right pack
 * order for "drop a new shortcut into a folder" because new tiles
 * land at the TOP of the visible canvas instead of piling down
 * column 0 (where they may fall below a short folder window's
 * fold). `cols` defaults to 4 when no host is supplied.
 *
 * Different from {@link snapToEmptyCell}, which is column-major and
 * is the right order for "clean up" / sort. Both share the
 * `cellKey()` occupancy convention.
 */
export function nextRowMajorCell(
	occupied: Set< string >,
	host?: HTMLElement | null,
): GridPos {
	const cols = host
		? Math.max(
			1,
			Math.floor( ( host.clientWidth - GRID_PADDING ) / GRID_CELL_W ),
		)
		: 4;
	const maxCols = Math.max( 1, cols );
	for ( let row = 0; row < 999; row++ ) {
		for ( let col = 0; col < maxCols; col++ ) {
			if ( ! occupied.has( cellKey( col, row ) ) ) {
				return cellToPos( col, row );
			}
		}
	}
	return cellToPos( 0, 0 );
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
