import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS_DIR = join( __dirname, '../../assets/css' );

const ALLOWED = new Map( [
	[
		'desktop-files.css:--os-tile-hover-bg',
		'Pre-brand hover wash on the folder-window tile canvas. Flagged, not fixed: changing a hover wash is a visual decision, not a bug fix.',
	],
	[
		'desktop-files.css:--os-tile-selected-bg',
		'As above — the selection wash on the same canvas.',
	],
] );

function paletteTokens(): Set< string > {
	const src = readFileSync( join( CSS_DIR, 'variables.css' ), 'utf8' );
	return new Set(
		[ ...src.matchAll( /^\s*(--os-[a-z0-9-]+)\s*:/gm ) ].map( ( m ) => m[ 1 ] ),
	);
}

const isColourLiteral = ( value: string ): boolean =>
	/^\s*(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|color-mix\()/i.test( value );

describe( 'palette token reachability in feature stylesheets', () => {
	test( 'no stylesheet pins a palette token to a bare colour literal', () => {
		const palette = paletteTokens();
		const offenders: string[] = [];

		for ( const file of readdirSync( CSS_DIR ) ) {
			if ( ! file.endsWith( '.css' ) || file === 'variables.css' ) {
				continue;
			}
			const src = readFileSync( join( CSS_DIR, file ), 'utf8' );
			for ( const m of src.matchAll( /^\s*(--os-[a-z0-9-]+)\s*:\s*([^;]+);/gm ) ) {
				const [ , name, rawValue ] = m;
				const value = rawValue.trim();
				if ( ! palette.has( name ) ) {
					continue;
				}

				if ( /\bvar\(/.test( value ) || ! isColourLiteral( value ) ) {
					continue;
				}
				const key = `${ file }:${ name }`;
				if ( ALLOWED.has( key ) ) {
					continue;
				}
				offenders.push(
					`${ key } = ${ value }\n` +
						`    ${ name } is declared by variables.css, so this literal makes ` +
						`the palette and every desktop theme unreachable inside that rule.\n` +
						`    Chain through it instead: var( --local-name, var( ${ name }, ${ value } ) )\n` +
						`    — or add the key to ALLOWED in this test with the reason it is deliberate.`,
				);
			}
		}

		expect( offenders.join( '\n\n' ) ).toBe( '' );
	} );

	test( 'the allowlist has no stale entries', () => {
		const palette = paletteTokens();
		const live = new Set< string >();
		for ( const file of readdirSync( CSS_DIR ) ) {
			if ( ! file.endsWith( '.css' ) || file === 'variables.css' ) {
				continue;
			}
			const src = readFileSync( join( CSS_DIR, file ), 'utf8' );
			for ( const m of src.matchAll( /^\s*(--os-[a-z0-9-]+)\s*:\s*([^;]+);/gm ) ) {
				const [ , name, rawValue ] = m;
				const value = rawValue.trim();
				if (
					palette.has( name ) &&
					! /\bvar\(/.test( value ) &&
					isColourLiteral( value )
				) {
					live.add( `${ file }:${ name }` );
				}
			}
		}
		const stale = [ ...ALLOWED.keys() ].filter( ( k ) => ! live.has( k ) );
		expect( stale ).toEqual( [] );
	} );
} );
