/**
 * Every icon name the shell asks for must exist in the set.
 *
 * This is a source scan rather than a unit test, and it exists because
 * of how the lookup fails. `osIconSvg( 'trahs' )` does not throw and
 * does not warn: it returns an empty string, and `osIcon` returns an
 * empty `<svg>`. That is the right behaviour at runtime, since a
 * missing glyph is a blemish and an exception inside a render pass
 * takes the whole surface down. It also means a typo ships as a
 * silently invisible button that no other test would notice.
 *
 * Renaming an icon in the brand repository has the same effect on
 * every call site that still uses the old name, which is the case this
 * is really guarding.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { OS_ICON_NAMES } from '../../src/ui/icons';

const SRC = resolve( __dirname, '../../src' );

/** Every `.ts` under `src/`, minus the icon module itself. */
function sourceFiles( dir: string, out: string[] = [] ): string[] {
	for ( const entry of readdirSync( dir ) ) {
		const path = join( dir, entry );
		if ( statSync( path ).isDirectory() ) {
			if ( entry !== 'icons' ) {
				sourceFiles( path, out );
			}
			continue;
		}
		if ( entry.endsWith( '.ts' ) ) {
			out.push( path );
		}
	}
	return out;
}

/** `[ file, name ]` for every literal-named call in the tree. */
function callSites(): Array< [ string, string ] > {
	const found: Array< [ string, string ] > = [];
	for ( const file of sourceFiles( SRC ) ) {
		const text = readFileSync( file, 'utf8' );
		const pattern = /osIcon(?:Svg|DataUri)?\(\s*'([^']+)'/g;
		let match = pattern.exec( text );
		while ( match ) {
			found.push( [ file.slice( SRC.length + 1 ), match[ 1 ] ] );
			match = pattern.exec( text );
		}
	}
	return found;
}

describe( 'icon call sites', () => {
	const sites = callSites();

	test( 'the scan finds the call sites at all', () => {
		// A regex that silently matches nothing would make every
		// assertion below vacuously pass. If the call style changes,
		// this is the test that says so.
		expect( sites.length ).toBeGreaterThan( 20 );
	} );

	test( 'every name asked for exists in the set', () => {
		const known = new Set< string >( OS_ICON_NAMES );
		const unknown = sites.filter( ( [ , name ] ) => ! known.has( name ) );
		expect(
			unknown.map( ( [ file, name ] ) => `${ file }: '${ name }'` ),
			'These names resolve to nothing, so the glyph renders as an ' +
				'empty <svg> with no error. Either the name is a typo, or ' +
				'it was renamed in the brand repository and the call site ' +
				'was not updated.'
		).toEqual( [] );
	} );
} );
