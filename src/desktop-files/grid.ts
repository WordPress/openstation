export const GRID_PADDING = 16;

export const TILE_W = 88;
export const TILE_H = 104;
export const GRID_GAP_X = 20;
export const GRID_GAP_Y = 16;

export const TILE_W_LARGE = 132;
export const TILE_H_LARGE = 160;

export const GRID_CELL_W = TILE_W + GRID_GAP_X;
export const GRID_CELL_H = TILE_H + GRID_GAP_Y;

export const GRID_CELL_W_LARGE = TILE_W_LARGE + GRID_GAP_X;
export const GRID_CELL_H_LARGE = TILE_H_LARGE + GRID_GAP_Y;

export interface GridMetrics {
	w: number;
	h: number;
	pad: number;
}

export const GRID_METRICS: GridMetrics = {
	w: GRID_CELL_W,
	h: GRID_CELL_H,
	pad: GRID_PADDING,
};

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

export function pointToCell( x: number, y: number ): GridPos {
	const col = Math.max( 0, Math.round( ( x - GRID_PADDING ) / GRID_CELL_W ) );
	const row = Math.max( 0, Math.round( ( y - GRID_PADDING ) / GRID_CELL_H ) );
	return cellToPos( col, row );
}

export function cellToPos( col: number, row: number ): GridPos {
	return {
		col,
		row,
		x: GRID_PADDING + col * GRID_CELL_W,
		y: GRID_PADDING + row * GRID_CELL_H,
	};
}

export type GridOrder = 'column' | 'row';

export const GRID_FALLBACK_ROWS = 5;
export const GRID_FALLBACK_COLS = 4;

export type GridCanvas =
	| HTMLElement
	| { width: number; height: number }
	| null
	| undefined;

export function canvasSize( canvas: GridCanvas ): { width: number; height: number } {
	if ( ! canvas ) {
		return { width: 0, height: 0 };
	}
	if ( typeof HTMLElement !== 'undefined' && canvas instanceof HTMLElement ) {
		return { width: canvas.clientWidth, height: canvas.clientHeight };
	}
	const c = canvas as { width?: unknown; height?: unknown };
	return {
		width: typeof c.width === 'number' ? c.width : 0,
		height: typeof c.height === 'number' ? c.height : 0,
	};
}

export function gridRows( host?: GridCanvas ): number {
	const h = canvasSize( host ).height;
	if ( h <= 0 ) {
		return GRID_FALLBACK_ROWS;
	}
	return Math.max( 1, Math.floor( ( h - GRID_PADDING ) / GRID_CELL_H ) );
}

export function gridCols( host?: GridCanvas ): number {
	const w = canvasSize( host ).width;
	if ( w <= 0 ) {
		return GRID_FALLBACK_COLS;
	}
	return Math.max( 1, Math.floor( ( w - GRID_PADDING ) / GRID_CELL_W ) );
}

const SCAN_LIMIT = 999;

export function nextFreeCell(
	occupied: Set< string >,
	order: GridOrder = 'column',
	host?: GridCanvas,
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

export function packCells(
	count: number,
	occupied: Set< string >,
	order: GridOrder = 'column',
	host?: GridCanvas,
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

export function snapToEmptyCell(
	x: number,
	y: number,
	occupied: Set< string >,
	host?: GridCanvas,
	order: GridOrder = 'column',
): GridPos {
	const target = pointToCell( x, y );
	if ( ! occupied.has( cellKey( target.col, target.row ) ) ) {
		return target;
	}
	return nextFreeCell( occupied, order, host );
}

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
