/**
 * OS Settings → Components tab.
 *
 * Two things are covered here, and they're related:
 *
 * 1. **Every tag in `OS_COMPONENT_TAGS` actually registers.** Feature
 *    code imports components one file at a time, so before the tab
 *    side-effect-imported the barrel, any component nothing happened to
 *    use was tree-shaken out of every bundle. It never reached
 *    `customElements`, and the tab silently skipped it — the reason
 *    `<os-number-field>` and 24 others were missing from a list that
 *    claims to show everything the plugin ships.
 *
 * 2. **The search box filters on the whole descriptor**, not just the
 *    title, so "number" finds the number field and "clamp" finds it via
 *    its prop description.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { buildHelpSection } from '../../src/settings/sections/help';
import { OS_COMPONENT_TAGS } from '../../src/ui/components/tags';
import type { SettingsCtx } from '../../src/settings/types';

function ctxStub(): SettingsCtx {
	return {
		state: { developerModeEnabled: false },
	} as unknown as SettingsCtx;
}

function navTitles( el: HTMLElement ): string[] {
	return Array.from(
		el.querySelectorAll( '.os-settings__help-nav-title' ),
	).map( ( n ) => n.textContent?.trim() ?? '' );
}

function navTags( el: HTMLElement ): string[] {
	return Array.from(
		el.querySelectorAll( '.os-settings__help-nav-tag' ),
	).map( ( n ) => n.textContent?.trim().replace( /^<|>$/g, '' ) ?? '' );
}

/**
 * Drive the search field the way a user does: set the inner input's
 * value and let the component emit `os-input-change`.
 */
function search( el: HTMLElement, term: string ): void {
	const field = el.querySelector( '.os-settings__help-search' );
	if ( ! field ) {
		throw new Error( 'search field not rendered' );
	}
	field.dispatchEvent(
		new CustomEvent( 'os-input-change', {
			detail: { value: term },
			bubbles: true,
			composed: true,
		} ),
	);
}

describe( 'OS Settings — Components tab', () => {
	let el: HTMLElement;

	beforeEach( () => {
		el = buildHelpSection( ctxStub() );
		document.body.appendChild( el );
	} );

	test( 'every declared tag is registered on customElements', () => {
		const unregistered = OS_COMPONENT_TAGS.filter(
			( tag ) => ! customElements.get( tag ),
		);
		expect( unregistered ).toEqual( [] );
	} );

	test( 'lists every declared component, not just the loaded ones', () => {
		expect( navTags( el ).sort() ).toEqual(
			[ ...OS_COMPONENT_TAGS ].sort(),
		);
	} );

	test( 'os-number-field is listed', () => {
		expect( navTags( el ) ).toContain( 'os-number-field' );
		expect( navTitles( el ) ).toContain( 'Number field' );
	} );

	test( 'search narrows the list and keeps the relevant match', () => {
		search( el, 'number' );
		const tags = navTags( el );
		expect( tags ).toContain( 'os-number-field' );
		expect( tags.length ).toBeLessThan( OS_COMPONENT_TAGS.length );
	} );

	test( 'search filters by exact tag name', () => {
		search( el, 'os-progress-bar' );
		expect( navTags( el ) ).toEqual( [ 'os-progress-bar' ] );
	} );

	test( 'search matches prop and event descriptions, not only names', () => {
		// "clamp" appears in the number field's min/max prop
		// descriptions and nowhere in its title or tag.
		search( el, 'clamp' );
		expect( navTags( el ) ).toContain( 'os-number-field' );
	} );

	test( 'search terms are ANDed regardless of order', () => {
		search( el, 'number field' );
		const forward = navTags( el );
		search( el, 'field number' );
		expect( navTags( el ) ).toEqual( forward );
		expect( forward ).toContain( 'os-number-field' );
		// Both terms must be present — ANDing has to narrow past
		// either term on its own.
		search( el, 'number' );
		expect( forward.length ).toBeLessThanOrEqual( navTags( el ).length );
	} );

	test( 'search is case-insensitive', () => {
		search( el, 'number field' );
		const lower = navTags( el );
		search( el, 'NUMBER FIELD' );
		expect( navTags( el ) ).toEqual( lower );
	} );

	test( 'clearing the search restores the full list', () => {
		search( el, 'number' );
		expect( navTags( el ).length ).toBeLessThan(
			OS_COMPONENT_TAGS.length,
		);
		search( el, '' );
		expect( navTags( el ) ).toHaveLength( OS_COMPONENT_TAGS.length );
	} );

	test( 'no matches renders an empty message and no nav items', () => {
		search( el, 'zzzz-no-such-component' );
		expect( navTags( el ) ).toEqual( [] );
		expect(
			el.querySelector( '.os-settings__help-nav-empty' ),
		).not.toBeNull();
	} );

	test( 'selection follows the filter instead of going blank', () => {
		const detail = (): string =>
			el.querySelector( '.os-settings__help-detail' )
				?.textContent ?? '';

		// The initial selection is the first entry alphabetically; a
		// search that excludes it must move the detail pane onto a
		// surviving match rather than render the empty state.
		search( el, 'os-number-field' );
		expect( detail() ).toContain( 'os-number-field' );
	} );
} );
