import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createWindowElement } from '../../src/window/dom';
import { _resetWindowChannelsForTests } from '../../src/window-channels';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const SVG_DATA_URI =
	'data:image/svg+xml;base64,' +
	btoa( '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>' );

function makeWindow( icon: string ): HTMLElement {
	return createWindowElement( {
		id: 'probe-icon',
		url: '#probe-icon',
		title: 'Games',
		icon,
		x: 0,
		y: 0,
		width: 800,
		height: 600,
	} );
}

describe( 'createWindowElement — the title bar has no app icon', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetWindowChannelsForTests();
		document.body.innerHTML = '';
	} );

	test.each( [
		[ 'dashicons class', 'dashicons-admin-post' ],
		[ 'SVG data URI', SVG_DATA_URI ],
		[ 'http(s) URL', 'https://example.com/icon.png' ],
		[ 'unrecognized value (letter-badge shape)', 'none' ],
	] )( 'renders nothing for a %s', ( _label, icon ) => {
		const el = makeWindow( icon );
		expect( el.querySelector( '.os-window__icon' ) ).toBeNull();
		expect( el.querySelector( '.os-window__titlebar img' ) ).toBeNull();
	} );

	test( 'the icon slot host is present and empty', () => {

		const host = makeWindow( 'dashicons-admin-post' ).querySelector(
			'.os-window__slot--icon',
		);
		expect( host ).not.toBeNull();
		expect( host!.children.length ).toBe( 0 );
	} );

	test( 'the status ring took the position', () => {
		const el = makeWindow( 'dashicons-admin-post' );
		const ring = el.querySelector( '.os-window__status' );
		expect( ring ).not.toBeNull();
		expect( ring!.getAttribute( 'variant' ) ).toBe( 'ring' );
	} );
} );
