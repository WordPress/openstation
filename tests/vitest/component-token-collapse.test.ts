/**
 * Two private aliases in one component must not resolve to the same
 * palette value.
 *
 * `<os-spinner>` drew the WordPress mark over its disc:
 *
 *     --_color:  var( --os-ui-spinner-color,  var( --wp-admin-theme-color, #21759b ) );
 *     --_accent: var( --os-ui-spinner-accent, var( --os-ui-accent,        #fff    ) );
 *
 * Two different fallback literals, so pre-brand the mark read white on
 * a blue disc. The palette then declared BOTH `--wp-admin-theme-color`
 * and `--os-ui-accent` as Pulse — and the mark, painted in the disc's
 * own colour, vanished. The spinner became a plain filled circle and
 * nothing failed: no error, no missing file, just a shape that stopped
 * carrying its meaning.
 *
 * That is the shape this test catches. It resolves each component's
 * `--_*` aliases through the palette and fails when two of them land on
 * the same literal, because a component that paints two things the same
 * colour has almost certainly lost one of them.
 *
 * It is a heuristic, not a law — two aliases CAN legitimately share a
 * value (a border and a divider, say). Those live in ALLOWED below,
 * which doubles as the register of known flattenings.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENTS = join( __dirname, '../../src/ui/components' );
const PALETTE = join( __dirname, '../../assets/css/variables.css' );

/**
 * Known, accepted collapses. Each entry is a component file plus the
 * palette value its aliases share.
 *
 * `--os-ui-surface-elevated` and `--os-ui-border` are both `#33303a`
 * in the palette, so an elevated surface sitting against a hairline
 * loses the hairline. Deliberately recorded rather than silently
 * tolerated: the fix belongs in `variables.css` (one declaration, one
 * owner), not in these components.
 */
const ALLOWED: Record< string, string[] > = {
	'os-table.styles.ts': [ '#33303a' ],
	'os-rating-summary.styles.ts': [ '#33303a' ],
};

/** `--token: value;` pairs declared anywhere in the palette. */
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

/** Every `.styles.ts` under the component kit. */
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
				// The LAST palette token in the chain is the one that
				// actually resolves — earlier ones are per-component
				// opt-ins the palette does not declare.
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
