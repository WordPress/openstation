/**
 * OS Settings still applies the class its stylesheet is written for.
 *
 * `os-settings.css` scopes ~150 rules under `.os-settings`. Exactly one
 * line of TypeScript puts that class on the panel body. The rebrand
 * renamed the stylesheet and missed the line, and for two releases the
 * whole ruleset matched nothing.
 *
 * **Nothing failed loudly.** The `<os-*>` components carry their own
 * shadow styles, so the panel still looked broadly right; what went
 * was the layout the document-tree rules contribute. The About tab is
 * where it surfaced: its PixiJS canvas takes its height from a
 * `flex: 1; min-height: 0` chain whose first two links —
 * `os-tabpanel[for='about']` and the `os-panel` inside it — are scoped
 * under `.os-settings`. With those dead the stage host measured zero
 * high, and `waitForSize()` waited for a box that was never coming. It
 * has no timeout on purpose (a hidden tabpanel can legitimately take a
 * while to get a size), so the scene neither mounted nor errored. It
 * just wasn't there.
 *
 * A class name is not something a type checker or a linter can pair
 * with a stylesheet, so the pairing is asserted here instead: the
 * selector the CSS uses, and the string the panel adds, read out of
 * the two files and compared.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join( __dirname, '../..' );
const css = readFileSync( join( root, 'assets/css/os-settings.css' ), 'utf8' );
const panel = readFileSync( join( root, 'src/settings/panel.ts' ), 'utf8' );

/** Every class the panel body is given, in source order. */
function appliedClasses(): string[] {
	return Array.from(
		panel.matchAll( /body\.classList\.add\(\s*'([\w-]+)'\s*\)/g ),
		( m ) => m[ 1 ],
	);
}

describe( 'OS Settings root class', () => {
	test( 'the panel applies a class, and the stylesheet uses it', () => {
		const applied = appliedClasses();
		expect( applied.length ).toBeGreaterThan( 0 );

		for ( const cls of applied ) {
			// Somewhere in the stylesheet, as a selector — `.name`
			// followed by anything that can end a class name.
			const used = new RegExp( `\\.${ cls }(?![\\w-])` ).test( css );
			expect(
				used,
				`panel.ts adds ".${ cls }" but os-settings.css never selects it`,
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
		// The specific chain the PixiJS scene needs. If these stop
		// being scoped under the applied root — or the root moves
		// again — the canvas goes back to measuring zero and the scene
		// silently disappears.
		const applied = appliedClasses();
		const chain = css.match(
			/\.[\w-]+\s*>\s*os-tabpanel\[\s*for='about'\s*\]/g,
		);
		expect( chain, 'the About tabpanel height rules are still here' )
			.not.toBeNull();
		for ( const selector of chain ?? [] ) {
			const scope = /^\.([\w-]+)/.exec( selector )?.[ 1 ] ?? '';
			expect( applied ).toContain( scope );
		}
	} );
} );
