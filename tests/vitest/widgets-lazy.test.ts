/**
 * A widget's bundle loads when the widget mounts, not when the shell
 * boots.
 *
 * Everything the picker shows about a widget — label, description,
 * icon, size constraints — is metadata `openstation_register_widget()`
 * declares in PHP. The only thing the plugin's bundle contributes is
 * the `mount` callback. So the def is assembled from the payload and
 * its mount loads the script on first use, which means a widget the
 * user has never enabled costs a row in the picker and nothing else.
 *
 * Before this, the sync `await`ed a script load per registered
 * widget, so all nine built-in bundles (Drafts 46 KB, Focus Timer
 * 41 KB, Notes 31 KB, …) downloaded on every admin page whether or
 * not a single widget was on the desktop.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import type { DesktopWidgetServerEntry } from '../../src/types';
import type { WidgetContext, WidgetTeardown } from '../../src/widgets/types';

type Registry = typeof import( '../../src/widgets/registry' );
type ServerSync = typeof import( '../../src/widgets/server-sync' );
type VendorLoader = typeof import( '../../src/wallpapers/vendor-loader' );

interface Modules {
	registry: Registry;
	serverSync: ServerSync;
	vendorLoader: VendorLoader;
}

async function loadModulesUnderTest(): Promise< Modules > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	return {
		registry: await import( '../../src/widgets/registry' ),
		serverSync: await import( '../../src/widgets/server-sync' ),
		vendorLoader: await import( '../../src/wallpapers/vendor-loader' ),
	};
}

function serverEntry(
	overrides: Partial< DesktopWidgetServerEntry > = {},
): DesktopWidgetServerEntry {
	return {
		id: 'os/drafts',
		label: 'Drafts',
		description: 'Your unfinished posts.',
		icon: 'dashicons-edit',
		movable: true,
		resizable: true,
		minWidth: 0,
		minHeight: 0,
		maxWidth: 0,
		maxHeight: 0,
		defaultWidth: 0,
		defaultHeight: 0,
		scriptUrl: 'https://example.test/widget-drafts.js',
		scriptHandle: 'os-widget-drafts',
		...overrides,
	} as DesktopWidgetServerEntry;
}

function publishMount(
	id: string,
	mount: ( c: HTMLElement, ctx: WidgetContext ) => WidgetTeardown,
): void {
	const w = window as unknown as {
		openStationWidgets?: Record< string, unknown >;
	};
	w.openStationWidgets = w.openStationWidgets || {};
	w.openStationWidgets[ id ] = mount;
}

const ctx = {
	id: 'os/drafts',
	pluginUrl: '',
	storage: {},
} as unknown as WidgetContext;

describe( 'widgets — deferred bundle loading', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
		delete ( window as unknown as { openStationWidgets?: unknown } )
			.openStationWidgets;
	} );

	test( 'sync registers a fully-described def without fetching the bundle', async () => {
		const m = await loadModulesUnderTest();
		const load = vi
			.spyOn( m.vendorLoader, 'loadVendorScript' )
			.mockResolvedValue( undefined );

		const sync = m.serverSync.createWidgetRegistrySync( { layer: null } );
		await sync( [ serverEntry() ] );

		expect( load ).not.toHaveBeenCalled();
		const def = m.registry.all().find( ( d ) => d.id === 'os/drafts' );
		expect( def ).toBeDefined();
		expect( def?.label ).toBe( 'Drafts' );
		expect( def?.description ).toBe( 'Your unfinished posts.' );
		expect( def?.icon ).toBe( 'dashicons-edit' );
	} );

	test( 'mounting loads the bundle and delegates to the plugin callback', async () => {
		const m = await loadModulesUnderTest();
		const realMount = vi.fn( () => () => {} );
		const load = vi
			.spyOn( m.vendorLoader, 'loadVendorScript' )
			.mockImplementation( async () => {
				publishMount( 'os/drafts', realMount );
			} );

		const sync = m.serverSync.createWidgetRegistrySync( { layer: null } );
		await sync( [ serverEntry() ] );

		const def = m.registry.all().find( ( d ) => d.id === 'os/drafts' );
		const container = document.createElement( 'div' );
		const teardown = await def!.mount( container, ctx );

		expect( load ).toHaveBeenCalledTimes( 1 );
		expect( realMount ).toHaveBeenCalledWith( container, ctx );
		expect( typeof teardown ).toBe( 'function' );
	} );

	test( 'a second mount reuses the loaded bundle', async () => {
		const m = await loadModulesUnderTest();
		const load = vi
			.spyOn( m.vendorLoader, 'loadVendorScript' )
			.mockImplementation( async () => {
				publishMount( 'os/drafts', () => () => {} );
			} );

		const sync = m.serverSync.createWidgetRegistrySync( { layer: null } );
		await sync( [ serverEntry() ] );
		const def = m.registry.all().find( ( d ) => d.id === 'os/drafts' );

		await def!.mount( document.createElement( 'div' ), ctx );
		await def!.mount( document.createElement( 'div' ), ctx );

		expect( load ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a package Core concatenated into load-scripts.php is not fetched again', async () => {
		// The path #715 reports. On a stock wp-admin `wp-hooks` is in
		// the tab inside Core's concat blob, with no `<script src>`
		// carrying its path, and the widget manifest lists it as a
		// dependency. The loader recognizes it by handle — but only if
		// this sync forwards the payload's `scriptDeps` intact. A
		// mapping that dropped `handle` would pass every unit test the
		// loader has and still re-inject `wp-hooks`, replacing
		// `window.wp.hooks` under every subscriber the shell registered
		// at boot. So: real loader, real presence test; only
		// `appendChild` is stubbed, to answer `load` without a network.
		const m = await loadModulesUnderTest();
		const blob = document.createElement( 'script' );
		blob.src =
			'https://site.test/wp-admin/load-scripts.php?c=1&load%5Bchunk_0%5D=jquery-core,wp-hooks&ver=6.9';
		document.head.append( blob );

		const appended: string[] = [];
		vi.spyOn( document.head, 'appendChild' ).mockImplementation(
			( node ) => {
				const el = node as HTMLScriptElement;
				if ( el.tagName === 'SCRIPT' && el.src ) {
					appended.push( new URL( el.src ).pathname );
					if ( el.src.includes( 'widget-drafts.js' ) ) {
						publishMount( 'os/drafts', () => () => {} );
					}
					queueMicrotask( () => el.dispatchEvent( new Event( 'load' ) ) );
				}
				return node;
			},
		);

		try {
			const sync = m.serverSync.createWidgetRegistrySync( { layer: null } );
			await sync( [
				serverEntry( {
					scriptDeps: [
						{
							handle: 'wp-hooks',
							url: 'https://site.test/wp-includes/js/dist/hooks.min.js',
						},
						{
							handle: 'wp-api-fetch',
							url: 'https://site.test/wp-includes/js/dist/api-fetch.min.js',
						},
					],
				} ),
			] );
			const def = m.registry.all().find( ( d ) => d.id === 'os/drafts' );
			await def!.mount( document.createElement( 'div' ), ctx );
		} finally {
			blob.remove();
		}

		// api-fetch is genuinely absent and still loads, in order,
		// before the widget's own bundle; the concatenated package is
		// the only thing skipped.
		expect( appended ).toEqual( [
			'/wp-includes/js/dist/api-fetch.min.js',
			'/widget-drafts.js',
		] );
	} );

	test( 'a bundle that publishes no callback throws so the card shows its error state', async () => {
		const m = await loadModulesUnderTest();
		vi.spyOn( m.vendorLoader, 'loadVendorScript' ).mockResolvedValue(
			undefined,
		);

		const sync = m.serverSync.createWidgetRegistrySync( { layer: null } );
		await sync( [ serverEntry() ] );
		const def = m.registry.all().find( ( d ) => d.id === 'os/drafts' );

		await expect(
			def!.mount( document.createElement( 'div' ), ctx ),
		).rejects.toThrow( /No mount callback/ );
	} );

	test( 'deactivation unregisters the def', async () => {
		const m = await loadModulesUnderTest();
		vi.spyOn( m.vendorLoader, 'loadVendorScript' ).mockResolvedValue(
			undefined,
		);

		const sync = m.serverSync.createWidgetRegistrySync( { layer: null } );
		await sync( [ serverEntry() ] );
		expect(
			m.registry.all().some( ( d ) => d.id === 'os/drafts' ),
		).toBe( true );

		await sync( [] );

		expect(
			m.registry.all().some( ( d ) => d.id === 'os/drafts' ),
		).toBe( false );
	} );
} );
