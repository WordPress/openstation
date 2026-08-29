/**
 * The window channel bus across a bundle seam.
 *
 * `window-channels.ts` is compiled into the shell bundle AND into
 * `window-system.js` — `createWindowElement` (which marks a window
 * loading) rides in the latter, while the synthetic-iframe readiness
 * signal `native-windows.ts` emits for an `iframeContent` window rides
 * in the former. Module-level `Set`s therefore gave the two sides
 * separate bookkeeping: the copy that registered the loading mark and
 * the copy the ready signal deleted from were different objects, so
 * `WINDOW_CONTENT_LOADED` never fired and the window sat under its
 * loading overlay forever.
 *
 * Vitest imports both sides into ONE module graph, so the seam has to
 * be built deliberately: `vi.resetModules()` between two dynamic
 * imports yields two module instances, which is exactly what two Vite
 * IIFE bundles produce in the browser.
 *
 * See AGENTS.md, "Cross-bundle state — wp.os.createSharedStore".
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { HOOKS } from '../../src/hooks';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';

type Channels = typeof import( '../../src/window-channels' );

/**
 * Two independent module instances of `window-channels.ts`, standing in
 * for the two bundles that both compile it. `vi.resetModules()` drops
 * the module cache so the second `import()` re-evaluates the file.
 */
async function loadTwoBundleCopies(): Promise< [ Channels, Channels ] > {
	const { resetModules } = await import( 'vitest' ).then( ( m ) => ( {
		resetModules: m.vi.resetModules.bind( m.vi ),
	} ) );
	resetModules();
	const bundleA = ( await import(
		'../../src/window-channels?bundle-a'
	) ) as Channels;
	resetModules();
	const bundleB = ( await import(
		'../../src/window-channels?bundle-b'
	) ) as Channels;
	return [ bundleA, bundleB ];
}

describe( 'window-channels across a bundle seam', () => {
	let hooks: FakeWpHooks;

	beforeEach( () => {
		hooks = installHooksStub();
		_resetAllSharedStoresForTests();
	} );

	afterEach( () => {
		clearHooksStub();
		_resetAllSharedStoresForTests();
	} );

	test( 'a loading mark in one bundle is cleared by a ready signal in the other', async () => {
		const [ windowSystem, shell ] = await loadTwoBundleCopies();

		const loaded: string[] = [];
		hooks.addAction(
			HOOKS.WINDOW_CONTENT_LOADED,
			'test/loaded',
			( payload ) => {
				loaded.push( ( payload as { windowId: string } ).windowId );
			},
		);

		// `createWindowElement` — window-system bundle.
		windowSystem.markWindowContentLoading( 'probe' );
		expect( windowSystem.isWindowContentLoading( 'probe' ) ).toBe( true );

		// The readiness signal — shell bundle.
		shell.markWindowContentReady( 'probe' );

		expect( loaded ).toEqual( [ 'probe' ] );
		expect( windowSystem.isWindowContentLoading( 'probe' ) ).toBe( false );
	} );

	test( 'a repeat ready signal from the other bundle stays a no-op', async () => {
		const [ windowSystem, shell ] = await loadTwoBundleCopies();

		const loaded: string[] = [];
		hooks.addAction(
			HOOKS.WINDOW_CONTENT_LOADED,
			'test/loaded',
			( payload ) => {
				loaded.push( ( payload as { windowId: string } ).windowId );
			},
		);

		windowSystem.markWindowContentLoading( 'probe' );
		shell.markWindowContentReady( 'probe' );
		shell.markWindowContentReady( 'probe' );
		windowSystem.markWindowContentReady( 'probe' );

		// Edge-triggered: exactly one loaded fire per loading episode,
		// no matter which bundle delivers the signal.
		expect( loaded ).toEqual( [ 'probe' ] );
	} );

	test( 'transport readiness and the queued-send flush cross the seam', async () => {
		const [ windowSystem, shell ] = await loadTwoBundleCopies();

		const flushed: string[] = [];
		windowSystem.enqueueWindowSend( 'probe', 'greet', { a: 1 }, () => {
			flushed.push( 'greet' );
		} );
		expect( windowSystem.isWindowContentReady( 'probe' ) ).toBe( false );

		shell.markWindowContentReady( 'probe' );

		expect( flushed ).toEqual( [ 'greet' ] );
		expect( windowSystem.isWindowContentReady( 'probe' ) ).toBe( true );
		expect( shell.isWindowContentReady( 'probe' ) ).toBe( true );
	} );

	test( 'a parent-side subscriber registered in one bundle hears a publish from the other', async () => {
		const [ windowSystem, shell ] = await loadTwoBundleCopies();

		const seen: unknown[] = [];
		// `Window.on()` — window-system bundle.
		windowSystem.addParentSubscriber( 'probe', 'ping', ( payload ) => {
			seen.push( payload );
		} );

		// The connection bridge / an `iframeContent` message relay —
		// shell bundle.
		shell.dispatchFromWindow( 'probe', 'ping', { n: 1 } );

		expect( seen ).toEqual( [ { n: 1 } ] );
	} );

	test( 'a native subscriber registered in one bundle hears a send from the other', async () => {
		const [ windowSystem, shell ] = await loadTwoBundleCopies();

		const seen: unknown[] = [];
		windowSystem.addNativeSubscriber( 'probe', 'ping', ( payload ) => {
			seen.push( payload );
		} );

		shell.dispatchToNative( 'probe', 'ping', { n: 2 } );

		expect( seen ).toEqual( [ { n: 2 } ] );
	} );

	test( 'closing a window in one bundle clears the bookkeeping the other holds', async () => {
		const [ windowSystem, shell ] = await loadTwoBundleCopies();

		windowSystem.markWindowContentLoading( 'probe' );
		shell.markWindowContentReady( 'probe' );
		expect( shell.isWindowContentReady( 'probe' ) ).toBe( true );

		// `Window.close()` — window-system bundle.
		windowSystem.clearWindowChannels( 'probe' );

		// A reopen of the same id starts from a clean slate on BOTH
		// sides; a stale `_readyWindows` entry would make the reopened
		// window skip its queued-send flush.
		expect( shell.isWindowContentReady( 'probe' ) ).toBe( false );
		expect( windowSystem.isWindowContentReady( 'probe' ) ).toBe( false );
	} );
} );
