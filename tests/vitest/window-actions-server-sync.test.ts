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

		await run( [] );

		expect( ids( registry ) ).not.toContain( 'a/send' );

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
