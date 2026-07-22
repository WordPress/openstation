/**
 * Title-bar icon rendering — `createWindowElement` must honor every
 * icon shape `renderIcon` supports, not just Dashicons classes.
 *
 * Catches the regression where a native window registered with a
 * `data:image/svg+xml;base64,…` icon (e.g. the Games window's
 * gamepad SVG) rendered an empty `<span class="dashicons …">` in
 * the title bar — the data URI was squeezed through the
 * dashicons-class code path and stripped into a garbage class name.
 *
 * @since 0.9.7
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

function titleBarIcon( el: HTMLElement ): HTMLElement | null {
	return el.querySelector< HTMLElement >( '.desktop-mode-window__icon' );
}

describe( 'createWindowElement — title-bar icon shapes', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetWindowChannelsForTests();
		document.body.innerHTML = '';
	} );

	test( 'dashicons class renders the classic dashicons span', () => {
		const iconEl = titleBarIcon( makeWindow( 'dashicons-admin-post' ) );
		expect( iconEl ).not.toBeNull();
		expect( iconEl!.tagName ).toBe( 'SPAN' );
		expect( iconEl!.classList.contains( 'dashicons' ) ).toBe( true );
		expect( iconEl!.classList.contains( 'dashicons-admin-post' ) ).toBe( true );
		expect( iconEl!.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
	} );

	test( 'SVG data URI renders as a background-image span (the Games gamepad case)', () => {
		const iconEl = titleBarIcon( makeWindow( SVG_DATA_URI ) );
		expect( iconEl ).not.toBeNull();
		expect( iconEl!.style.backgroundImage ).toContain( SVG_DATA_URI );
		// The old code path stamped `dashicons` + a stripped class —
		// make sure the data URI never lands there again.
		expect( iconEl!.classList.contains( 'dashicons' ) ).toBe( false );
	} );

	test( 'http(s) URL renders as an <img>', () => {
		const iconEl = titleBarIcon(
			makeWindow( 'https://example.com/icon.png' ),
		);
		expect( iconEl ).not.toBeNull();
		expect( iconEl!.tagName ).toBe( 'IMG' );
		expect( ( iconEl as HTMLImageElement ).src ).toBe(
			'https://example.com/icon.png',
		);
	} );

	test( 'unrecognized value falls back to the letter badge', () => {
		const iconEl = titleBarIcon( makeWindow( 'none' ) );
		expect( iconEl ).not.toBeNull();
		expect(
			iconEl!.classList.contains( 'desktop-mode-icon-letter' ),
		).toBe( true );
		expect( iconEl!.textContent ).toBe( 'GA' );
	} );
} );
