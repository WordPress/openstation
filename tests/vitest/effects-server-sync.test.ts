import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';

type Sync = typeof import( '../../src/effects/server-sync' );
type Registry = typeof import( '../../src/effects/registry' );
type Loader = typeof import( '../../src/wallpapers/vendor-loader' );

async function loadModules(): Promise< {
	sync: Sync;
	registry: Registry;
	loader: Loader;
} > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	const sync = await import( '../../src/effects/server-sync' );
	const registry = await import( '../../src/effects/registry' );
	const loader = await import( '../../src/wallpapers/vendor-loader' );
	return { sync, registry, loader };
}

describe( 'effects/server-sync.ts', () => {
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

		const run = sync.createUnfocusEffectRegistrySync();
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

		const run = sync.createUnfocusEffectRegistrySync();
		await run( [ { handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' } ] );
		await run( [ { handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' } ] );

		expect( spy ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'unregisters owner-tagged effects when a handle leaves the payload', async () => {
		const { sync, registry, loader } = await loadModules();
		vi.spyOn( loader, 'loadVendorScript' ).mockResolvedValue( undefined );

		const run = sync.createUnfocusEffectRegistrySync();
		await run( [ { handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' } ] );

		registry.registerUnfocusEffect( {
			id: 'a-glow',
			label: 'Glow',
			className: 'x',
			owner: 'plugin-a',
		} );
		registry.registerUnfocusEffect( {
			id: 'untagged',
			label: 'No owner',
			className: 'y',
		} );

		expect( registry.getUnfocusEffect( 'a-glow' ) ).toBeDefined();

		await run( [] );

		expect( registry.getUnfocusEffect( 'a-glow' ) ).toBeUndefined();

		expect( registry.getUnfocusEffect( 'untagged' ) ).toBeDefined();
	} );

	test( 'silently skips entries with an empty scriptUrl', async () => {
		const { sync, loader } = await loadModules();
		const spy = vi
			.spyOn( loader, 'loadVendorScript' )
			.mockResolvedValue( undefined );

		const run = sync.createUnfocusEffectRegistrySync();
		await run( [ { handle: 'plugin-a', scriptUrl: '' } ] );

		expect( spy ).not.toHaveBeenCalled();
	} );
} );
