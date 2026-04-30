/**
 * Unit tests for the cross-bundle shared-store primitive.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	_resetAllSharedStoresForTests,
	createSharedStore,
} from '../../src/shared-store';

interface DemoState {
	count: number;
	items: Map< string, number >;
	user: string | null;
}

const buildDemo = (): DemoState => ( {
	count: 0,
	items: new Map(),
	user: null,
} );

describe( 'shared-store', () => {
	afterEach( () => {
		_resetAllSharedStoresForTests();
	} );

	test( 'createSharedStore returns a functional store with mutate-then-notify', () => {
		const store = createSharedStore< DemoState >( 'test/demo', buildDemo );
		const seen: number[] = [];
		store.subscribe( ( s ) => seen.push( s.count ) );
		store.state.count = 5;
		store.notify();
		expect( seen ).toEqual( [ 5 ] );
		expect( store.getState().count ).toBe( 5 );
	} );

	test( 'second call with the same key returns the SAME store', () => {
		const a = createSharedStore< DemoState >( 'test/dedupe', buildDemo );
		a.state.count = 7;
		// Different call site, same key — must reuse.
		const b = createSharedStore< DemoState >( 'test/dedupe', buildDemo );
		expect( b.getState().count ).toBe( 7 );
		// Mutations through `b` are visible to `a` since they share state.
		b.state.count = 9;
		expect( a.getState().count ).toBe( 9 );
	} );

	test( 'subscribers from BOTH handles fire on any mutation', () => {
		const a = createSharedStore< DemoState >( 'test/cross-sub', buildDemo );
		const b = createSharedStore< DemoState >( 'test/cross-sub', buildDemo );
		const aSeen = vi.fn();
		const bSeen = vi.fn();
		a.subscribe( aSeen );
		b.subscribe( bSeen );
		a.state.count = 1;
		a.notify();
		expect( aSeen ).toHaveBeenCalledTimes( 1 );
		expect( bSeen ).toHaveBeenCalledTimes( 1 );
		b.state.user = 'alice';
		b.notify();
		expect( aSeen ).toHaveBeenCalledTimes( 2 );
		expect( bSeen ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'unsubscribe removes the listener', () => {
		const store = createSharedStore< DemoState >( 'test/unsub', buildDemo );
		const cb = vi.fn();
		const off = store.subscribe( cb );
		store.notify();
		off();
		store.notify();
		expect( cb ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a thrown listener does not strand the rest', () => {
		const store = createSharedStore< DemoState >(
			'test/throwing',
			buildDemo,
		);
		const survivor = vi.fn();
		store.subscribe( () => {
			throw new Error( 'kaboom' );
		} );
		store.subscribe( survivor );
		// Quiet the console for the duration of the call.
		const errSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		store.notify();
		expect( survivor ).toHaveBeenCalledTimes( 1 );
		errSpy.mockRestore();
	} );

	test( 'reset preserves the outer object identity for object state', () => {
		const store = createSharedStore< DemoState >( 'test/reset', buildDemo );
		const captured = store.state;
		captured.count = 99;
		captured.items.set( 'x', 1 );
		captured.user = 'eve';
		store.reset();
		// Same outer object reference — captures into module-level
		// `const state = store.state` survive.
		expect( store.state ).toBe( captured );
		// But fields restored to initial.
		expect( captured.count ).toBe( 0 );
		expect( captured.user ).toBeNull();
		expect( captured.items.size ).toBe( 0 );
	} );

	test( 'reset clears subscribers', () => {
		const store = createSharedStore< DemoState >(
			'test/reset-subs',
			buildDemo,
		);
		const cb = vi.fn();
		store.subscribe( cb );
		store.reset();
		store.notify();
		expect( cb ).not.toHaveBeenCalled();
	} );

	test( 'distinct keys keep distinct stores', () => {
		const a = createSharedStore< DemoState >( 'test/distinct/a', buildDemo );
		const b = createSharedStore< DemoState >( 'test/distinct/b', buildDemo );
		a.state.count = 10;
		b.state.count = 20;
		expect( a.getState().count ).toBe( 10 );
		expect( b.getState().count ).toBe( 20 );
	} );

	test( 'thunked initialState only runs on first creation per key', () => {
		const init = vi.fn( buildDemo );
		const a = createSharedStore< DemoState >( 'test/lazy-init', init );
		const b = createSharedStore< DemoState >( 'test/lazy-init', init );
		expect( init ).toHaveBeenCalledTimes( 1 );
		expect( a.getState() ).toBe( b.getState() );
	} );

	test( 'primitive state replaces (no identity contract for primitives)', () => {
		const store = createSharedStore< number >( 'test/primitive', () => 0 );
		store.state = 5;
		expect( store.getState() ).toBe( 5 );
		store.reset();
		expect( store.getState() ).toBe( 0 );
	} );

	test( 'registers under the framework window slot', () => {
		const slotKey = '__wpDesktopSharedStores';
		// Slot may already exist from earlier tests in this file —
		// clear and verify the createSharedStore call (re-)creates it.
		delete ( window as unknown as Record< string, unknown > )[ slotKey ];
		createSharedStore( 'test/registers', buildDemo );
		const slot = ( window as unknown as Record< string, unknown > )[ slotKey ];
		expect( slot ).toBeDefined();
		expect( ( slot as Map< string, unknown > ).has( 'test/registers' ) ).toBe(
			true,
		);
	} );
} );

describe( 'shared-store with vi.resetModules across "bundles"', () => {
	beforeEach( () => {
		_resetAllSharedStoresForTests();
	} );

	test( 'a re-imported module sees the same underlying state', async () => {
		// Simulate two IIFE bundles: each runs `import { createSharedStore }`
		// and creates its own handle for the same key. The store must
		// dedupe them into one underlying record.
		const first = await import( '../../src/shared-store' );
		const storeA = first.createSharedStore< DemoState >(
			'test/cross-bundle',
			buildDemo,
		);
		storeA.state.count = 42;
		storeA.notify();

		// Force the import cache to drop and reload the module — this
		// approximates the second IIFE bundle compiling its OWN copy of
		// shared-store.ts and calling createSharedStore again.
		vi.resetModules();
		const second = await import( '../../src/shared-store' );
		const storeB = second.createSharedStore< DemoState >(
			'test/cross-bundle',
			buildDemo,
		);
		expect( storeB.getState().count ).toBe( 42 );
	} );
} );
