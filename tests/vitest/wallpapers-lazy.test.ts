/**
 * A canvas wallpaper's bundle IS the wallpaper — Living Tree is
 * 58 KB of PixiJS scene, Snow is 42 KB — and both used to download
 * and parse on every admin page load, for every user, including the
 * overwhelming majority wearing a flat gradient.
 *
 * The server-sync now registers a metadata-only stub instead and the
 * bundle waits for something that actually needs the callbacks:
 * the wallpaper being applied, or the picker opening.
 *
 * What these tests pin:
 *
 *   - Sync registers a usable def (label, preview, description) with
 *     no script fetched.
 *   - The user's ACTIVE wallpaper is the one exception — it hydrates
 *     on sync, because the desktop is about to paint it.
 *   - `hydrateAll()` (the picker's call) pulls the rest in.
 *   - A stub that gets mounted anyway hydrates itself and delegates,
 *     resolving `needs` first the way the layer would have.
 *   - Failure leaves the stub in place and retryable.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import type { DesktopWallpaperServerEntry } from '../../src/types';
import type {
	CanvasWallpaperDef,
	WallpaperContext,
	WallpaperDef,
} from '../../src/wallpapers/types';

type Registry = typeof import( '../../src/wallpapers/registry' );
type Lazy = typeof import( '../../src/wallpapers/lazy' );
type ServerSync = typeof import( '../../src/wallpapers/server-sync' );
type VendorLoader = typeof import( '../../src/wallpapers/vendor-loader' );
type ModuleRegistry = typeof import( '../../src/modules/registry' );

interface Modules {
	registry: Registry;
	lazy: Lazy;
	serverSync: ServerSync;
	vendorLoader: VendorLoader;
	modules: ModuleRegistry;
}

async function loadModulesUnderTest(): Promise< Modules > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	return {
		registry: await import( '../../src/wallpapers/registry' ),
		lazy: await import( '../../src/wallpapers/lazy' ),
		serverSync: await import( '../../src/wallpapers/server-sync' ),
		vendorLoader: await import( '../../src/wallpapers/vendor-loader' ),
		modules: await import( '../../src/modules/registry' ),
	};
}

function serverEntry(
	overrides: Partial< DesktopWallpaperServerEntry > = {},
): DesktopWallpaperServerEntry {
	return {
		id: 'wp-living-tree',
		label: 'Living Tree',
		preview: 'linear-gradient(#0b3, #062)',
		type: 'canvas',
		value: '',
		description: 'A tree that grows with your site.',
		scriptUrl: 'https://example.test/living-tree.js',
		scriptHandle: 'os-living-tree-wallpaper',
		...overrides,
	} as DesktopWallpaperServerEntry;
}

/** Minimal `OsSettings` stand-in — the sync reads + re-applies. */
function fakeSettings( wallpaper = 'os-dark' ) {
	return {
		state: { wallpaper },
		apply: vi.fn(),
	};
}

function publishDef( def: WallpaperDef ): void {
	const w = window as unknown as {
		openStationWallpapers?: Record< string, WallpaperDef >;
	};
	w.openStationWallpapers = w.openStationWallpapers || {};
	w.openStationWallpapers[ def.id ] = def;
}

const ctx = {
	id: 'wp-living-tree',
	prefersReducedMotion: false,
	visible: true,
	pluginUrl: '',
	settings: {},
} as WallpaperContext;

describe( 'wallpapers — deferred hydration', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
		delete ( window as unknown as { openStationWallpapers?: unknown } )
			.openStationWallpapers;
	} );

	test( 'sync registers a usable stub without fetching the bundle', async () => {
		const m = await loadModulesUnderTest();
		const load = vi
			.spyOn( m.vendorLoader, 'loadVendorScript' )
			.mockResolvedValue( undefined );

		const sync = m.serverSync.createWallpaperRegistrySync( {
			osSettings: fakeSettings() as never,
		} );
		await sync( [ serverEntry() ] );

		expect( load ).not.toHaveBeenCalled();
		const def = m.registry.get( 'wp-living-tree' );
		expect( def ).toBeDefined();
		expect( def?.label ).toBe( 'Living Tree' );
		expect( def?.preview ).toBe( 'linear-gradient(#0b3, #062)' );
		expect( def?.description ).toBe( 'A tree that grows with your site.' );
		expect( m.lazy.isPending( 'wp-living-tree' ) ).toBe( true );
	} );

	test( 'the active wallpaper hydrates on sync — the desktop is about to paint it', async () => {
		const m = await loadModulesUnderTest();
		vi.spyOn( m.vendorLoader, 'loadVendorScript' ).mockImplementation(
			async () => {
				publishDef( {
					id: 'wp-living-tree',
					label: 'Living Tree',
					type: 'canvas',
					preview: '#0b3',
					mount: () => () => {},
				} as CanvasWallpaperDef );
			},
		);

		const sync = m.serverSync.createWallpaperRegistrySync( {
			osSettings: fakeSettings( 'wp-living-tree' ) as never,
		} );
		await sync( [ serverEntry() ] );

		expect( m.lazy.isPending( 'wp-living-tree' ) ).toBe( false );
		// The real def landed — with the server description overlaid,
		// since the JS side didn't carry one.
		expect( m.registry.get( 'wp-living-tree' )?.description ).toBe(
			'A tree that grows with your site.',
		);
	} );

	test( 'hydrateAll pulls in everything still on the shelf', async () => {
		const m = await loadModulesUnderTest();
		const loaded: string[] = [];
		vi.spyOn( m.vendorLoader, 'loadVendorScript' ).mockImplementation(
			async ( url: string ) => {
				loaded.push( url );
				const id = url.includes( 'snow' ) ? 'wp-snow' : 'wp-living-tree';
				publishDef( {
					id,
					label: id,
					type: 'canvas',
					preview: '#fff',
					mount: () => () => {},
				} as CanvasWallpaperDef );
			},
		);

		const sync = m.serverSync.createWallpaperRegistrySync( {
			osSettings: fakeSettings() as never,
		} );
		await sync( [
			serverEntry(),
			serverEntry( {
				id: 'wp-snow',
				label: 'Snow',
				scriptUrl: 'https://example.test/snow.js',
			} ),
		] );
		expect( loaded ).toEqual( [] );

		await m.lazy.hydrateAll();

		expect( loaded.sort() ).toEqual( [
			'https://example.test/living-tree.js',
			'https://example.test/snow.js',
		] );
		expect( m.lazy.isPending( 'wp-living-tree' ) ).toBe( false );
		expect( m.lazy.isPending( 'wp-snow' ) ).toBe( false );
	} );

	test( 'concurrent hydrate calls share one load', async () => {
		const m = await loadModulesUnderTest();
		const load = vi
			.spyOn( m.vendorLoader, 'loadVendorScript' )
			.mockImplementation( async () => {
				publishDef( {
					id: 'wp-living-tree',
					label: 'Living Tree',
					type: 'canvas',
					preview: '#0b3',
					mount: () => () => {},
				} as CanvasWallpaperDef );
			} );

		const sync = m.serverSync.createWallpaperRegistrySync( {
			osSettings: fakeSettings() as never,
		} );
		await sync( [ serverEntry() ] );

		await Promise.all( [
			m.lazy.hydrate( 'wp-living-tree' ),
			m.lazy.hydrate( 'wp-living-tree' ),
			m.lazy.hydrateAll(),
		] );

		expect( load ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'mounting a stub hydrates it, resolves needs, and delegates', async () => {
		const m = await loadModulesUnderTest();
		const realMount = vi.fn( () => () => {} );
		vi.spyOn( m.vendorLoader, 'loadVendorScript' ).mockImplementation(
			async () => {
				publishDef( {
					id: 'wp-living-tree',
					label: 'Living Tree',
					type: 'canvas',
					preview: '#0b3',
					needs: [ 'pixijs' ],
					mount: realMount,
				} as CanvasWallpaperDef );
			},
		);
		const loadModulesSpy = vi
			.spyOn( m.modules, 'loadModules' )
			.mockResolvedValue( undefined );

		const sync = m.serverSync.createWallpaperRegistrySync( {
			osSettings: fakeSettings() as never,
		} );
		await sync( [ serverEntry() ] );

		const stub = m.registry.get( 'wp-living-tree' ) as CanvasWallpaperDef;
		const container = document.createElement( 'div' );
		const teardown = await stub.mount( container, ctx );

		expect( loadModulesSpy ).toHaveBeenCalledWith( [ 'pixijs' ] );
		expect( realMount ).toHaveBeenCalledWith( container, ctx );
		expect( typeof teardown ).toBe( 'function' );
	} );

	test( 'a failed load leaves the stub in place and retryable', async () => {
		const m = await loadModulesUnderTest();
		const load = vi
			.spyOn( m.vendorLoader, 'loadVendorScript' )
			.mockRejectedValue( new Error( 'offline' ) );

		const sync = m.serverSync.createWallpaperRegistrySync( {
			osSettings: fakeSettings() as never,
		} );
		await sync( [ serverEntry() ] );

		await expect( m.lazy.hydrate( 'wp-living-tree' ) ).resolves.toBeNull();

		// Tile survives, so the picker still shows the wallpaper.
		expect( m.registry.get( 'wp-living-tree' ) ).toBeDefined();
		// And the next attempt re-fetches rather than caching the failure.
		expect( m.lazy.isPending( 'wp-living-tree' ) ).toBe( true );
		await m.lazy.hydrate( 'wp-living-tree' );
		expect( load ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'a CSS wallpaper with a static value never becomes a stub', async () => {
		const m = await loadModulesUnderTest();
		const load = vi
			.spyOn( m.vendorLoader, 'loadVendorScript' )
			.mockResolvedValue( undefined );

		const sync = m.serverSync.createWallpaperRegistrySync( {
			osSettings: fakeSettings() as never,
		} );
		await sync( [
			serverEntry( {
				id: 'os-dark',
				label: 'Dark',
				type: 'css',
				value: '#101014',
				scriptUrl: '',
			} ),
		] );

		expect( load ).not.toHaveBeenCalled();
		expect( m.lazy.isPending( 'os-dark' ) ).toBe( false );
		expect( m.registry.get( 'os-dark' )?.type ).toBe( 'css' );
	} );

	test( 'an entry with no server-side preview loads eagerly — nothing to stub', async () => {
		const m = await loadModulesUnderTest();
		const load = vi
			.spyOn( m.vendorLoader, 'loadVendorScript' )
			.mockImplementation( async () => {
				publishDef( {
					id: 'wp-living-tree',
					label: 'Living Tree',
					type: 'canvas',
					// The swatch the server never declared.
					preview: '#0b3',
					mount: () => () => {},
				} as CanvasWallpaperDef );
			} );

		const sync = m.serverSync.createWallpaperRegistrySync( {
			osSettings: fakeSettings() as never,
		} );
		await sync( [ serverEntry( { preview: '', value: '' } ) ] );

		expect( load ).toHaveBeenCalledTimes( 1 );
		expect( m.registry.get( 'wp-living-tree' )?.preview ).toBe( '#0b3' );
		expect( m.lazy.isPending( 'wp-living-tree' ) ).toBe( false );
	} );

	test( 'deactivation drops the pending entry with the registration', async () => {
		const m = await loadModulesUnderTest();
		vi.spyOn( m.vendorLoader, 'loadVendorScript' ).mockResolvedValue(
			undefined,
		);

		const sync = m.serverSync.createWallpaperRegistrySync( {
			osSettings: fakeSettings() as never,
		} );
		await sync( [ serverEntry() ] );
		expect( m.lazy.isPending( 'wp-living-tree' ) ).toBe( true );

		await sync( [] );

		expect( m.registry.get( 'wp-living-tree' ) ).toBeUndefined();
		expect( m.lazy.isPending( 'wp-living-tree' ) ).toBe( false );
	} );
} );
