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

function declared( token: string ): string | null {
	const match = new RegExp( `\\n\\t${ token }:\\s*([^;]+);` ).exec( CSS );
	return match ? match[ 1 ].replace( /\s+/g, ' ' ).trim() : null;
}

describe( 'brand palette', () => {
	test.each( [
		[ '--os-ui-accent', '#f252fc' ],
		[ '--os-ui-accent-strong', '#ec9bff' ],
		[ '--os-ui-surface', '#1a1721' ],
		[ '--os-ui-surface-sunken', '#0c0b0f' ],
		[ '--os-ui-surface-elevated', '#33303a' ],
		[ '--os-ui-fg', '#fffbff' ],
		[ '--os-ui-fg-muted', '#b3afb5' ],
		[ '--os-ui-fg-faint', '#66636b' ],
		[ '--os-ui-border', '#33303a' ],
		[ '--os-ui-border-strong', '#4d4a52' ],
		[ '--os-ui-info-fg', '#c2f1f1' ],

		[ '--os-ui-field-bg', '#33303a' ],
		[ '--os-ui-field-border', '#4d4a52' ],
		[ '--os-ui-field-fg', '#fffbff' ],
		[ '--os-backstop', '#0c0b0f' ],
		[ '--os-window-bg', '#1a1721' ],

		[ '--os-titlebar-bg-focused', '#1a1721' ],
		[ '--os-titlebar-bg', '#0c0b0f' ],
		[ '--os-tabs-bg', '#1a1721' ],
	] )( '%s is %s', ( token, value ) => {
		expect( declared( token ) ).toBe( value );
	} );

	test( 'on-accent text is Starlight, and the bright fills opt out', () => {

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

		expect( CSS ).toContain( 'font-weight: 100 900' );
		expect( declared( '--os-ui-font' ) ).toContain( "'Geist'" );
		expect( declared( '--os-ui-font-mono' ) ).toContain( "'Geist Mono'" );
		expect( declared( '--os-font' ) ).toContain( "'Geist'" );
	} );

	test( 'the palette is scoped to the shell document, not :root', () => {

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

		expect( LEGACY.tokens[ '--os-titlebar-bg-focused' ] ).toBe( '#2271b1' );
		expect( LEGACY.tokens[ '--os-titlebar-color-focused' ] ).toBe( '#fff' );
	} );
} );
