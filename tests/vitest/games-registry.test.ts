/**
 * Unit tests for `src/games/registry.ts` and
 * `src/games/server-sync.ts`.
 *
 * The registry seed lives on a `createSharedStore`-backed window
 * slot (the Games hub ships in its own bundle), so each test
 * reloads the modules after resetting the shared stores.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub, type FakeWpHooks } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import type { GameRegistryEntry } from '../../src/games/types';
import type { DesktopGameServerEntry } from '../../src/types';

type Registry = typeof import( '../../src/games/registry' );
type ServerSync = typeof import( '../../src/games/server-sync' );

async function loadModules(): Promise< {
	registry: Registry;
	serverSync: ServerSync;
} > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	return {
		registry: await import( '../../src/games/registry' ),
		serverSync: await import( '../../src/games/server-sync' ),
	};
}

const makeEntry = (
	overrides: Partial< GameRegistryEntry > = {},
): GameRegistryEntry => ( {
	id: 'test-game',
	title: 'Test Game',
	icon: 'dashicons-admin-generic',
	scoreColumns: [ { key: 'score', label: 'Score', type: 'number' } ],
	config: {},
	render: () => undefined,
	...overrides,
} );

const makeServerEntry = (
	overrides: Partial< DesktopGameServerEntry > = {},
): DesktopGameServerEntry => ( {
	id: 'server-game',
	title: 'Server Game',
	description: 'From PHP.',
	icon: 'data:image/svg+xml;base64,x',
	scoreColumns: [ { key: 'score', label: 'Score', type: 'number' } ],
	config: { wordsUrl: 'https://example.test/words.txt' },
	scriptUrl: 'https://example.test/game.js',
	scriptHandle: 'server-game',
	...overrides,
} );

describe( 'games/registry.ts', () => {
	let hooks: FakeWpHooks;

	beforeEach( () => {
		hooks = installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'register adds a game; get finds it', async () => {
		const { registry } = await loadModules();
		registry.register( makeEntry() );
		expect( registry.all().map( ( g ) => g.id ) ).toEqual( [ 'test-game' ] );
		expect( registry.get( 'test-game' )?.title ).toBe( 'Test Game' );
	} );

	test( 'register with an existing id replaces the entry (stub upgrade path)', async () => {
		const { registry } = await loadModules();
		registry.register(
			makeEntry( { render: undefined, scriptUrl: 'https://x.test/g.js' } ),
		);
		expect( registry.get( 'test-game' )?.render ).toBeUndefined();

		const render = (): void => undefined;
		registry.register( makeEntry( { render } ) );
		const entries = registry.all();
		expect( entries ).toHaveLength( 1 );
		expect( entries[ 0 ].render ).toBe( render );
	} );

	test( 'register rejects an entry with neither render nor scriptUrl', async () => {
		const { registry } = await loadModules();
		expect( () =>
			registry.register( makeEntry( { render: undefined } ) ),
		).toThrow( /render/ );
	} );

	test( 'unregister removes and notifies subscribers', async () => {
		const { registry } = await loadModules();
		const listener = vi.fn();
		registry.subscribe( listener );
		registry.register( makeEntry() );
		registry.unregister( 'test-game' );
		expect( registry.all() ).toEqual( [] );
		expect( listener ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'the desktop-mode.games filter participates in all()', async () => {
		const { registry } = await loadModules();
		registry.register( makeEntry() );
		hooks.addFilter(
			'desktop-mode.games',
			'test/add-game',
			( games ) => [
				...( games as GameRegistryEntry[] ),
				makeEntry( { id: 'filtered-game', title: 'Filtered' } ),
			],
		);
		expect( registry.all().map( ( g ) => g.id ) ).toEqual( [
			'test-game',
			'filtered-game',
		] );
	} );

	test( 'invalid entries returned by a filter are dropped', async () => {
		const { registry } = await loadModules();
		registry.register( makeEntry() );
		hooks.addFilter( 'desktop-mode.games', 'test/mangle', ( games ) => [
			...( games as GameRegistryEntry[] ),
			{ id: '' },
		] );
		expect( registry.all().map( ( g ) => g.id ) ).toEqual( [ 'test-game' ] );
	} );
} );

describe( 'games/server-sync.ts', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'sync registers metadata stubs without loading scripts', async () => {
		const { registry, serverSync } = await loadModules();
		const sync = serverSync.createGamesRegistrySync();

		await sync( [ makeServerEntry() ] );

		const entry = registry.get( 'server-game' );
		expect( entry ).toBeDefined();
		expect( entry?.render ).toBeUndefined();
		expect( entry?.scriptUrl ).toBe( 'https://example.test/game.js' );
		expect( entry?.config ).toEqual( {
			wordsUrl: 'https://example.test/words.txt',
		} );
		// No script tags injected — stubs are metadata-only.
		expect(
			document.querySelectorAll( 'script[data-desktop-mode-vendor]' ),
		).toHaveLength( 0 );
	} );

	test( 'a game leaving the payload is unregistered', async () => {
		const { registry, serverSync } = await loadModules();
		const sync = serverSync.createGamesRegistrySync();

		await sync( [ makeServerEntry() ] );
		expect( registry.get( 'server-game' ) ).toBeDefined();

		await sync( [] );
		expect( registry.get( 'server-game' ) ).toBeUndefined();
	} );

	test( 're-sync refreshes metadata but keeps a loaded render callback', async () => {
		const { registry, serverSync } = await loadModules();
		const sync = serverSync.createGamesRegistrySync();

		await sync( [ makeServerEntry() ] );

		// Simulate the lazy script load upgrading the stub.
		const render = (): void => undefined;
		registry.register( {
			...registry.get( 'server-game' )!,
			render,
		} );

		await sync( [ makeServerEntry( { title: 'Renamed Game' } ) ] );

		const entry = registry.get( 'server-game' );
		expect( entry?.title ).toBe( 'Renamed Game' );
		expect( entry?.render ).toBe( render );
	} );
} );
