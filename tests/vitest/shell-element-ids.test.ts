import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join( __dirname, '../..' );

const SHELL_IDS = [
	'os-shell',
	'os-wallpaper',
	'os-dock',
	'os-area',
	'os-widgets',
] as const;

const shellPhp = readFileSync(
	join( ROOT, 'includes/render/shell.php' ),
	'utf8',
);

const renderedIds = new Set(
	[ ...shellPhp.matchAll( /\bid="([a-z0-9-]+)"/g ) ].map( ( m ) => m[ 1 ] ),
);

function collectSources( dir: string, out: string[] = [] ): string[] {
	for ( const entry of readdirSync( dir ) ) {
		const full = join( dir, entry );
		if ( statSync( full ).isDirectory() ) {
			collectSources( full, out );
		} else if ( entry.endsWith( '.ts' ) ) {
			out.push( full );
		}
	}
	return out;
}

const sources = collectSources( join( ROOT, 'src' ) ).map( ( file ) => ( {
	file,
	text: readFileSync( file, 'utf8' ),
} ) );

const lookedUpIds = new Set< string >();
for ( const { text } of sources ) {
	for ( const m of text.matchAll(
		/getElementById\(\s*'([^']+)'\s*\)/g,
	) ) {
		lookedUpIds.add( m[ 1 ] );
	}
}

describe( 'shell element ids', () => {
	test.each( SHELL_IDS )( '`%s` is rendered by the shell template', ( id ) => {
		expect( renderedIds.has( id ) ).toBe( true );
	} );

	test.each( SHELL_IDS )( '`%s` is looked up by the client', ( id ) => {
		expect( lookedUpIds.has( id ) ).toBe( true );
	} );

	test( 'no client lookup targets a pre-rebrand shell id', () => {

		const stale = [ ...lookedUpIds ].filter( ( id ) =>
			SHELL_IDS.some(
				( current ) =>
					id === current.replace( /^os-/, 'desktop-mode-' ),
			),
		);
		expect( stale ).toEqual( [] );
	} );
} );
