/**
 * Unit tests for `src/hooks.ts` — the typed wrapper around
 * `window.wp.hooks`. Each test starts with a freshly-installed
 * in-memory hooks stub so state doesn't leak across cases.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	HOOKS,
	addAction,
	addFilter,
	applyFilters,
	didAction,
	doAction,
	rawHooks,
	whenReady,
} from '../../src/hooks';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

describe( 'hooks.ts', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'throws a readable error when wp.hooks is missing', () => {
		clearHooksStub();
		// The real error message uses backticks around
		// `window.wp.hooks`, so the regex has to tolerate interstitial
		// characters between "hooks" and "is not available".
		expect( () => doAction( 'whatever' ) ).toThrow(
			/wp\.hooks.*is not available/
		);
	} );

	test( 'addFilter + applyFilters round-trips with callback mutation', () => {
		addFilter<number>( 'test.double', 'vitest', ( value ) => value * 2 );
		expect( applyFilters( 'test.double', 3 ) ).toBe( 6 );
	} );

	test( 'multiple filter callbacks chain by registration order', () => {
		addFilter<number>( 'test.chain', 'vitest/a', ( v ) => v + 1 );
		addFilter<number>( 'test.chain', 'vitest/b', ( v ) => v * 10 );
		expect( applyFilters( 'test.chain', 1 ) ).toBe( 20 );
	} );

	test( 'addAction + doAction fires the callback', () => {
		let observed: unknown = null;
		addAction( 'test.fire', 'vitest', ( payload ) => {
			observed = payload;
		} );
		doAction( 'test.fire', { id: 42 } );
		expect( observed ).toEqual( { id: 42 } );
	} );

	test( 'didAction increments per doAction call', () => {
		addAction( 'test.count', 'vitest', () => undefined );
		expect( didAction( 'test.count' ) ).toBe( 0 );
		doAction( 'test.count' );
		doAction( 'test.count' );
		expect( didAction( 'test.count' ) ).toBe( 2 );
	} );

	test( 'rawHooks exposes the installed hooks bus', () => {
		const raw = rawHooks();
		expect( typeof raw.addFilter ).toBe( 'function' );
		expect( typeof raw.doAction ).toBe( 'function' );
	} );

	test( 'whenReady fires immediately if desktop-mode.init has already fired', async () => {
		addAction( HOOKS.INIT, 'vitest/seed', () => undefined );
		doAction( HOOKS.INIT );

		let fired = false;
		whenReady( () => {
			fired = true;
		} );
		// Immediate-fire path schedules on a microtask; flush.
		await Promise.resolve();
		expect( fired ).toBe( true );
	} );

	test( 'whenReady waits for desktop-mode.init when init has not fired', () => {
		let fired = false;
		whenReady( () => {
			fired = true;
		} );
		expect( fired ).toBe( false );

		// Firing init should trigger the queued callback.
		doAction( HOOKS.INIT );
		expect( fired ).toBe( true );
	} );

	test( 'HOOKS catalog carries stable hook-name constants', () => {
		// Spot-check a few load-bearing names. A typo here would
		// silently break every downstream consumer — the constants
		// exist specifically to keep them in one place.
		expect( HOOKS.INIT ).toBe( 'desktop-mode.init' );
		expect( HOOKS.WALLPAPERS ).toBe( 'desktop-mode.wallpapers' );
		expect( HOOKS.WINDOW_OPENED ).toBe( 'desktop-mode.window.opened' );
		expect( HOOKS.OVERVIEW_ENTERING ).toBe( 'desktop-mode.overview.entering' );
		expect( HOOKS.ARRANGE_CASCADE_APPLIED ).toBe(
			'desktop-mode.arrange.cascade.applied'
		);
	} );
} );
