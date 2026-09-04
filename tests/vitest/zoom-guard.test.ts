/**
 * Tests for `src/mode/zoom-guard.ts` — no page zoom on a phone or in
 * an installed app.
 *
 * Pins:
 * - the guard is in force under either stamp, `mobile` or
 *   `standalone`, and reads them at event time;
 * - it cancels Safari's `gesture*` events, a two-finger `touchmove`
 *   and a control-key `wheel` — and nothing else;
 * - a desktop in a browser tab keeps its zoom;
 * - the uninstaller removes every listener.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { installZoomGuard, zoomGuardActive } from '../../src/mode/zoom-guard';

function fire( type: string, init: Record< string, unknown > = {} ): Event {
	const e = new Event( type, { cancelable: true, bubbles: true } );
	Object.assign( e, init );
	document.dispatchEvent( e );
	return e;
}

describe( 'zoomGuardActive', () => {
	test( 'either stamp arms it', () => {
		const root = document.createElement( 'div' );
		expect( zoomGuardActive( root ) ).toBe( false );
		root.setAttribute( 'data-os-mode', 'mobile' );
		expect( zoomGuardActive( root ) ).toBe( true );
		root.setAttribute( 'data-os-mode', 'desktop' );
		root.setAttribute( 'data-os-display', 'standalone' );
		expect( zoomGuardActive( root ) ).toBe( true );
	} );
} );

describe( 'installZoomGuard', () => {
	let uninstall: () => void;

	beforeEach( () => {
		document.documentElement.removeAttribute( 'data-os-mode' );
		document.documentElement.removeAttribute( 'data-os-display' );
		uninstall = installZoomGuard();
	} );

	afterEach( () => {
		uninstall();
		document.documentElement.removeAttribute( 'data-os-mode' );
		document.documentElement.removeAttribute( 'data-os-display' );
	} );

	test( 'a desktop in a tab keeps its zoom', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'desktop' );
		document.documentElement.setAttribute( 'data-os-display', 'browser' );
		expect( fire( 'gesturestart' ).defaultPrevented ).toBe( false );
		expect( fire( 'wheel', { ctrlKey: true } ).defaultPrevented ).toBe( false );
	} );

	test( 'a phone cancels the pinch', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		expect( fire( 'gesturestart' ).defaultPrevented ).toBe( true );
		expect( fire( 'gesturechange' ).defaultPrevented ).toBe( true );
		expect( fire( 'touchmove', { touches: [ {}, {} ] } ).defaultPrevented ).toBe( true );
	} );

	test( 'an installed app cancels the trackpad pinch', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'desktop' );
		document.documentElement.setAttribute( 'data-os-display', 'standalone' );
		expect( fire( 'wheel', { ctrlKey: true } ).defaultPrevented ).toBe( true );
	} );

	test( 'a scroll and a one-finger move go through', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		expect( fire( 'wheel', { ctrlKey: false } ).defaultPrevented ).toBe( false );
		expect( fire( 'touchmove', { touches: [ {} ] } ).defaultPrevented ).toBe( false );
	} );

	test( 'reads the stamps at event time', () => {
		expect( fire( 'gesturestart' ).defaultPrevented ).toBe( false );
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		expect( fire( 'gesturestart' ).defaultPrevented ).toBe( true );
	} );

	test( 'the uninstaller removes every listener', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		uninstall();
		expect( fire( 'gesturestart' ).defaultPrevented ).toBe( false );
		expect( fire( 'touchmove', { touches: [ {}, {} ] } ).defaultPrevented ).toBe( false );
		expect( fire( 'wheel', { ctrlKey: true } ).defaultPrevented ).toBe( false );
		// `afterEach` calls it again; that must be harmless.
	} );
} );
