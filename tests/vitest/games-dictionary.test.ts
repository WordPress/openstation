/**
 * Unit tests for the games framework's dictionary parsing + picking
 * (`src/games/dictionary.ts`).
 */
import { describe, expect, test } from 'vitest';
import { parseDictionary } from '../../src/games/dictionary';

/** Deterministic rng cycling through the given values. */
function seededRng( values: number[] ): () => number {
	let i = 0;
	return () => values[ i++ % values.length ];
}

const FIXTURE = [
	'# Attribution header line one',
	'# line two',
	'',
	'cat',
	'dog\r',
	'sun',
	'note',
	'page',
	'paper',
	'quill',
].join( '\n' );

describe( 'games/dictionary.ts', () => {
	test( 'parser skips comments and blanks, trims CRLF', () => {
		const dictionary = parseDictionary( FIXTURE );
		expect( dictionary.size ).toBe( 7 );
		// `dog\r` must have been trimmed to a clean 3-letter word
		// (0.6^1.4 ≈ 0.49 → index 1 of the 3-letter bucket).
		expect( dictionary.pick( 3, 3, seededRng( [ 0.6 ] ) ) ).toBe( 'dog' );
	} );

	test( 'pick respects the length band', () => {
		const dictionary = parseDictionary( FIXTURE );
		for ( const draw of [ 0, 0.3, 0.6, 0.99 ] ) {
			const word = dictionary.pick( 4, 4, seededRng( [ draw ] ) );
			expect( word.length ).toBe( 4 );
		}
		const five = dictionary.pick( 5, 5, seededRng( [ 0.9 ] ) );
		expect( five.length ).toBe( 5 );
	} );

	test( 'an empty band falls back to the whole list', () => {
		const dictionary = parseDictionary( FIXTURE );
		const word = dictionary.pick( 11, 12, seededRng( [ 0 ] ) );
		expect( word ).toBe( 'cat' );
	} );

	test( 'earlier (more frequent) entries are favored', () => {
		// rng^1.4 skews low: a uniform 0.5 draw lands below the
		// midpoint of the bucket.
		const dictionary = parseDictionary( FIXTURE );
		expect( dictionary.pick( 3, 3, seededRng( [ 0.5 ] ) ) ).toBe( 'dog' );
	} );

	test( 'avoidInitials redraws up to three times', () => {
		const dictionary = parseDictionary( FIXTURE );
		// First draw hits 'cat'; the avoid-set forces redraws until a
		// non-c initial comes up.
		const word = dictionary.pick(
			3,
			3,
			seededRng( [ 0, 0, 0.99 ] ),
			new Set( [ 'c' ] ),
		);
		expect( word ).toBe( 'sun' );
	} );

	test( 'deterministic with a seeded rng', () => {
		const dictionary = parseDictionary( FIXTURE );
		const a = dictionary.pick( 3, 5, seededRng( [ 0.42 ] ) );
		const b = dictionary.pick( 3, 5, seededRng( [ 0.42 ] ) );
		expect( a ).toBe( b );
	} );
} );
