import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { HOOKS } from '../../src/hooks';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { loadTwoBundleCopies } from './helpers/bundle-seam';

type Channels = typeof import( '../../src/window-channels' );

const loadCopies = (): Promise< [ Channels, Channels ] > =>
	loadTwoBundleCopies< Channels >(
		() => import( '../../src/window-channels?bundle-a' ) as Promise< Channels >,
		() => import( '../../src/window-channels?bundle-b' ) as Promise< Channels >,
	);

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
		const [ windowSystem, shell ] = await loadCopies();

		const loaded: string[] = [];
		hooks.addAction(
			HOOKS.WINDOW_CONTENT_LOADED,
			'test/loaded',
			( payload ) => {
				loaded.push( ( payload as { windowId: string } ).windowId );
			},
		);

		windowSystem.markWindowContentLoading( 'probe' );
		expect( windowSystem.isWindowContentLoading( 'probe' ) ).toBe( true );

		shell.markWindowContentReady( 'probe' );

		expect( loaded ).toEqual( [ 'probe' ] );
		expect( windowSystem.isWindowContentLoading( 'probe' ) ).toBe( false );
	} );

	test( 'a repeat ready signal from the other bundle stays a no-op', async () => {
		const [ windowSystem, shell ] = await loadCopies();

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

		expect( loaded ).toEqual( [ 'probe' ] );
	} );

	test( 'transport readiness and the queued-send flush cross the seam', async () => {
		const [ windowSystem, shell ] = await loadCopies();

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
		const [ windowSystem, shell ] = await loadCopies();

		const seen: unknown[] = [];

		windowSystem.addParentSubscriber( 'probe', 'ping', ( payload ) => {
			seen.push( payload );
		} );

		shell.dispatchFromWindow( 'probe', 'ping', { n: 1 } );

		expect( seen ).toEqual( [ { n: 1 } ] );
	} );

	test( 'a native subscriber registered in one bundle hears a send from the other', async () => {
		const [ windowSystem, shell ] = await loadCopies();

		const seen: unknown[] = [];
		windowSystem.addNativeSubscriber( 'probe', 'ping', ( payload ) => {
			seen.push( payload );
		} );

		shell.dispatchToNative( 'probe', 'ping', { n: 2 } );

		expect( seen ).toEqual( [ { n: 2 } ] );
	} );

	test( 'closing a window in one bundle clears the bookkeeping the other holds', async () => {
		const [ windowSystem, shell ] = await loadCopies();

		windowSystem.markWindowContentLoading( 'probe' );
		shell.markWindowContentReady( 'probe' );
		expect( shell.isWindowContentReady( 'probe' ) ).toBe( true );

		windowSystem.clearWindowChannels( 'probe' );

		expect( shell.isWindowContentReady( 'probe' ) ).toBe( false );
		expect( windowSystem.isWindowContentReady( 'probe' ) ).toBe( false );
	} );
} );
