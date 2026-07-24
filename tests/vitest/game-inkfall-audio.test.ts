/**
 * Unit tests for Inkfall's letter→note mapping
 * (`src/games/inkfall/audio.ts`).
 */
import { describe, expect, test } from 'vitest';
import { letterFrequency } from '../../src/games/inkfall/audio';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split( '' );

describe( 'inkfall/audio.ts — letterFrequency', () => {
	test( 'every letter has a fixed, deterministic frequency', () => {
		for ( const letter of LETTERS ) {
			const first = letterFrequency( letter );
			expect( first ).toBeGreaterThan( 0 );
			expect( letterFrequency( letter ) ).toBe( first );
			// Case-insensitive: K sounds like k.
			expect( letterFrequency( letter.toUpperCase() ) ).toBe( first );
		}
	} );

	test( 'all 26 notes are distinct and ascend alphabetically', () => {
		const frequencies = LETTERS.map( letterFrequency );
		expect( new Set( frequencies ).size ).toBe( 26 );
		for ( let i = 1; i < frequencies.length; i++ ) {
			expect( frequencies[ i ] ).toBeGreaterThan( frequencies[ i - 1 ] );
		}
	} );

	test( 'the range stays musical — G3 up to under ~3.2 kHz', () => {
		expect( letterFrequency( 'a' ) ).toBeCloseTo( 196 );
		for ( const letter of LETTERS ) {
			expect( letterFrequency( letter ) ).toBeLessThan( 3200 );
		}
	} );

	test( 'notes sit on a C-major scale relative to the base', () => {
		// `h` is one octave above `a` (7 scale degrees).
		expect( letterFrequency( 'h' ) ).toBeCloseTo( 196 * 2 );
		// `c` is a major third above `a`.
		expect( letterFrequency( 'c' ) ).toBeCloseTo(
			196 * Math.pow( 2, 4 / 12 ),
		);
	} );

	test( 'non-letters are silent', () => {
		expect( letterFrequency( '1' ) ).toBe( 0 );
		expect( letterFrequency( ' ' ) ).toBe( 0 );
		expect( letterFrequency( 'ab' ) ).toBe( 0 );
		expect( letterFrequency( '' ) ).toBe( 0 );
	} );
} );
