/**
 * Unit tests for `src/window-actions/server-sync.ts`.
 *
 * The sync module bridges the `serverWindowActionScripts` payload
 * (built in PHP, arrives via `applyPayload`) and the ⋯ actions
 * registry. It mirrors `window-links/server-sync.ts`, so the same
 * behaviours are exercised: fresh scripts inject, re-sync is
 * idempotent, and a departing handle unregisters owner-tagged actions
 * while untagged ones survive.
 *
 * The last of those is the point of the whole module.
 * `WindowActionDef.owner` documented live unregistration on
 * deactivation while `unregisterWindowActionsByOwner()` had no caller
 * anywhere — the docs described behaviour nothing performed. These
 * tests are what keeps that from being true again.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';

type Sync = typeof import( '../../src/window-actions/server-sync' );
type Registry = typeof import( '../../src/window-actions/registry' );
type Loader = typeof import( '../../src/wallpapers/vendor-loader' );

async function loadModules(): Promise< {
	sync: Sync;
	registry: Registry;
	loader: Loader;
} > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	const sync = await import( '../../src/window-actions/server-sync' );
	const registry = await import( '../../src/window-actions/registry' );
	const loader = await import( '../../src/wallpapers/vendor-loader' );
	return { sync, registry, loader };
}

/** Ids currently in the registry. */
function ids( registry: Registry ): string[] {
	return registry.listWindowActions().map( ( def ) => def.id );
}

describe( 'window-actions/server-sync.ts', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
		document.head.innerHTML = '';
	} );

	test( 'injects a <script> for each new handle', async () => {
		const { sync, loader } = await loadModules();
		const spy = vi
			.spyOn( loader, 'loadVendorScript' )
			.mockResolvedValue( undefined );

		const run = sync.createWindowActionRegistrySync();
		await run( [
			{ handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' },
			{ handle: 'plugin-b', scriptUrl: 'https://example.test/b.js' },
		] );

		expect( spy ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'is idempotent — re-sync with the same handle is a no-op', async () => {
		const { sync, loader } = await loadModules();
		const spy = vi
			.spyOn( loader, 'loadVendorScript' )
			.mockResolvedValue( undefined );

		const run = sync.createWindowActionRegistrySync();
		await run( [ { handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' } ] );
		await run( [ { handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' } ] );

		expect( spy ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'unregisters owner-tagged actions when a handle leaves the payload', async () => {
		const { sync, registry, loader } = await loadModules();
		vi.spyOn( loader, 'loadVendorScript' ).mockResolvedValue( undefined );

		const run = sync.createWindowActionRegistrySync();
		await run( [ { handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' } ] );

		// Simulate plugin-a's just-loaded JS registering its row.
		registry.registerWindowAction( {
			id: 'a/send',
			label: 'Send somewhere',
			onSelect: () => {},
			owner: 'plugin-a',
		} );
		registry.registerWindowAction( {
			id: 'untagged',
			label: 'No owner',
			onSelect: () => {},
		} );

		expect( ids( registry ) ).toContain( 'a/send' );

		// Plugin-a deactivates — sync with an empty payload.
		await run( [] );

		expect( ids( registry ) ).not.toContain( 'a/send' );
		// Untagged action survives (graceful backwards-compat).
		expect( ids( registry ) ).toContain( 'untagged' );
	} );

	test( 'an unregistration notifies subscribers so an open menu repaints', async () => {
		const { sync, registry, loader } = await loadModules();
		vi.spyOn( loader, 'loadVendorScript' ).mockResolvedValue( undefined );

		const run = sync.createWindowActionRegistrySync();
		await run( [ { handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' } ] );
		registry.registerWindowAction( {
			id: 'a/send',
			label: 'Send somewhere',
			onSelect: () => {},
			owner: 'plugin-a',
		} );

		const listener = vi.fn();
		const off = registry.subscribeWindowActions( listener );
		await run( [] );
		off();

		expect( listener ).toHaveBeenCalled();
	} );

	test( 'silently skips entries with an empty scriptUrl', async () => {
		const { sync, loader } = await loadModules();
		const spy = vi
			.spyOn( loader, 'loadVendorScript' )
			.mockResolvedValue( undefined );

		const run = sync.createWindowActionRegistrySync();
		await run( [ { handle: 'plugin-a', scriptUrl: '' } ] );

		expect( spy ).not.toHaveBeenCalled();
	} );
} );
