/**
 * Tests for the native Plugins window's REST + admin-ajax glue.
 *
 * The bundle is a thin layer over `fetch`; the regressions we care
 * about are:
 *   1. The window-config blob is required — missing config must
 *      throw a useful error rather than silently fall back.
 *   2. `X-WP-Nonce` is attached to every Core REST request.
 *   3. The admin-ajax envelope `{ success, data }` is unwrapped so
 *      callers receive the inner `data`.
 *   4. Install-by-slug uses Core's `'updates'` nonce, NOT our window
 *      nonce — that's what `wp_ajax_install_plugin` verifies against.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	activateInstalledPlugin,
	browsePlugins,
	deactivateInstalledPlugin,
	deleteInstalledPlugin,
	fetchInstalledPlugins,
	getConfig,
	installPluginBySlug,
	uploadPluginZip,
	type PluginsWindowConfig,
} from '../../src/plugins-window/rest';
import type { InstalledPlugin } from '../../src/plugins-window/types';

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	interface Window {
		desktopModeWindowConfig?: Record< string, unknown >;
	}
}

const PLUGINS_URL = 'http://example.test/wp-json/wp/v2/plugins';
const AJAX_URL    = 'http://example.test/wp-admin/admin-ajax.php';

function installConfig( over: Partial< PluginsWindowConfig > = {} ): void {
	const cfg: PluginsWindowConfig = {
		restRoot:      'http://example.test/wp-json/',
		restNonce:     'rest-nonce',
		pluginsUrl:    PLUGINS_URL,
		ajaxUrl:       AJAX_URL,
		ajaxNonce:     'plugins-window-nonce',
		updatesNonce:  'updates-nonce',
		caps:          {
			activate: true,
			install:  true,
			delete:   true,
			upload:   true,
		},
		currentUserId: 1,
		introSeen:     true,
		introUrl:      'http://example.test/wp-json/desktop-mode/v1/intros/seen',
		...over,
	};
	window.desktopModeWindowConfig = window.desktopModeWindowConfig ?? {};
	window.desktopModeWindowConfig[ 'desktop-mode-plugins' ] = cfg;
}

function jsonResponse( body: unknown, status = 200 ): Response {
	return new Response( JSON.stringify( body ), {
		status,
		headers: { 'Content-Type': 'application/json' },
	} );
}

function ajaxOkResponse( data: unknown ): Response {
	return jsonResponse( { success: true, data } );
}

const FAKE_INSTALLED: InstalledPlugin = {
	plugin:     'akismet/akismet.php',
	status:     'inactive',
	name:       'Akismet',
	textdomain: 'akismet',
};

beforeEach( () => {
	installConfig();
} );

afterEach( () => {
	delete window.desktopModeWindowConfig;
	vi.restoreAllMocks();
} );

describe( 'getConfig', () => {
	test( 'throws when the config blob is missing', () => {
		delete window.desktopModeWindowConfig;
		expect( () => getConfig() ).toThrow( /config blob is missing/ );
	} );

	test( 'returns the registered blob', () => {
		const cfg = getConfig();
		expect( cfg.pluginsUrl ).toBe( PLUGINS_URL );
		expect( cfg.ajaxUrl ).toBe( AJAX_URL );
	} );
} );

describe( 'fetchInstalledPlugins', () => {
	test( 'GETs Core REST with the X-WP-Nonce header', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( [] ) as never,
		);
		await fetchInstalledPlugins();
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toContain( PLUGINS_URL );
		expect( url ).toContain( 'context=view' );
		expect( url ).toContain( 'per_page=100' );
		const headers = ( init.headers ?? {} ) as Record< string, string >;
		expect( headers[ 'X-WP-Nonce' ] ).toBe( 'rest-nonce' );
	} );

	test( 'surfaces WP_Error JSON in the thrown error', async () => {
		vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			new Response(
				JSON.stringify( {
					code:    'rest_forbidden',
					message: 'Sorry, you can’t.',
				} ),
				{ status: 403, headers: { 'Content-Type': 'application/json' } },
			) as never,
		);
		await expect( fetchInstalledPlugins() ).rejects.toThrow(
			/Sorry, you can/,
		);
	} );

	test( 'appends ?desktop_mode_force_refresh=1 when force is true', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( [] ) as never,
		);
		await fetchInstalledPlugins( { force: true } );
		const [ url ] = fetchMock.mock.calls[ 0 ] as [ string, RequestInit ];
		expect( url ).toContain( 'desktop_mode_force_refresh=1' );
	} );

	test( 'omits the force flag by default', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( [] ) as never,
		);
		await fetchInstalledPlugins();
		const [ url ] = fetchMock.mock.calls[ 0 ] as [ string, RequestInit ];
		expect( url ).not.toContain( 'desktop_mode_force_refresh' );
	} );
} );

describe( 'activate / deactivate / delete', () => {
	test( 'activate sends PUT with status=active to /plugins/{plugin}', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( { ...FAKE_INSTALLED, status: 'active' } ) as never,
		);
		await activateInstalledPlugin( FAKE_INSTALLED );
		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		// Per-segment encode — slashes stay literal so Apache's
		// default `AllowEncodedSlashes Off` doesn't reject the route.
		expect( url ).toBe(
			`${ PLUGINS_URL }/${ FAKE_INSTALLED.plugin
				.split( '/' )
				.map( encodeURIComponent )
				.join( '/' ) }`,
		);
		// `akismet/akismet.php` has no segment that needs encoding,
		// so the assertion ends up identical to the literal path.
		expect( url ).toContain( '/akismet/akismet.php' );
		expect( init.method ).toBe( 'PUT' );
		expect( JSON.parse( init.body as string ) ).toEqual( { status: 'active' } );
	} );

	test( 'deactivate sends PUT with status=inactive', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( { ...FAKE_INSTALLED, status: 'inactive' } ) as never,
		);
		await deactivateInstalledPlugin( {
			...FAKE_INSTALLED,
			status: 'active',
		} );
		const init = fetchMock.mock.calls[ 0 ]![ 1 ] as RequestInit;
		expect( JSON.parse( init.body as string ) ).toEqual( { status: 'inactive' } );
	} );

	test( 'delete sends DELETE with force=true', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			new Response( null, { status: 200 } ) as never,
		);
		await deleteInstalledPlugin( FAKE_INSTALLED );
		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toContain( 'force=true' );
		expect( init.method ).toBe( 'DELETE' );
	} );
} );

describe( 'browsePlugins', () => {
	test( 'POSTs to admin-ajax with our nonce + sends the inner data', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			ajaxOkResponse( {
				plugins: [ { slug: 'akismet', name: 'Akismet' } ],
				info:    { results: 1 },
			} ) as never,
		);
		const out = await browsePlugins( { browse: 'featured', perPage: 10 } );
		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toBe( AJAX_URL );
		expect( init.method ).toBe( 'POST' );
		const body = init.body as URLSearchParams;
		expect( body.get( 'action' ) ).toBe( 'desktop_mode_plugins_browse' );
		expect( body.get( '_ajax_nonce' ) ).toBe( 'plugins-window-nonce' );
		expect( body.get( 'browse' ) ).toBe( 'featured' );
		expect( body.get( 'per_page' ) ).toBe( '10' );
		expect( out.plugins ).toHaveLength( 1 );
	} );

	test( 'unwraps a `success: false` envelope into a thrown error', async () => {
		vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( {
				success: false,
				data:    { message: 'wp.org is sleeping' },
			} ) as never,
		);
		await expect( browsePlugins( {} ) ).rejects.toThrow( /wp\.org is sleeping/ );
	} );
} );

describe( 'installPluginBySlug', () => {
	test( 'uses Core’s `updates` nonce, not our window nonce', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			ajaxOkResponse( { plugin: 'akismet/akismet.php', slug: 'akismet' } ) as never,
		);
		await installPluginBySlug( 'akismet' );
		const init = fetchMock.mock.calls[ 0 ]![ 1 ] as RequestInit;
		const body = init.body as URLSearchParams;
		expect( body.get( 'action' ) ).toBe( 'install-plugin' );
		expect( body.get( '_ajax_nonce' ) ).toBe( 'updates-nonce' );
		expect( body.get( 'slug' ) ).toBe( 'akismet' );
	} );
} );

describe( 'uploadPluginZip', () => {
	test( 'POSTs multipart with our window nonce + the file under `pluginzip`', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			ajaxOkResponse( {
				plugin_file:    'akismet/akismet.php',
				plugin_name:    'Akismet',
				plugin_version: '5.7',
				status:         'inactive',
				messages:       [],
			} ) as never,
		);
		const file = new File(
			[ 'PK\x03\x04dummy zip bytes' ],
			'akismet.zip',
			{ type: 'application/zip' },
		);
		await uploadPluginZip( file );
		const init = fetchMock.mock.calls[ 0 ]![ 1 ] as RequestInit;
		expect( init.method ).toBe( 'POST' );
		const data = init.body as FormData;
		expect( data.get( 'action' ) ).toBe( 'desktop_mode_plugins_upload' );
		expect( data.get( '_ajax_nonce' ) ).toBe( 'plugins-window-nonce' );
		const submitted = data.get( 'pluginzip' );
		expect( submitted ).toBeInstanceOf( File );
		expect( ( submitted as File ).name ).toBe( 'akismet.zip' );
		// `overwrite` is omitted on the initial attempt — only set
		// after the user confirms the overwrite prompt.
		expect( data.get( 'overwrite' ) ).toBeNull();
	} );

	test( 'passes `overwrite=1` when called with { overwrite: true }', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			ajaxOkResponse( {
				plugin_file:    'akismet/akismet.php',
				plugin_name:    'Akismet',
				plugin_version: '5.7',
				status:         'inactive',
				messages:       [],
			} ) as never,
		);
		const file = new File(
			[ 'PK\x03\x04dummy zip bytes' ],
			'akismet.zip',
			{ type: 'application/zip' },
		);
		await uploadPluginZip( file, { overwrite: true } );
		const init = fetchMock.mock.calls[ 0 ]![ 1 ] as RequestInit;
		const data = init.body as FormData;
		expect( data.get( 'overwrite' ) ).toBe( '1' );
	} );

	test( 'surfaces server `folder_exists` error with status code', async () => {
		vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			new Response(
				JSON.stringify( {
					success: false,
					data:    {
						code:    'folder_exists',
						message: 'A plugin with the same folder name is already installed. Replace it to continue.',
					},
				} ),
				{
					status:  409,
					headers: { 'Content-Type': 'application/json' },
				},
			) as never,
		);
		const file = new File(
			[ 'PK\x03\x04dummy zip bytes' ],
			'akismet.zip',
			{ type: 'application/zip' },
		);
		await expect( uploadPluginZip( file ) ).rejects.toMatchObject( {
			code:    'folder_exists',
			status:  409,
		} );
	} );
} );
