/**
 * One canvas, one reading order.
 *
 * The desktop used to arrive as a row of icons across the top on some
 * page loads and as columns on others. Three allocators disagreed:
 * the server packed columns without a bound, the client packed
 * columns with one, and the out-of-view rescue packed rows. Whichever
 * ran last decided what the user saw, and the rescue ran on every
 * boot — so the verdict flipped as the window height crossed the
 * threshold that made one tile look out of range.
 *
 * These pin the three properties that make that impossible to
 * reintroduce: an order is a property of the canvas, a scan is
 * bounded by the canvas, and an unmeasurable canvas is not a
 * one-cell-tall canvas.
 */
import { describe, expect, test } from 'vitest';
import {
	GRID_CELL_H,
	GRID_CELL_W,
	GRID_FALLBACK_COLS,
	GRID_FALLBACK_ROWS,
	GRID_PADDING,
	cellKey,
	gridCols,
	gridRows,
	nextFreeCell,
	packCells,
	snapToEmptyCell,
} from '../../src/desktop-files/grid';
import { orderForFolder } from '../../src/desktop-files/layer';

/** A host that reports a fixed box, the way a laid-out canvas does. */
function host( width: number, height: number ): HTMLElement {
	const el = document.createElement( 'div' );
	Object.defineProperty( el, 'clientWidth', { value: width } );
	Object.defineProperty( el, 'clientHeight', { value: height } );
	return el;
}

/** Cells for `count` tiles on an empty canvas. */
function pack(
	count: number,
	order: 'column' | 'row',
	el?: HTMLElement | null,
) {
	return packCells( count, new Set< string >(), order, el );
}

describe( 'reading order belongs to the canvas', () => {
	test( 'the desktop root reads in columns, a folder in rows', () => {
		expect( orderForFolder( 0 ) ).toBe( 'column' );
		expect( orderForFolder( 1 ) ).toBe( 'row' );
		expect( orderForFolder( 4291 ) ).toBe( 'row' );
	} );

	test( 'a column-major pack fills a column before starting the next', () => {
		// Tall enough for six rows: 16 + 6 × 120 = 736.
		const cells = pack( 8, 'column', host( 1200, 760 ) );
		expect( cells.map( ( c ) => `${ c.col },${ c.row }` ) ).toEqual( [
			'0,0',
			'0,1',
			'0,2',
			'0,3',
			'0,4',
			'0,5',
			'1,0',
			'1,1',
		] );
	} );

	test( 'a row-major pack fills a row before dropping to the next', () => {
		// Wide enough for four columns: 16 + 4 × 108 = 448.
		const cells = pack( 6, 'row', host( 460, 800 ) );
		expect( cells.map( ( c ) => `${ c.col },${ c.row }` ) ).toEqual( [
			'0,0',
			'1,0',
			'2,0',
			'3,0',
			'0,1',
			'1,1',
		] );
	} );

	test( 'a displaced tile lands where the next tile would have', () => {
		// The bug shape: a collision resolved in the WRONG order puts
		// one tile somewhere the canvas never otherwise packs, and the
		// column the user reads down has a hole in it.
		const occupied = new Set( [ cellKey( 0, 0 ) ] );
		const displaced = snapToEmptyCell(
			GRID_PADDING,
			GRID_PADDING,
			occupied,
			host( 1200, 760 ),
			'column',
		);
		expect( [ displaced.col, displaced.row ] ).toEqual( [ 0, 1 ] );
	} );
} );

describe( 'a scan is bounded by the canvas', () => {
	test( 'a column wraps at the bottom edge rather than running past it', () => {
		const canvas = host( 1200, 400 ); // three rows: 16 + 3 × 120 = 376.
		expect( gridRows( canvas ) ).toBe( 3 );
		const cells = pack( 4, 'column', canvas );
		expect( cells[ 3 ].col ).toBe( 1 );
		expect( cells[ 3 ].row ).toBe( 0 );
		// Nothing allocated past the edge of a layer that can't scroll.
		for ( const cell of cells ) {
			expect( cell.y + GRID_CELL_H ).toBeLessThanOrEqual( 400 );
		}
	} );

	test( 'a row wraps at the trailing edge', () => {
		const canvas = host( 250, 800 ); // two columns: 16 + 2 × 108 = 232.
		expect( gridCols( canvas ) ).toBe( 2 );
		const cells = pack( 3, 'row', canvas );
		expect( [ cells[ 2 ].col, cells[ 2 ].row ] ).toEqual( [ 0, 1 ] );
		for ( const cell of cells ) {
			expect( cell.x + GRID_CELL_W ).toBeLessThanOrEqual( 250 );
		}
	} );
} );

describe( 'an unmeasurable canvas', () => {
	// This is the one that turned a column into a row. A host that
	// isn't laid out yet reports 0, the old scan did
	// `floor( ( 0 - 16 ) / 120 )` clamped up to 1, and a one-row
	// column-major scan IS a row: (0,0), (1,0), (2,0), …
	test( 'falls back to the declared bounds, never to one cell', () => {
		for ( const canvas of [ undefined, null, host( 0, 0 ) ] ) {
			expect( gridRows( canvas ) ).toBe( GRID_FALLBACK_ROWS );
			expect( gridCols( canvas ) ).toBe( GRID_FALLBACK_COLS );
			expect( GRID_FALLBACK_ROWS ).toBeGreaterThan( 1 );
			expect( GRID_FALLBACK_COLS ).toBeGreaterThan( 1 );
		}
	} );

	test( 'still packs a column, not a row', () => {
		const cells = pack( 3, 'column', host( 0, 0 ) );
		expect( cells.map( ( c ) => c.col ) ).toEqual( [ 0, 0, 0 ] );
		expect( cells.map( ( c ) => c.row ) ).toEqual( [ 0, 1, 2 ] );
	} );

	test( 'the fallbacks are small enough to stay on a modest canvas', () => {
		// The asymmetry that sets these numbers: wrapping early costs
		// a column, wrapping late loses a tile. A 616 × 448 canvas is
		// a small laptop with the devtools open.
		const lastRowBottom =
			GRID_PADDING + ( GRID_FALLBACK_ROWS - 1 ) * GRID_CELL_H + GRID_CELL_H;
		const lastColEnd =
			GRID_PADDING + ( GRID_FALLBACK_COLS - 1 ) * GRID_CELL_W + GRID_CELL_W;
		expect( lastRowBottom ).toBeLessThanOrEqual( 616 );
		expect( lastColEnd ).toBeLessThanOrEqual( 448 );
	} );
} );

describe( 'packing respects reserved cells', () => {
	test( 'pinned slots in column 0 are skipped, and not mutated away', () => {
		// `sort` and the rescue both hand the pinned tiles' cells in
		// as reserved; neither may hand one out, and neither may
		// clobber the caller's set.
		const reserved = new Set( [ cellKey( 0, 0 ), cellKey( 0, 1 ) ] );
		const cells = packCells( 3, reserved, 'column', host( 1200, 760 ) );
		expect( cells.map( ( c ) => `${ c.col },${ c.row }` ) ).toEqual( [
			'0,2',
			'0,3',
			'0,4',
		] );
		expect( reserved.size ).toBe( 2 );
	} );

	test( 'nextFreeCell agrees with packCells one cell at a time', () => {
		const occupied = new Set< string >();
		const canvas = host( 1200, 760 );
		const one = [ 0, 1, 2, 3 ].map( () => {
			const cell = nextFreeCell( occupied, 'column', canvas );
			occupied.add( cellKey( cell.col, cell.row ) );
			return `${ cell.col },${ cell.row }`;
		} );
		expect( one ).toEqual(
			pack( 4, 'column', canvas ).map( ( c ) => `${ c.col },${ c.row }` ),
		);
	} );
} );
