import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENTS = join( __dirname, '../../src/ui/components' );
const PALETTE = join( __dirname, '../../assets/css/variables.css' );

const ALLOWED: Record< string, string[] > = {
	'os-table.styles.ts': [ '#33303a' ],
	'os-rating-summary.styles.ts': [ '#33303a' ],
};

function palette(): Map< string, string > {
	const css = readFileSync( PALETTE, 'utf8' );
	const out = new Map< string, string >();
	for ( const m of css.matchAll( /^\s*(--[a-z0-9-]+):\s*([^;]+);/gm ) ) {
		if ( ! out.has( m[ 1 ] ) ) {
			out.set( m[ 1 ], m[ 2 ].trim().toLowerCase() );
		}
	}
	return out;
}

function styleFiles(): string[] {
	return readdirSync( COMPONENTS, { withFileTypes: true } )
		.filter( ( e ) => e.isDirectory() )
		.flatMap( ( e ) =>
			readdirSync( join( COMPONENTS, e.name ) )
				.filter( ( f ) => f.endsWith( '.styles.ts' ) )
				.map( ( f ) => join( COMPONENTS, e.name, f ) ),
		);
}

describe( 'component private aliases do not collapse onto one palette value', () => {
	const pal = palette();
	const isColor = ( v: string ) => /^#[0-9a-f]{3,8}$/.test( v );

	for ( const file of styleFiles() ) {
		const name = file.split( '/' ).pop() as string;

		it( `${ name } paints distinct things in distinct colours`, () => {
			const css = readFileSync( file, 'utf8' );
			const byValue = new Map< string, string[] >();

			for ( const m of css.matchAll(
				/(--_[a-z0-9-]+):\s*var\(([\s\S]*?)\);/g,
			) ) {

				const chain = [ ...m[ 2 ].matchAll( /--[a-z0-9-]+/g ) ]
					.map( ( t ) => t[ 0 ] )
					.filter( ( t ) => pal.has( t ) );
				if ( ! chain.length ) {
					continue;
				}
				const value = pal.get( chain[ chain.length - 1 ] ) as string;
				if ( ! isColor( value ) ) {
					continue;
				}
				byValue.set( value, [ ...( byValue.get( value ) ?? [] ), m[ 1 ] ] );
			}

			const allowed = ALLOWED[ name ] ?? [];
			const collapsed = [ ...byValue.entries() ]
				.filter( ( [ v, names ] ) => names.length > 1 && ! allowed.includes( v ) )
				.map( ( [ v, names ] ) => `${ names.join( ' + ' ) } all resolve to ${ v }` );

			expect( collapsed ).toEqual( [] );
		} );
	}
} );
