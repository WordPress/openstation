/**
 * The two copies of Mio's defaults agree.
 *
 * Mio's shipped look is declared twice: `openstation_mio_config()` in
 * `includes/mio.php` is what the shell serialises into the page, and
 * `MIO_DEFAULTS` in `src/mio/config.ts` is what the client falls back
 * to and what every `sanitize` call clamps against. They are not
 * generated from each other, and there is no runtime moment where a
 * mismatch throws.
 *
 * What a mismatch does instead is worse than a crash: a user who has
 * never opened "Make it yours" sees the PHP value, and the *instant*
 * anything writes a look — one slider, one shape — the client's copy
 * becomes the base for every key they did not touch. Mio silently
 * changes appearance on first save, in whichever keys happen to
 * disagree.
 *
 * Parsed out of the PHP source rather than asserted through a running
 * WordPress, because this is a question about two literals in two
 * files and PHPUnit cannot see the TypeScript one.
 *
 * Only scalars are compared. Colours are `#rrggbb` strings in PHP and
 * packed ints in TS — a deliberate difference, handled at the
 * boundary — so they are checked as a conversion instead.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIO_DEFAULTS } from '../../src/mio/config';

/**
 * The source with every comment removed.
 *
 * Stripped up front, not per block: the file opens with a docblock
 * that spells out the config's shape — `'appearance' => array( radius,
 * bodyColor, … )` — and a search for the array would otherwise land on
 * the description of it rather than the declaration.
 */
const php = readFileSync( join( __dirname, '../../includes/mio.php' ), 'utf8' )
	.replace( /\/\*[\s\S]*?\*\//g, '' )
	.replace( /\/\/[^\n]*/g, '' );

/**
 * The `'key' => value,` pairs inside one array literal in the PHP
 * defaults, keyed by name.
 */
function phpDefaults( block: 'appearance' | 'physics' ): Map< string, string > {
	const start = php.indexOf( `'${ block }'` );
	expect( start, `${ block } block found` ).toBeGreaterThan( -1 );
	// Up to the next top-level key of the same shape, or the end.
	const rest = php.slice( start );
	const end = 'appearance' === block ? rest.indexOf( "'physics'" ) : -1;
	const body = rest.slice( 0, end > 0 ? end : rest.length );

	const out = new Map< string, string >();
	for ( const m of body.matchAll( /'(\w+)'\s*=>\s*([^,\n]+),/g ) ) {
		out.set( m[ 1 ], m[ 2 ].trim() );
	}
	return out;
}

/** PHP literal → the JS value it stands for, or `null` if not a scalar. */
function asScalar( literal: string ): number | boolean | null {
	if ( 'true' === literal ) {
		return true;
	}
	if ( 'false' === literal ) {
		return false;
	}
	const n = Number( literal );
	return Number.isFinite( n ) ? n : null;
}

describe( 'Mio defaults parity (PHP ↔ TypeScript)', () => {
	for ( const block of [ 'appearance', 'physics' ] as const ) {
		test( `every scalar in the PHP \`${ block }\` matches MIO_DEFAULTS`, () => {
			const declared = phpDefaults( block );
			const ts = MIO_DEFAULTS[ block ] as Record< string, unknown >;

			// The parse working at all is part of the guard: a rewrite
			// that changes the array's shape must not leave this test
			// silently comparing nothing.
			expect( declared.size ).toBeGreaterThan( 8 );

			let compared = 0;
			for ( const [ key, literal ] of declared ) {
				if ( ! ( key in ts ) ) {
					continue;
				}
				const value = asScalar( literal );
				if ( null === value ) {
					continue;
				}
				expect( value, `${ block }.${ key }` ).toBe( ts[ key ] );
				compared++;
			}
			expect( compared ).toBeGreaterThan( 8 );
		} );
	}

	test( 'the glow default is the one both files document', () => {
		// Named explicitly because it is the value most recently moved,
		// and because the sweep above would still pass if both files
		// drifted together to something nobody chose.
		expect( MIO_DEFAULTS.appearance.glow ).toBe( 10 );
		expect( phpDefaults( 'appearance' ).get( 'glow' ) ).toBe( '10' );
	} );

	test( 'colours agree across the string/int boundary', () => {
		const declared = phpDefaults( 'appearance' );
		for ( const key of [ 'bodyColor', 'eyeColor' ] as const ) {
			const hex = declared.get( key )?.replace( /['"]/g, '' ) ?? '';
			expect( hex, key ).toMatch( /^#[0-9a-f]{6}$/i );
			expect( Number.parseInt( hex.slice( 1 ), 16 ), key ).toBe(
				MIO_DEFAULTS.appearance[ key ],
			);
		}
	} );
} );
