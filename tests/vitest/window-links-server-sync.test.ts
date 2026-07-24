/**
 * Unit tests for `src/window-links/server-sync.ts`.
 *
 * The sync module bridges the `serverWindowLinkRendererScripts`
 * payload (built in PHP, arrives via `applyPayload`) and the
 * window-link renderer registry. It mirrors `effects/server-sync.ts`,
 * so we exercise the same behaviours: fresh scripts inject, re-sync
 * is idempotent, and a departing handle unregisters owner-tagged
 * renderers while untagged ones survive.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';

type Sync = typeof import( '../../src/window-links/server-sync' );
type Registry = typeof import( '../../src/window-links/renderer-registry' );
type Loader = typeof import( '../../src/wallpapers/vendor-loader' );

async function loadModules(): Promise< {
	sync: Sync;
	registry: Registry;
	loader: Loader;
} > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	const sync = await import( '../../src/window-links/server-sync' );
	const registry = await import(
		'../../src/window-links/renderer-registry'
	);
	const loader = await import( '../../src/wallpapers/vendor-loader' );
	return { sync, registry, loader };
}

describe( 'window-links/server-sync.ts', () => {
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

		const run = sync.createWindowLinkRendererRegistrySync();
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

		const run = sync.createWindowLinkRendererRegistrySync();
		await run( [ { handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' } ] );
		await run( [ { handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' } ] );

		expect( spy ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'unregisters owner-tagged renderers when a handle leaves the payload', async () => {
		const { sync, registry, loader } = await loadModules();
		vi.spyOn( loader, 'loadVendorScript' ).mockResolvedValue( undefined );

		const run = sync.createWindowLinkRendererRegistrySync();
		await run( [ { handle: 'plugin-a', scriptUrl: 'https://example.test/a.js' } ] );

		// Simulate plugin-a's just-loaded JS registering its renderer.
		registry.registerWindowLinkRenderer( {
			id: 'a-lasers',
			label: 'Lasers',
			mount: () => () => {},
			owner: 'plugin-a',
		} );
		registry.registerWindowLinkRenderer( {
			id: 'untagged',
			label: 'No owner',
			mount: () => () => {},
		} );

		expect( registry.getWindowLinkRenderer( 'a-lasers' ) ).toBeDefined();

		// Plugin-a deactivates — sync with an empty payload.
		await run( [] );

		expect( registry.getWindowLinkRenderer( 'a-lasers' ) ).toBeUndefined();
		// Untagged renderer survives (graceful backwards-compat).
		expect( registry.getWindowLinkRenderer( 'untagged' ) ).toBeDefined();
	} );

	test( 'silently skips entries with an empty scriptUrl', async () => {
		const { sync, loader } = await loadModules();
		const spy = vi
			.spyOn( loader, 'loadVendorScript' )
			.mockResolvedValue( undefined );

		const run = sync.createWindowLinkRendererRegistrySync();
		await run( [ { handle: 'plugin-a', scriptUrl: '' } ] );

		expect( spy ).not.toHaveBeenCalled();
	} );
} );
