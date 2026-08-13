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
import { describe, expect, test } from 'vitest';
import { NAV_ICONS } from '../../src/settings/nav-icons';

/**
 * The built-in pages `renderOsSettingsPanel()` builds, by id.
 *
 * Third-party tabs are deliberately absent: they render the blank
 * spacer instead, because the settings-tab registry has no icon field
 * for a plugin to fill in.
 */
const BUILT_IN_TAB_IDS = [
	'appearance',
	'themes',
	'windows',
	'apps-icons',
	'features',
	'help',
	// Registry-delivered but ours: the desktop-files feature's tab.
	// See the note on its entry in nav-icons.ts.
	'os-file-associations',
	'about',
] as const;

/** The raw SVG source of one entry, reassembled from its template. */
function sourceOf( id: string ): string {
	const tpl = NAV_ICONS[ id ];
	if ( ! tpl ) {
		return '';
	}
	// These templates are static: no interpolations, so the strings
	// array IS the markup. Joining is enough, and an assertion below
	// keeps that assumption honest.
	expect( tpl.values ).toEqual( [] );
	return tpl.strings.join( '' );
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
		// The blank-spacer path in panel.ts depends on a miss being
		// undefined rather than a stray empty template.
		expect( NAV_ICONS[ 'ext-file-associations' ] ).toBeUndefined();
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
