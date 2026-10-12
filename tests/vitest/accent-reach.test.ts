/**
 * The accent marks state; it never decorates.
 *
 * `--os-ui-accent` is Pulse, and the default theme stopped wearing it
 * on every surface so it would mean something again: a checked
 * control, the row you are on, the dock dividers, icons. Everything
 * else shows selection through contrast and depth, and instruction
 * UI is neutral. See AGENTS.md, "The accent marks state; it never
 * decorates".
 *
 * This is the guard for the failure mode that rule came from: a NEW
 * component reaching for the accent because it is the brand colour.
 * The shell tour's coachmark did exactly that — a pulsing pink ring,
 * a pink counter and a pink button — on a branch that predated the
 * rule and merged after it, and nothing failed.
 *
 * Every kit style file that reads `--os-ui-accent*` has to be listed
 * below with the state it marks. A new reader fails until someone
 * writes that line down, which is the moment to ask whether the
 * surface should be neutral instead, or read the accent through a
 * literal "how much" token in variables.css (the pattern of
 * `--os-ui-segmented-selected-accent`) so the palette can quiet it.
 * A listed file that stops reading the accent fails too, so the list
 * cannot rot.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const COMPONENTS = resolve( ROOT, 'src/ui/components' );
const HOLO = resolve( ROOT, 'src/ui/holo.ts' );

/** Every accent token: the base, and -dim, -strong, -soft, -ink. */
const ACCENT = /--os-ui-accent(?:-[a-z]+)?\b/g;

/**
 * Who reads the accent, how many times, and the state each read marks.
 * Focus rings are allowed everywhere (focus does not dim and does not
 * go neutral); the rest is a control that is ON, the ink on an accent
 * fill, or a read already routed through a "how much" token.
 *
 * The count is the point: a component already listed for its focus
 * ring could otherwise grow a decorative read unnoticed, which is how
 * the coachmark would have passed. One more read means one more line
 * of reasoning here.
 */
const ALLOWED: Readonly< Record< string, { reads: number; marks: string } > > = {
	holo: { reads: 7, marks: 'the checked fill of form controls and the ink on it, the field focus border, and the press ring (through the dim token)' },
	'os-button': { reads: 1, marks: 'the label ink on an accent-filled primary button' },
	'os-category-picker': { reads: 2, marks: 'the ink on a checked row\'s accent fill' },
	'os-chip': { reads: 1, marks: 'the chip wash, the soft accent' },
	'os-coachmark': { reads: 1, marks: 'the card\'s focus ring only; the ring, counter and button are neutral' },
	'os-confirm-dialog': { reads: 2, marks: 'the native checkbox\'s accent-color and the ink on the confirm button' },
	'os-disclosure': { reads: 1, marks: 'the focus ring' },
	'os-histogram': { reads: 2, marks: 'the focus ring and the default series tone' },
	'os-menu': { reads: 1, marks: 'the focus ring on an item' },
	'os-multiselect': { reads: 1, marks: 'the open / focused border' },
	'os-notice': { reads: 3, marks: 'the info tone\'s icon and link colour' },
	'os-range-field': { reads: 4, marks: 'the elapsed track and the thumb: a control that is on' },
	'os-repeater': { reads: 1, marks: 'the focus ring' },
	'os-role-picker': { reads: 1, marks: 'the ink on a checked role\'s fill' },
	'os-segmented': { reads: 2, marks: 'the selected key, mixed by --os-ui-segmented-selected-accent, and its ink' },
	'os-select': { reads: 5, marks: 'the focus border, and the selected option\'s fill and ink' },
	'os-split': { reads: 2, marks: 'the divider while it is dragged, and its focus ring' },
	'os-swatch': { reads: 2, marks: 'the focus ring, and the chosen tile\'s ring, sized by --os-ui-swatch-ring-width' },
	'os-switch': { reads: 2, marks: 'the on track' },
	'os-tab-chip': { reads: 3, marks: 'the active chip\'s colour and wash' },
	'os-table': { reads: 6, marks: 'the focus ring and the focused row\'s edge' },
	'os-tabs': { reads: 5, marks: 'the focus ring, and the selected row\'s edge, sized by --os-ui-tab-edge-width' },
	'os-tag-input': { reads: 1, marks: 'the focus border' },
	'os-text-field': { reads: 6, marks: 'the focus ring and the active adornment' },
	'os-token-field': { reads: 1, marks: 'the focus ring' },
	'os-user-search': { reads: 1, marks: 'the focus border' },
};

/** Comments stripped: a read is a declaration, not prose about one. */
function accentReads( path: string ): number {
	const source = readFileSync( path, 'utf8' ).replace( /\/\*[\s\S]*?\*\//g, '' );
	return ( source.match( ACCENT ) ?? [] ).length;
}

/** `[ key, path ]` for every style source in the kit, keyed by component. */
function styleFiles(): Array< [ string, string ] > {
	const out: Array< [ string, string ] > = [ [ 'holo', HOLO ] ];
	for ( const dir of readdirSync( COMPONENTS, { withFileTypes: true } ) ) {
		if ( ! dir.isDirectory() ) {
			continue;
		}
		for ( const file of readdirSync( resolve( COMPONENTS, dir.name ) ) ) {
			if ( file.endsWith( '.styles.ts' ) ) {
				out.push( [ dir.name, resolve( COMPONENTS, dir.name, file ) ] );
			}
		}
	}
	return out;
}

describe( 'the accent marks state; it never decorates', () => {
	const files = styleFiles();

	test( 'the sweep found the kit', () => {
		expect( files.length ).toBeGreaterThan( 40 );
	} );

	test.each( files )( '%s reads the accent only for a state it marks', ( key, path ) => {
		const reads = accentReads( path );
		if ( reads === 0 ) {
			return;
		}
		expect(
			key in ALLOWED,
			`${ key } reads --os-ui-accent and is not listed in tests/vitest/accent-reach.test.ts. ` +
				'The accent marks the thing you are on, never decorates (AGENTS.md, "The accent marks ' +
				'state; it never decorates"). If this surface shows a state, add it to ALLOWED with that ' +
				'state. If it is instruction or decoration, make it neutral. If it genuinely needs the ' +
				'accent, read it through a literal "how much" token in variables.css so the palette can ' +
				'quiet it, and document the token in docs/desktop-themes.md.',
		).toBe( true );
		const expected = ALLOWED[ key ]?.reads ?? 0;
		expect(
			reads,
			`${ key } reads --os-ui-accent ${ reads } time(s); ALLOWED says ${ expected } (${
				ALLOWED[ key ]?.marks ?? ''
			}). A new read marks a new state or decorates: say which, then update the count.`,
		).toBe( expected );
	} );

	test.each( Object.keys( ALLOWED ) )( 'the entry for %s is still true', ( key ) => {
		const entry = files.find( ( [ k ] ) => k === key );
		expect( entry, `${ key } is listed in ALLOWED but has no style file in the kit.` ).toBeDefined();
		expect(
			accentReads( entry![ 1 ] ) > 0,
			`${ key } no longer reads the accent; drop it from ALLOWED so the list stays true.`,
		).toBe( true );
	} );
} );
