import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve( __dirname, '../..' );

function walk( dir: string ): string[] {
	return readdirSync( dir ).flatMap( ( name ) => {
		const path = join( dir, name );
		if ( statSync( path ).isDirectory() ) {
			return walk( path );
		}
		return [ path ];
	} );
}

const REAL_TOKENS = new Set( [
	'--wp-admin-theme-color',
	'--wp-admin-theme-color-darker-10',
	'--wp-admin-theme-color-darker-20',
] );

describe( 'theming token usage', () => {
	test( 'no var() reads a --wp-admin-theme-* name WordPress never defines', () => {
		const files = [
			...walk( join( ROOT, 'src' ) ).filter( ( f ) => f.endsWith( '.ts' ) ),
			...readdirSync( join( ROOT, 'assets/css' ) )
				.filter( ( f ) => f.endsWith( '.css' ) )
				.map( ( f ) => join( ROOT, 'assets/css', f ) ),
		];

		const offenders: string[] = [];
		for ( const file of files ) {
			const source = readFileSync( file, 'utf8' );
			for ( const match of source.matchAll(
				/var\(\s*(--wp-admin-theme-[a-z0-9-]*)/g,
			) ) {
				if ( ! REAL_TOKENS.has( match[ 1 ] ) ) {
					const line =
						source.slice( 0, match.index ).split( '\n' ).length;
					offenders.push(
						`${ file.slice( ROOT.length + 1 ) }:${ line } → ${ match[ 1 ] }`,
					);
				}
			}
		}

		expect(
			offenders,
			'These var() reads name --wp-admin-theme-* tokens that nothing defines — they resolve their fallback literal on every desktop theme. Use the matching --os-ui-* token (with the pre-brand literal as the fallback) instead:\n' +
				offenders.join( '\n' ),
		).toEqual( [] );
	} );
} );
