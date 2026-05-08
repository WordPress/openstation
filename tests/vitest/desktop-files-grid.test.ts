/**
 * Tests for the desktop-files grid snap helpers.
 */
import { describe, expect, test } from 'vitest';
import {
	buildOccupiedSet,
	cellKey,
	cellToPos,
	GRID_CELL_H,
	GRID_CELL_W,
	GRID_PADDING,
	pointToCell,
	snapToEmptyCell,
} from '../../src/desktop-files/grid';

describe( 'grid', () => {
	test( 'pointToCell rounds to the nearest cell', () => {
		expect( pointToCell( GRID_PADDING, GRID_PADDING ) ).toMatchObject( { col: 0, row: 0 } );
		expect( pointToCell( GRID_PADDING + GRID_CELL_W, GRID_PADDING + GRID_CELL_H ) ).toMatchObject( { col: 1, row: 1 } );
		// Halfway between two cells rounds to the nearer one.
		expect( pointToCell( GRID_PADDING + GRID_CELL_W * 1.49, GRID_PADDING ) ).toMatchObject( { col: 1, row: 0 } );
		expect( pointToCell( GRID_PADDING + GRID_CELL_W * 1.51, GRID_PADDING ) ).toMatchObject( { col: 2, row: 0 } );
	} );

	test( 'cellToPos is the inverse for in-grid points', () => {
		const a = cellToPos( 3, 2 );
		expect( pointToCell( a.x, a.y ) ).toMatchObject( { col: 3, row: 2 } );
	} );

	test( 'snapToEmptyCell uses the target when the cell is free', () => {
		const occupied = new Set< string >();
		const out = snapToEmptyCell( GRID_PADDING + GRID_CELL_W, GRID_PADDING + GRID_CELL_H, occupied );
		expect( out ).toMatchObject( { col: 1, row: 1 } );
	} );

	test( 'snapToEmptyCell finds the next column-major slot when target is occupied', () => {
		const occupied = new Set( [ cellKey( 0, 0 ), cellKey( 0, 1 ) ] );
		const out = snapToEmptyCell( GRID_PADDING, GRID_PADDING, occupied );
		expect( out ).toMatchObject( { col: 0, row: 2 } );
	} );

	test( 'snapToEmptyCell wraps to the next column when host height limits rows', () => {
		const occupied = new Set( [ cellKey( 0, 0 ), cellKey( 0, 1 ) ] );
		const host = document.createElement( 'div' );
		// Height tight enough to allow only 2 rows.
		Object.defineProperty( host, 'clientHeight', {
			value: GRID_PADDING + 2 * GRID_CELL_H,
			configurable: true,
		} );
		const out = snapToEmptyCell( GRID_PADDING, GRID_PADDING, occupied, host );
		expect( out.col ).toBe( 1 );
		expect( out.row ).toBe( 0 );
	} );

	test( 'buildOccupiedSet excludes the moving placement', () => {
		const placements = [
			{ id: 1, x: GRID_PADDING, y: GRID_PADDING },
			{ id: 2, x: GRID_PADDING + GRID_CELL_W, y: GRID_PADDING },
		];
		const set = buildOccupiedSet( placements, 1 );
		expect( set.has( cellKey( 0, 0 ) ) ).toBe( false );
		expect( set.has( cellKey( 1, 0 ) ) ).toBe( true );
	} );
} );
