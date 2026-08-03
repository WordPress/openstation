/**
 * `:host` must not block the palette.
 *
 * A custom property declared on `:host` matches the host ELEMENT, and
 * a declaration matching the element always beats a value the element
 * would otherwise INHERIT. The palette declares on
 * `body.desktop-mode-active`; a desktop theme declares on
 * `body.desktop-mode-desktop-theme-<slug>`. Both are ancestors. So
 *
 *     :host { --wpd-table-bg: var( --wpd-surface, #fff ); }
 *
 * does not read as "default to the surface colour" — it reads as
 * "`--wpd-table-bg` can never be set from outside this element again",
 * and the theme's declaration is dead. `<wpd-table>`, `<wpd-modal>`,
 * `<wpd-progress-bar>` and `<wpd-spinner>` between them pinned
 * eighteen names this way, every one of which the Legacy snapshot
 * carries and none of which reached its component.
 *
 * The fix is to read the public token INTO a private alias:
 *
 *     :host { --_bg: var( --wpd-table-bg, var( --wpd-surface, #fff ) ); }
 *
 * With no declaration on the host to find, the `var()` resolves the
 * inherited value — theme first, palette next, the pre-brand literal
 * last — and per-instance overrides in the document tree keep working
 * exactly as before.
 *
 * This test pins that shape. It reads the BARE `:host {` block only:
 * state modifiers (`:host( [ compact ] )`, `:host( [ tone='danger' ] )`,
 * `:host( [ preset='inline' ] )`) are a consumer asking for something
 * explicitly, and those deliberately keep declaring the public token so
 * a document-tree rule still outranks them.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const COMPONENTS = resolve( ROOT, 'src/ui/components' );

/** Every token name a desktop theme is allowed to set. */
const THEMED: ReadonlySet< string > = new Set(
	Object.keys(
		(
			JSON.parse(
				readFileSync(
					resolve( ROOT, 'assets/desktop-themes/legacy/theme.json' ),
					'utf8'
				)
			) as { tokens: Record< string, string > }
		).tokens
	)
);

/**
 * `<wpd-modal>` is the one deliberate opt-out, and it is an opt-out
 * from the VALUE, not from reachability. Its dialog surface is dark
 * whatever the admin colour scheme says, so following `--wpd-fg` would
 * put the light scheme's near-black text on a near-black dialog. It
 * re-points these four — but through `--wpd-modal-*` names the palette
 * declares, so the station still owns the dialog. Anything added here
 * needs the same: a palette-owned token on the right-hand side.
 */
const OPT_OUT: Readonly< Record< string, readonly string[] > > = {
	'wpd-modal': [
		'--wpd-fg',
		'--wpd-fg-muted',
		'--wpd-border',
		'--desktop-mode-window-bg',
	],
};

/** The bare `:host { … }` block — no attribute selector, no `::part`. */
function bareHostBlock( css: string ): string {
	const start = css.search( /:host\s*\{/ );
	if ( start === -1 ) {
		return '';
	}
	const open = css.indexOf( '{', start );
	const close = css.indexOf( '\n\t}', open );
	return close === -1 ? css.slice( open ) : css.slice( open, close );
}

/** `--token: value;` pairs, comments stripped, whitespace flattened. */
function declarations( block: string ): Array< [ string, string ] > {
	const clean = block.replace( /\/\*[\s\S]*?\*\//g, '' );
	const out: Array< [ string, string ] > = [];
	const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
	let m: RegExpExecArray | null;
	while ( ( m = re.exec( clean ) ) !== null ) {
		out.push( [ m[ 1 ], m[ 2 ].replace( /\s+/g, ' ' ).trim() ] );
	}
	return out;
}

const files = readdirSync( COMPONENTS, { withFileTypes: true } )
	.filter( ( e ) => e.isDirectory() )
	.flatMap( ( dir ) =>
		readdirSync( resolve( COMPONENTS, dir.name ) )
			.filter( ( f ) => f.endsWith( '.styles.ts' ) )
			.map( ( f ) => [ dir.name, resolve( COMPONENTS, dir.name, f ) ] as const )
	);

describe( 'components do not block themed tokens on :host', () => {
	test( 'the component sweep found styles to check', () => {
		// Guards the guard: a rename under src/ui/components/ that made
		// the glob match nothing would turn every assertion below into a
		// silent pass.
		expect( files.length ).toBeGreaterThan( 30 );
		expect( THEMED.size ).toBeGreaterThan( 300 );
	} );

	test.each( files )( '%s', ( component, path ) => {
		const allowed = OPT_OUT[ component ] ?? [];
		const blocked = declarations( bareHostBlock( readFileSync( path, 'utf8' ) ) )
			.filter( ( [ token ] ) => THEMED.has( token ) )
			.filter( ( [ token ] ) => ! allowed.includes( token ) )
			// Reading the token back into itself is the whole point of
			// the alias pattern and is what makes it reachable.
			.filter( ( [ token, value ] ) => ! value.includes( `var( ${ token },` ) )
			.map( ( [ token ] ) => token );

		expect(
			blocked,
			`${ component } declares ${ blocked.join(
				', '
			) } on :host, which makes ${
				blocked.length === 1 ? 'it' : 'them'
			} unreachable from the palette and from every desktop theme. ` +
				'Read the public token into a private --_alias instead.'
		).toEqual( [] );
	} );
} );
