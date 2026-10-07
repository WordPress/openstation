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

function host( width: number, height: number ): HTMLElement {
	const el = document.createElement( 'div' );
	Object.defineProperty( el, 'clientWidth', { value: width } );
	Object.defineProperty( el, 'clientHeight', { value: height } );
	return el;
}

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
		const canvas = host( 1200, 400 );
		expect( gridRows( canvas ) ).toBe( 3 );
		const cells = pack( 4, 'column', canvas );
		expect( cells[ 3 ].col ).toBe( 1 );
		expect( cells[ 3 ].row ).toBe( 0 );

		for ( const cell of cells ) {
			expect( cell.y + GRID_CELL_H ).toBeLessThanOrEqual( 400 );
		}
	} );

	test( 'a row wraps at the trailing edge', () => {
		const canvas = host( 250, 800 );
		expect( gridCols( canvas ) ).toBe( 2 );
		const cells = pack( 3, 'row', canvas );
		expect( [ cells[ 2 ].col, cells[ 2 ].row ] ).toEqual( [ 0, 1 ] );
		for ( const cell of cells ) {
			expect( cell.x + GRID_CELL_W ).toBeLessThanOrEqual( 250 );
		}
	} );
} );

describe( 'an unmeasurable canvas', () => {

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
