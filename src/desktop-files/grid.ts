/**
 * Desktop Mode — Files grid snapping.
 *
 * Tiles align to a column-major grid (top-to-bottom, then
 * left-to-right) so the desktop reads as one tidy surface
 * instead of arbitrary pointer-position coordinates.
 *
 * Geometry:
 *
 *   - GRID_PADDING — gutter from the edge of the host (top + left).
 *   - GRID_CELL_W  — column width  (88px tile + 8px gap).
 *   - GRID_CELL_H  — row height    (~96px tile + 14px gap).
 *
 * The same numbers are baked into `assets/css/desktop-files.css`
 * (the tile width / icon size). Anyone changing one must change
 * the other.
 */

export const GRID_PADDING = 16;
export const GRID_CELL_W = 96;
export const GRID_CELL_H = 110;

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
