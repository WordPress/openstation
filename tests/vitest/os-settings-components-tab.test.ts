/**
 * Preferences → Components lists EVERY declared component, not just
 * the ones some other screen happened to load.
 *
 * Two things this pins:
 *
 * 1. The tab's barrel import registers every `OS_COMPONENT_TAGS`
 *    entry on `customElements`. Feature code imports components one
 *    file at a time, so before the tab side-effect-imported the
 *    barrel, any component nothing happened to use was tree-shaken
 *    out of every bundle and silently missing from the list.
 * 2. The search filters by name, tag, prop and event text — AND-ed,
 *    order-free, case-insensitive — and never leaves the detail pane
 *    blank while results exist.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { render } from '../../src/ui/core';
import { mockViewContext } from '../../src/app-runtime/testing';
import { renderComponents } from '../../apps/os-settings/parts/components';
import { OS_COMPONENT_TAGS } from '../../src/ui/components/tags';
import { installOsSettingsStub, type OsSettingsStub } from './helpers/os-settings-stub';
import { appData } from './helpers/os-settings-app';
import type { Ctx } from '../../apps/os-settings/parts/types';

function navTitles( el: HTMLElement ): string[] {
	return Array.from( el.querySelectorAll( '.os-settings__help-nav-title' ) ).map(
		( n ) => n.textContent?.trim() ?? '',
	);
}

function navTags( el: HTMLElement ): string[] {
	return Array.from( el.querySelectorAll( '.os-settings__help-nav-tag' ) ).map(
		( n ) => n.textContent?.trim().replace( /^<|>$/g, '' ) ?? '',
	);
}

/**
 * Drive the search field the way a user does: let the component emit
 * `os-input-change` with the typed value.
 */
function search( el: HTMLElement, term: string ): void {
	const field = el.querySelector( '.os-settings__help-search' );
	if ( ! field ) {
		throw new Error( 'search field not rendered' );
	}
	field.dispatchEvent(
		new CustomEvent( 'os-input-change', { detail: { value: term }, bubbles: true, composed: true } ),
	);
}

describe( 'OS Settings — Components tab', () => {
	let el: HTMLElement;
	let stub: OsSettingsStub;
	let ctx: Ctx;

	beforeEach( () => {
		stub = installOsSettingsStub( { developerModeEnabled: false } );
		el = document.createElement( 'div' );
		document.body.appendChild( el );
		ctx = mockViewContext( { state: { tab: 'help' }, data: appData(), root: el } );
		const paint = (): void => render( renderComponents( stub.state, ctx ), el );
		ctx.repaint = paint;
		paint();
	} );

	test( 'every declared tag is registered on customElements', () => {
		const unregistered = OS_COMPONENT_TAGS.filter( ( tag ) => ! customElements.get( tag ) );
		expect( unregistered ).toEqual( [] );
	} );

	test( 'lists every declared component, not just the loaded ones', () => {
		expect( navTags( el ).sort() ).toEqual( [ ...OS_COMPONENT_TAGS ].sort() );
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
		expect( navTags( el ).length ).toBeLessThan( OS_COMPONENT_TAGS.length );
		search( el, '' );
		expect( navTags( el ) ).toHaveLength( OS_COMPONENT_TAGS.length );
	} );

	test( 'no matches renders an empty message and no nav items', () => {
		search( el, 'zzzz-no-such-component' );
		expect( navTags( el ) ).toEqual( [] );
		expect( el.querySelector( '.os-settings__help-nav-empty' ) ).not.toBeNull();
	} );

	test( 'selection follows the filter instead of going blank', () => {
		const detail = (): string => el.querySelector( '.os-settings__help-detail' )?.textContent ?? '';
		search( el, 'os-number-field' );
		expect( detail() ).toContain( 'os-number-field' );
	} );

	test( 'the warner demo is a developer-mode surface', () => {
		expect( el.querySelector( '.os-settings__help-warner-demo' ) ).toBeNull();
		stub.state.developerModeEnabled = true;
		ctx.repaint();
		expect( el.querySelector( '.os-settings__help-warner-demo' ) ).not.toBeNull();
	} );
} );
