/**
 * The title bar renders no app icon.
 *
 * It used to, through `renderIcon`, in every shape a window can
 * register — and the result was a copy of the window's own dock tile
 * a few hundred pixels above it. A title bar has room for one mark of
 * that size and it is now the status ring, which reports something
 * the dock tile can't.
 *
 * What this file pins is the *absence*, in the shapes that used to be
 * rendered here — a regression that reinstated the icon would show up
 * as a second copy of the dock tile, which is exactly the thing that
 * looks fine in a screenshot and wrong in use. The `renderIcon`
 * dispatcher itself is unaffected and still covered by
 * `icon-data-uri.test.ts`; the icon SLOT is still here for plugins
 * and desktop themes that render into it deliberately.
 */
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
		// Empty, not removed: a plugin's `appearance.slots.icon` and a
		// desktop theme's per-window icon slot both still land here.
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
