/**
 * The OpenStation palette, asserted against `variables.css`.
 *
 * The shell's look is now a set of declarations in one file, so the
 * things worth pinning are the ones that would break quietly:
 *
 *   1. The brand colours are the ones the guidelines name — a typo in
 *      a hex is invisible in review and wrong forever.
 *   2. Text on a filled accent is Void, not Starlight. Pulse is a
 *      light colour that happens to be vivid; white on it fails
 *      contrast, and the mistake looks fine in a screenshot.
 *   3. The palette is scoped to `body.os-active` — the shell
 *      document only. This file is a dependency of `chromeless.css`,
 *      so on `:root` it would reach inside every iframe window and
 *      repaint WordPress's own admin UI.
 *   4. Legacy actually reverts it. If the two ever agreed on a
 *      value, the theme would have quietly become a no-op again.
 *
 * Asserted against the stylesheet text because the rules live in
 * plain CSS with no module to import, and jsdom does not resolve a
 * `var()` chain against a stylesheet it never loaded.
 *
 * Brand reference: https://nuriapenya.github.io/open-station-brand/
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const CSS = readFileSync( resolve( ROOT, 'assets/css/variables.css' ), 'utf8' );
const LEGACY = JSON.parse(
	readFileSync(
		resolve( ROOT, 'assets/desktop-themes/legacy/theme.json' ),
		'utf8'
	)
) as { tokens: Record< string, string > };

/** The value `variables.css` declares for a token, whitespace-flattened. */
function declared( token: string ): string | null {
	const match = new RegExp( `\\n\\t${ token }:\\s*([^;]+);` ).exec( CSS );
	return match ? match[ 1 ].replace( /\s+/g, ' ' ).trim() : null;
}

describe( 'brand palette', () => {
	test.each( [
		[ '--os-ui-accent', '#f252fc' ], // Pulse
		[ '--os-ui-accent-strong', '#ec9bff' ], // Nebula
		[ '--os-ui-surface', '#1a1721' ], // Obsidian
		[ '--os-ui-surface-sunken', '#0c0b0f' ], // Void
		[ '--os-ui-surface-elevated', '#33303a' ], // Astro
		[ '--os-ui-fg', '#fffbff' ], // Starlight
		[ '--os-ui-fg-muted', '#b3afb5' ], // Ash
		[ '--os-ui-fg-faint', '#66636b' ], // Pewter
		[ '--os-ui-border', '#33303a' ], // Astro
		[ '--os-ui-border-strong', '#4d4a52' ], // Silver
		[ '--os-ui-info-fg', '#c2f1f1' ], // Sirius
		// Light-DOM field surface. Not a shade of its own — a plugin's
		// plain `<input>` should read as the same recessed step the
		// kit's own controls sit on, which is Astro.
		[ '--os-ui-field-bg', '#33303a' ], // Astro
		[ '--os-ui-field-border', '#4d4a52' ], // Silver
		[ '--os-ui-field-fg', '#fffbff' ], // Starlight
		[ '--os-backstop', '#0c0b0f' ], // Void
		[ '--os-window-bg', '#1a1721' ], // Obsidian
		// Window chrome sits one step lower than it used to: a focused
		// title bar and its tab strip are the SAME Obsidian, so the
		// only thing lifting out of that surface is the active tab.
		// Unfocused sinks to Void — the step is the same size, the
		// whole ramp moved.
		[ '--os-titlebar-bg-focused', '#1a1721' ], // Obsidian
		[ '--os-titlebar-bg', '#0c0b0f' ], // Void
		[ '--os-tabs-bg', '#1a1721' ], // Obsidian
	] )( '%s is %s', ( token, value ) => {
		expect( declared( token ) ).toBe( value );
	} );

	test( 'on-accent text is Starlight, and the bright fills opt out', () => {
		// Around forty rules read `--os-ui-fg-on-accent`, and only half
		// sit on the accent — the rest are white-on-dark chips with no
		// name of their own (toast, drag hint, widget picker, file-tile
		// lock, overview labels, scrim-backed captions). Void reads
		// better ON Pulse and turns every one of those into black text
		// on a near-black wash, so Starlight wins and the surfaces that
		// really are a bright fill name their own dark text.
		expect( declared( '--os-ui-fg-on-accent' ) ).toBe( '#fffbff' );
		expect( declared( '--os-ui-ribbon-fg' ) ).toBe( '#0c0b0f' );
		expect( declared( '--os-ui-step-chip-fg' ) ).toBe( '#0c0b0f' );
	} );

	test( 'the desk is the brand Space gradient', () => {
		const bg = declared( '--os-bg' ) ?? '';

		expect( bg ).toContain( '#010101' );
		expect( bg ).toContain( '#111114' );
		expect( bg ).toContain( '#1e1d23' );
	} );

	test( 'both typefaces are declared and self-hosted', () => {
		expect( CSS ).toContain( "url('../fonts/Geist-Variable.woff2')" );
		expect( CSS ).toContain( "url('../fonts/GeistMono-Variable.woff2')" );
		// Variable fonts: one file has to cover the whole scale, or the
		// weights in the type ramp synthesise into fake bolds.
		expect( CSS ).toContain( 'font-weight: 100 900' );
		expect( declared( '--os-ui-font' ) ).toContain( "'Geist'" );
		expect( declared( '--os-ui-font-mono' ) ).toContain( "'Geist Mono'" );
		expect( declared( '--os-font' ) ).toContain( "'Geist'" );
	} );

	test( 'the palette is scoped to the shell document, not :root', () => {
		// THE iframe guard. This stylesheet is a dependency of
		// `chromeless.css`, so it also loads inside every iframe
		// window — a real wp-admin document. On `:root` the palette
		// would repaint WordPress's own UI in there;
		// `--wp-admin-theme-color` alone would turn Core's primary
		// buttons, links and focus rings across every admin screen.
		// Chromeless documents carry `os-chromeless`, so
		// they match nothing here and fall back to the literals.
		expect( CSS ).toContain( 'body.os-active {' );
		expect( CSS ).not.toMatch( /^:root\s*\{/m );

		const block = CSS.slice(
			CSS.indexOf( 'body.os-active {' ),
			CSS.indexOf( '\n}\n', CSS.indexOf( 'body.os-active {' ) )
		);
		expect( block ).toContain( '--os-ui-accent: #f252fc' );
		expect( block ).toContain( '--os-ui-surface: #1a1721' );
		expect( block ).toContain( '--wp-admin-theme-color: #f252fc' );
	} );

	test( 'nothing but the per-scheme accent is scoped to the shell root', () => {
		// The palette has to reach body-mounted overlays — toasts,
		// context menus, the command palette — which render outside
		// `#os-shell`. A `--os-ui-*` declaration on the shell
		// root would miss all of them.
		expect( CSS ).not.toMatch( /\.os-shell\[[^\]]*\]\s*\{[^}]*--os-ui-/ );
	} );
} );

describe( 'Legacy still reverts the brand', () => {
	test.each( [
		'--os-ui-accent',
		'--os-ui-surface',
		'--os-ui-fg',
		'--os-ui-border',
		'--os-window-bg',
		'--os-titlebar-bg',
		'--os-titlebar-bg-focused',
		'--os-dock-bg',
	] )( '%s differs between the palette and the snapshot', ( token ) => {
		const now = declared( token );
		const then = LEGACY.tokens[ token ];

		expect( then, `${ token } is missing from the Legacy snapshot` ).toBeTruthy();
		expect(
			then?.replace( /\s+/g, '' ).toLowerCase()
		).not.toBe( now?.replace( /\s+/g, '' ).toLowerCase() );
	} );

	test( 'the focused title bar goes back to WordPress blue', () => {
		// The one everybody recognises. It used to resolve through
		// `--wp-admin-theme-color`, which the manifest grammar cannot
		// express — so the snapshot has to name the literal or the
		// title bar silently keeps the station's Astro grey.
		expect( LEGACY.tokens[ '--os-titlebar-bg-focused' ] ).toBe( '#2271b1' );
		expect( LEGACY.tokens[ '--os-titlebar-color-focused' ] ).toBe( '#fff' );
	} );
} );
