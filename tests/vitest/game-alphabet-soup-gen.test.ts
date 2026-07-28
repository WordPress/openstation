/**
 * Unit tests for Alphabet Soup's seeded grid generation +
 * selection geometry (`src/games/alphabet-soup/soup-gen.ts`).
 */
import { describe, expect, test } from 'vitest';
import { parseDictionary } from '../../src/games/dictionary';
import {
	generateSoup,
	lineCells,
	selectionMatches,
	type SoupGrid,
} from '../../src/games/alphabet-soup/soup-gen';
import {
	mulberry32,
	hash32,
} from '../../src/plugins/living-tree-wallpaper/rng';

// Length-ascending, like the real asset.
const FIXTURE = [
	'note',
	'page',
	'soup',
	'wave',
	'word',
	'broth',
	'ladle',
	'quill',
	'spoon',
	'carrot',
	'letter',
	'noodle',
	'alphabet',
].join( '\n' );

const dictionary = parseDictionary( FIXTURE );

function makeGrid( seed = 'grid-seed' ): SoupGrid {
	return generateSoup( {
		size: 8,
		wordCount: 6,
		minLen: 4,
		maxLen: 8,
		dictionary,
		rng: mulberry32( hash32( seed ) ),
	} );
}

describe( 'alphabet-soup/soup-gen.ts', () => {
	test( 'same seed generates the identical soup — worldwide contract', () => {
		const a = makeGrid();
		const b = makeGrid();
		expect( a.letters ).toEqual( b.letters );
		expect( a.words ).toEqual( b.words );
	} );

	test( 'different seeds generate different soups', () => {
		const a = makeGrid( 'daily-seed' );
		const b = makeGrid( 'time-attack-seed' );
		expect( a.letters ).not.toEqual( b.letters );
	} );

	test( 'places words on the grid along their cells', () => {
		const grid = makeGrid();
		expect( grid.words.length ).toBeGreaterThan( 0 );
		for ( const entry of grid.words ) {
			expect( entry.cells.length ).toBe( entry.word.length );
			const onGrid = entry.cells
				.map( ( cell ) => grid.letters[ cell.row ][ cell.col ] )
				.join( '' );
			expect( onGrid ).toBe( entry.word );
		}
	} );

	test( 'words are unique and inside the length band', () => {
		const grid = makeGrid();
		const words = grid.words.map( ( entry ) => entry.word );
		expect( new Set( words ).size ).toBe( words.length );
		for ( const word of words ) {
			expect( word.length ).toBeGreaterThanOrEqual( 4 );
			expect( word.length ).toBeLessThanOrEqual( 8 );
		}
	} );

	test( 'words never share a cell', () => {
		// Several seeds, so a lucky layout can't mask a crossing.
		for ( const seed of [ 'a', 'b', 'c', 'd', 'e' ] ) {
			const grid = makeGrid( seed );
			const used = new Set< string >();
			for ( const entry of grid.words ) {
				for ( const cell of entry.cells ) {
					const key = `${ cell.row }:${ cell.col }`;
					expect( used.has( key ) ).toBe( false );
					used.add( key );
				}
			}
		}
	} );

	test( 'every cell is filled with a lowercase letter', () => {
		const grid = makeGrid();
		expect( grid.letters.length ).toBe( 8 );
		for ( const row of grid.letters ) {
			expect( row.length ).toBe( 8 );
			for ( const letter of row ) {
				expect( letter ).toMatch( /^[a-z]$/ );
			}
		}
	} );

	test( 'lineCells walks straight and diagonal runs inclusively', () => {
		expect(
			lineCells( { row: 2, col: 1 }, { row: 2, col: 4 }, 8 ),
		).toEqual( [
			{ row: 2, col: 1 },
			{ row: 2, col: 2 },
			{ row: 2, col: 3 },
			{ row: 2, col: 4 },
		] );
		expect(
			lineCells( { row: 0, col: 0 }, { row: 2, col: 2 }, 8 ),
		).toEqual( [
			{ row: 0, col: 0 },
			{ row: 1, col: 1 },
			{ row: 2, col: 2 },
		] );
	} );

	test( 'lineCells snaps a crooked drag to the nearest spoke', () => {
		// 3 right, 1 down is closer to horizontal than diagonal.
		const cells = lineCells( { row: 0, col: 0 }, { row: 1, col: 3 }, 8 );
		expect( cells ).toEqual( [
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
			{ row: 0, col: 2 },
			{ row: 0, col: 3 },
		] );
	} );

	test( 'lineCells returns just the anchor for a zero-length drag', () => {
		expect(
			lineCells( { row: 3, col: 3 }, { row: 3, col: 3 }, 8 ),
		).toEqual( [ { row: 3, col: 3 } ] );
	} );

	test( 'selectionMatches accepts a word forwards and backwards', () => {
		const grid = makeGrid();
		const target = grid.words[ 0 ];
		const index = grid.words.indexOf( target );
		expect( selectionMatches( grid, target.cells ) ).toBe( index );
		expect(
			selectionMatches( grid, target.cells.slice().reverse() ),
		).toBe( index );
	} );

	test( 'selectionMatches rejects non-words and single cells', () => {
		const grid = makeGrid();
		expect( selectionMatches( grid, [ { row: 0, col: 0 } ] ) ).toBe( -1 );
		// A straight run that is (almost surely) not a placed word:
		// build one differing from every placed path.
		const bogus = [
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
		];
		const isPlaced = grid.words.some( ( entry ) => {
			const key = entry.cells
				.map( ( c ) => `${ c.row }:${ c.col }` )
				.join( '|' );
			return (
				key === '0:0|0:1' ||
				key === '0:1|0:0'
			);
		} );
		if ( ! isPlaced ) {
			expect( selectionMatches( grid, bogus ) ).toBe( -1 );
		}
	} );
} );
