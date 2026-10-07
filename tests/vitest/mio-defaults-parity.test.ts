import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIO_DEFAULTS } from '../../src/mio/config';

const php = readFileSync( join( __dirname, '../../includes/mio.php' ), 'utf8' )
	.replace( /\/\*[\s\S]*?\*\//g, '' )
	.replace( /\/\/[^\n]*/g, '' );

function phpDefaults( block: 'appearance' | 'physics' ): Map< string, string > {
	const start = php.indexOf( `'${ block }'` );
	expect( start, `${ block } block found` ).toBeGreaterThan( -1 );

	const rest = php.slice( start );
	const end = 'appearance' === block ? rest.indexOf( "'physics'" ) : -1;
	const body = rest.slice( 0, end > 0 ? end : rest.length );

	const out = new Map< string, string >();
	for ( const m of body.matchAll( /'(\w+)'\s*=>\s*([^,\n]+),/g ) ) {
		out.set( m[ 1 ], m[ 2 ].trim() );
	}
	return out;
}

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
