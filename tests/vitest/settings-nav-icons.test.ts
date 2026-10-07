import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { NAV_ICONS, registryNavIcon } from '../../apps/os-settings/parts/nav-icons';

const BUILT_IN_TAB_IDS = [
	'appearance',
	'themes',
	'windows',
	'navigation',
	'features',
	'help',

	'os-file-associations',
	'about',
] as const;

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

		expect( NAV_ICONS[ 'ext-file-associations' ] ).toBeUndefined();
	} );

	test( 'every entry hands out a fresh element', () => {

		const make = NAV_ICONS.windows;
		expect( make ).toBeDefined();
		expect( make?.() ).not.toBe( make?.() );
	} );

	test( 'the page table resolves external-tab glyphs by RAW registry id', () => {

		const pagesSource = readFileSync(
			resolve( __dirname, '../../apps/os-settings/parts/pages.ts' ),
			'utf8'
		);
		expect(
			pagesSource,
			'External rows must resolve through `registryNavIcon( tab.id, … )` ' +
				'so a shell-owned registry tab can resolve its glyph by raw id.'
		).toMatch( /icon:\s*registryNavIcon\(\s*tab\.id\b/ );

		const fallback = registryNavIcon( 'os-file-associations' );
		expect( fallback ).toBe( NAV_ICONS[ 'os-file-associations' ] );
		expect( fallback?.().tagName.toLowerCase() ).toBe( 'svg' );
	} );

	test.each( BUILT_IN_TAB_IDS )( '%s is drawn in currentColor', ( id ) => {
		const src = sourceOf( id );

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

		expect( sourceOf( id ) ).toContain( 'viewBox="0 0 24 24"' );
	} );

	test.each( BUILT_IN_TAB_IDS )( '%s is hidden from assistive tech', ( id ) => {

		expect( sourceOf( id ) ).toContain( 'aria-hidden="true"' );
	} );
} );
