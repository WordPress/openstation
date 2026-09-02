/**
 * The settings sidebar's glyphs.
 *
 * Two things worth pinning. One is coverage: the icons are keyed by
 * tab id, and a tab id is exactly the kind of string that gets renamed
 * without anyone thinking about the icon map, which fails silently as
 * a row that quietly loses its glyph. The other is the drawing rule
 * from the icon inventory, that shell art is `currentColor` and never
 * a hex, because a hardcoded fill cannot follow a row through its
 * hover and selected states or follow the panel into a desktop theme.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { NAV_ICONS } from '../../apps/os-settings/parts/nav-icons';

/**
 * The built-in pages the Preferences app lists, by id.
 *
 * Third-party tabs are deliberately absent: they render the blank
 * spacer instead, because the settings-tab registry has no icon field
 * for a plugin to fill in.
 */
const BUILT_IN_TAB_IDS = [
	'appearance',
	'themes',
	'windows',
	'navigation',
	'features',
	'help',
	// Registry-delivered but ours: the desktop-files feature's tab.
	// See the note on its entry in nav-icons.ts.
	'os-file-associations',
	'about',
] as const;

/** The rendered SVG source of one entry. */
function sourceOf( id: string ): string {
	const make = NAV_ICONS[ id ];
	if ( ! make ) {
		return '';
	}
	return make().outerHTML;
}

describe( 'settings nav icons', () => {
	test.each( BUILT_IN_TAB_IDS )( '%s has a glyph', ( id ) => {
		expect(
			NAV_ICONS[ id ],
			`No nav glyph for the "${ id }" settings page. Every built-in ` +
				'page draws one; if this id was renamed, rename its key in ' +
				'src/settings/nav-icons.ts to match.'
		).toBeDefined();
	} );

	test( 'nothing is drawn for a page that does not exist', () => {
		// The blank-spacer path in the app depends on a miss being
		// undefined rather than a stray empty template.
		expect( NAV_ICONS[ 'ext-file-associations' ] ).toBeUndefined();
	} );

	test( 'every entry hands out a fresh element', () => {
		// An SVG element can only be in one place in the DOM, so a
		// shared module-level node would MOVE between rows rather than
		// appear in both. The factory shape is what prevents that, and
		// the trap is that a memoised factory looks identical here
		// until two rows want the same glyph.
		const make = NAV_ICONS.windows;
		expect( make ).toBeDefined();
		expect( make?.() ).not.toBe( make?.() );
	} );

	test( 'the page table resolves external-tab glyphs by RAW registry id', () => {
		// The trap this guards: external rows render under an
		// ext-prefixed id, so a NAV_ICONS entry keyed on the raw
		// registry id (File Associations) matches NOTHING unless the
		// external-row construction looks it up itself. The map test
		// above stays green while the sidebar quietly renders the
		// blank spacer — which is exactly how the glyph shipped
		// missing once.
		const pagesSource = readFileSync(
			resolve( __dirname, '../../apps/os-settings/parts/pages.ts' ),
			'utf8'
		);
		expect(
			pagesSource,
			'External rows must carry `icon: NAV_ICONS[ tab.id ]` so a ' +
				'shell-owned registry tab can resolve its glyph by raw id.'
		).toMatch( /icon:\s*NAV_ICONS\[\s*tab\.id\s*\]/ );
	} );

	test.each( BUILT_IN_TAB_IDS )( '%s is drawn in currentColor', ( id ) => {
		const src = sourceOf( id );
		// Catches `fill="#f252fc"` and `stroke: rgb(...)` alike. The
		// only colour a shell glyph may name is the one it inherits.
		const hardcoded = src.match(
			/(?:fill|stroke)\s*[=:]\s*"?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/gi
		);
		expect(
			hardcoded,
			`${ id } hardcodes a colour: ${ ( hardcoded || [] ).join( ', ' ) }. ` +
				'Shell art paints in currentColor so it can follow the row ' +
				'through hover and selection, and follow the panel into a ' +
				'desktop theme.'
		).toBeNull();
	} );

	test.each( BUILT_IN_TAB_IDS )( '%s is on the 24x24 grid', ( id ) => {
		// Both drawing languages share the grid even though one is
		// filled and the other monoline; a stray viewBox is what makes
		// one glyph sit visibly larger than its neighbours at 17px.
		expect( sourceOf( id ) ).toContain( 'viewBox="0 0 24 24"' );
	} );

	test.each( BUILT_IN_TAB_IDS )( '%s is hidden from assistive tech', ( id ) => {
		// The row's own label is the accessible name. An unhidden glyph
		// would be announced ahead of it, or as a second nameless node.
		expect( sourceOf( id ) ).toContain( 'aria-hidden="true"' );
	} );
} );
