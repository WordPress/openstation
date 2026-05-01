/**
 * Unit tests for `src/mobile/index.ts` — the responsive detection
 * layer. Covers `resolveMode()`, override behavior, and the
 * mode-attribute application.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { resolveMode, getMode, setOverride, subscribe } from '../../src/mobile';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

describe( 'mobile.ts — resolveMode', () => {
	beforeEach( () => {
		installHooksStub();
		setOverride( null );
		document.documentElement.removeAttribute( 'data-wp-desktop-mode' );
	} );

	afterEach( () => {
		setOverride( null );
		clearHooksStub();
	} );

	test( 'classifies wide viewports as desktop', () => {
		expect( resolveMode( 1440 ) ).toBe( 'desktop' );
		expect( resolveMode( 1025 ) ).toBe( 'desktop' );
	} );

	test( 'classifies tablet-width viewports as tablet', () => {
		expect( resolveMode( 1024 ) ).toBe( 'tablet' );
		expect( resolveMode( 800 ) ).toBe( 'tablet' );
		expect( resolveMode( 641 ) ).toBe( 'tablet' );
	} );

	test( 'classifies narrow viewports as mobile', () => {
		expect( resolveMode( 640 ) ).toBe( 'mobile' );
		expect( resolveMode( 375 ) ).toBe( 'mobile' );
		expect( resolveMode( 320 ) ).toBe( 'mobile' );
	} );

	test( 'override pins the mode regardless of width', () => {
		setOverride( 'mobile' );
		expect( resolveMode( 1920 ) ).toBe( 'mobile' );
		setOverride( 'desktop' );
		expect( resolveMode( 320 ) ).toBe( 'desktop' );
		setOverride( null );
		expect( resolveMode( 320 ) ).toBe( 'mobile' );
	} );

	test( 'plugins can hijack via desktop_mode_responsive_resolve', () => {
		const hooks = installHooksStub();
		hooks.addFilter(
			'desktop_mode_responsive_resolve',
			'vitest',
			() => 'tablet',
		);
		expect( resolveMode( 1920 ) ).toBe( 'tablet' );
		expect( resolveMode( 320 ) ).toBe( 'tablet' );
	} );

	test( 'subscribe returns an unsubscribe', () => {
		const fn = (): void => {};
		const off = subscribe( fn );
		expect( typeof off ).toBe( 'function' );
		// Calling the unsubscribe is a no-throw.
		off();
	} );

	test( 'getMode returns the cached current mode', () => {
		// No tick has fired in this isolated test — getMode falls back
		// to the module's default initial value.
		expect( getMode() ).toBe( 'desktop' );
	} );
} );
