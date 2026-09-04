/**
 * Posts / Pages / Users windows — the status control on a phone.
 *
 * The template ships an `<os-segmented>`; the bundle fills it. On a
 * phone the same list is offered as an `<os-select>` in its place,
 * carrying the template's data attribute so the toolbar wiring that
 * queries by it finds the picker, and the same `value`.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { mountStatusControl } from '../../src/posts-window/status-control';

const SEGMENTS = [
	{ value: '', label: 'All' },
	{ value: 'publish', label: 'Published' },
	{ value: 'draft', label: 'Drafts' },
];

function template(): { root: HTMLElement; host: HTMLElement } {
	const root = document.createElement( 'div' );
	root.innerHTML = '<header><os-segmented data-os-posts-status value=""></os-segmented><os-text-field></os-text-field></header>';
	document.body.appendChild( root );
	return { root, host: root.querySelector( '[data-os-posts-status]' ) as HTMLElement };
}

describe( 'mountStatusControl', () => {
	afterEach( () => {
		document.body.replaceChildren();
		document.documentElement.removeAttribute( 'data-os-mode' );
	} );

	test( 'on a desk it fills the pill bar in place', () => {
		const { root, host } = template();
		const control = mountStatusControl( host, SEGMENTS, 'draft' );
		expect( control ).toBe( host );
		expect( control.localName ).toBe( 'os-segmented' );
		expect( Array.from( control.children ).map( ( c ) => c.localName ) ).toEqual( [ 'os-segment', 'os-segment', 'os-segment' ] );
		expect( control.getAttribute( 'value' ) ).toBe( 'draft' );
		expect( root.querySelector( '[data-os-posts-status]' ) ).toBe( control );
	} );

	test( 'on a phone the pill bar becomes a picker in the same place, under the same attribute', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		const { root, host } = template();
		const control = mountStatusControl( host, SEGMENTS, 'publish' );
		expect( control ).not.toBe( host );
		expect( control.localName ).toBe( 'os-select' );
		expect( host.isConnected ).toBe( false );
		// Same slot in the toolbar: before the search field.
		expect( root.querySelector( 'header' )?.firstElementChild ).toBe( control );
		expect( root.querySelector( '[data-os-posts-status]' ) ).toBe( control );
		expect( Array.from( control.children ).map( ( c ) => [ c.localName, c.getAttribute( 'value' ), c.textContent ] ) ).toEqual( [
			[ 'os-option', '', 'All' ],
			[ 'os-option', 'publish', 'Published' ],
			[ 'os-option', 'draft', 'Drafts' ],
		] );
		expect( control.getAttribute( 'value' ) ).toBe( 'publish' );
		expect( control.getAttribute( 'aria-label' ) ).toBe( '' );
	} );

	test( 'a stamp root can be passed explicitly', () => {
		const root = document.createElement( 'div' );
		root.setAttribute( 'data-os-mode', 'mobile' );
		const { host } = template();
		expect( mountStatusControl( host, SEGMENTS, '', root ).localName ).toBe( 'os-select' );
	} );
} );
