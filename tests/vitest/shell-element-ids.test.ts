/**
 * The shell's element ids agree across PHP and TypeScript.
 *
 * `openstation_render_shell()` prints a fixed skeleton — the shell
 * root, the wallpaper, the dock, the desktop area, the widget column —
 * and the boot path finds each one by `getElementById`. Nothing binds
 * the two sides together: PHP prints a string, TS reads a string.
 *
 * A mismatch does not throw. `getElementById` returns `null`, the
 * guard around it takes the "not present" branch, and the feature
 * simply never mounts — no error, no console warning, no failing test.
 * That is exactly how the widget column disappeared: the rebrand
 * renamed `desktop-mode-widgets` to `os-widgets` in the markup and
 * left three TS lookups on the old id, so `WidgetLayer` was never
 * constructed and the right-hand column rendered empty on every load.
 *
 * Parsed out of the sources rather than asserted through a running
 * WordPress, because this is a question about two string literals in
 * two languages and neither test suite can see both.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join( __dirname, '../..' );

/**
 * Ids the shell markup renders and the client must be able to find.
 *
 * Deliberately an explicit list rather than "every id in the file":
 * plenty of `getElementById` calls in the client target elements the
 * client itself created (`os-window-links`, per-window nodes), and
 * those have no PHP counterpart to compare against. These five are
 * the server-rendered contract.
 */
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

/** Every `id="…"` the shell template prints. */
const renderedIds = new Set(
	[ ...shellPhp.matchAll( /\bid="([a-z0-9-]+)"/g ) ].map( ( m ) => m[ 1 ] ),
);

/** Recursively collect `src/**\/*.ts`. */
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

/** Every id passed to `getElementById` anywhere in `src/`. */
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
		// The rebrand renamed every `desktop-mode-*` shell element to
		// `os-*`. A lookup still using the old spelling silently
		// resolves to `null` forever.
		const stale = [ ...lookedUpIds ].filter( ( id ) =>
			SHELL_IDS.some(
				( current ) =>
					id === current.replace( /^os-/, 'desktop-mode-' ),
			),
		);
		expect( stale ).toEqual( [] );
	} );
} );
