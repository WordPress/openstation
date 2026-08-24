/**
 * Phantom theming tokens are unreachable by every desktop theme.
 *
 * WordPress ships exactly one custom-property family for the admin
 * accent: `--wp-admin-theme-color` (plus its `-darker-10` /
 * `-darker-20` shades). Names like `--wp-admin-theme-bg`,
 * `--wp-admin-theme-border` or `--wp-admin-theme-fg-muted` LOOK like
 * the same family but are defined by nothing — not by Core, not by
 * the palette, not by any desktop theme. A `var()` on one of them
 * silently resolves its fallback literal forever, which is how the
 * Profile window's identity card and the colour-scheme tiles stayed
 * light — with theme-following text on top of them — on every dark
 * desktop theme.
 *
 * The rule (see AGENTS.md, "The palette lives in variables.css"):
 * surfaces read `--os-ui-*` tokens with the pre-brand literal as the
 * fallback. This test holds the whole source tree and every
 * hand-written stylesheet to it for the wp-admin-theme family.
 */
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

/** The only members of the family WordPress actually defines. */
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
