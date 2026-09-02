/**
 * The Preferences app still applies the class its stylesheet is
 * written for.
 *
 * `os-settings.css` scopes ~150 rules under `.os-settings`. Exactly one
 * template in the app puts that class on its root. The rebrand once
 * renamed the stylesheet and missed the line, and for two releases the
 * whole ruleset matched nothing — nothing failed loudly, because the
 * `<os-*>` components carry their own shadow styles; what went was
 * the layout the document-tree rules contribute. The About tab is
 * where it surfaced: its page takes its height from a
 * `flex: 1; min-height: 0` chain scoped under `.os-settings`, so the
 * journal surface measured zero high and its lazy load never began.
 *
 * A class name is not something a type checker or a linter can pair
 * with a stylesheet, so the pairing is asserted here instead: the
 * selector the CSS uses, and the string the app's root carries, read
 * out of the two files and compared.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join( __dirname, '../..' );
const css = readFileSync( join( root, 'apps/os-settings/os-settings.css' ), 'utf8' );
const entry = readFileSync( join( root, 'apps/os-settings/os-settings.os.ts' ), 'utf8' );

/** The class the frame's root `<div>` carries. */
function appliedClasses(): string[] {
	return Array.from(
		entry.matchAll( /<div class="([\w-]+)">\s*\n\s*<div class="os-settings__search">/g ),
		( m ) => m[ 1 ],
	);
}

describe( 'OS Settings root class', () => {
	test( 'the app applies a class, and the stylesheet uses it', () => {
		const applied = appliedClasses();
		expect( applied ).toEqual( [ 'os-settings' ] );

		for ( const cls of applied ) {
			const used = new RegExp( `\\.${ cls }(?![\\w-])` ).test( css );
			expect(
				used,
				`the app's root wears ".${ cls }" but os-settings.css never selects it`,
			).toBe( true );
		}
	} );

	test( 'the stylesheet has no orphaned root scope of its own', () => {
		// The mirror of the above: a rule scoped under a root class
		// nobody applies is just as dead, and reads as intentional.
		const roots = new Set(
			Array.from(
				css.matchAll( /^\.(os-settings|desktop-mode-os-settings)(?![\w-])/gm ),
				( m ) => m[ 1 ],
			),
		);
		const applied = new Set( appliedClasses() );
		for ( const r of roots ) {
			expect(
				applied.has( r ),
				`os-settings.css scopes rules under ".${ r }" but nothing applies it`,
			).toBe( true );
		}
	} );

	test( "the About tab's height chain is scoped under a live class", () => {
		const applied = appliedClasses();
		const chain = css.match( /\.[\w-]+\s*>\s*os-tabpanel\[\s*for='about'\s*\]/g );
		expect( chain, 'the About tabpanel height rules are still here' ).not.toBeNull();
		for ( const selector of chain ?? [] ) {
			const scope = /^\.([\w-]+)/.exec( selector )?.[ 1 ] ?? '';
			expect( applied ).toContain( scope );
		}
	} );

	test( 'the sheet rides the app, not a shell enqueue', () => {
		// The app's stylesheet resolves by convention (`<dir>/<id>.css`
		// or `<dir>/<file>.css`) and is injected on first open. A
		// registered `os-settings` handle would ship it on every
		// shell boot, for a window most sessions never open.
		const assets = readFileSync( join( root, 'includes/assets.php' ), 'utf8' );
		expect( assets ).not.toMatch( /wp_register_style\(\s*'os-settings'/ );
	} );
} );
