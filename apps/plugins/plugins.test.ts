/**
 * Plugins app — the client half: the view frame (tabs gated by the
 * caps, the update badge, the bulk bar, the phone layout), the
 * installed-list filter, the admin-ajax client (nonces, envelopes,
 * multipart upload), the wp.org icon candidate chain, and the
 * directory-slug gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockViewContext } from '../../src/app-runtime/testing';
import { attachIconFallback } from './parts/icon-fallback';
import { deriveSlug } from './parts/installed-detail';
import { countUpdates, filterRows } from './parts/installed-table';
import { createPluginsRest } from './parts/rest';
import type { AppData, AppState, InstalledPlugin, PluginsExtra } from './parts/types';
import app from './plugins.os';

const AJAX_URL = 'http://example.test/wp-admin/admin-ajax.php';

function extra( over: Partial< PluginsExtra > = {} ): PluginsExtra {
	return {
		ajaxUrl: AJAX_URL,
		ajaxNonce: 'plugins-window-nonce',
		updatesNonce: 'updates-nonce',
		caps: { activate: true, install: true, delete: true, upload: true, update: true },
		autoUpdatesEnabled: true,
		currentUserId: 1,
		selfPluginFile: 'desktop-mode/desktop-mode',
		adminUrl: 'http://example.test/wp-admin/',
		...over,
	};
}

function row( over: Partial< InstalledPlugin > = {} ): InstalledPlugin {
	return {
		plugin: 'akismet/akismet',
		status: 'inactive',
		name: 'Akismet',
		textdomain: 'akismet',
		author: 'Automattic',
		...over,
	};
}

function jsonResponse( body: unknown, status = 200 ): Response {
	return new Response( JSON.stringify( body ), { status, headers: { 'Content-Type': 'application/json' } } );
}

const ajaxOk = ( data: unknown ): Response => jsonResponse( { success: true, data } );

function mount(
	state: Partial< AppState > = {},
	data: Partial< AppData > = {},
	over: Partial< PluginsExtra > = {},
) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx = mockViewContext< AppState, AppData >( {
		state: { tab: 'installed', status: '', search: '', browse: 'featured', query: '', ...state },
		data: { installed: [ row() ], error: '', ...data },
		root,
		extra: extra( over ) as unknown as Record< string, unknown >,
	} );
	ctx.repaint = () => app.render( ctx );
	app.render( ctx );
	return { root, ctx };
}

beforeEach( () => {
	// jsdom has no IntersectionObserver; the Browse gallery wires one.
	( globalThis as { IntersectionObserver?: unknown } ).IntersectionObserver ??= class {
		observe() {}
		disconnect() {}
		unobserve() {}
	};
	// The galleries load through admin-ajax on mount — answer empty.
	vi.stubGlobal( 'fetch', vi.fn( async () => ajaxOk( { plugins: [], info: {} } ) ) );
	( window as unknown as { wp?: unknown } ).wp = { os: {} };
} );

afterEach( () => {
	document.body.replaceChildren();
	document.documentElement.removeAttribute( 'data-os-mode' );
	delete ( window as unknown as { wp?: unknown } ).wp;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
} );

describe( 'the plugins app view', () => {
	it( 'paints the three tabs on the state tab, bound to it', () => {
		const { root } = mount( { tab: 'browse' } );
		const tabs = root.querySelector( '[data-os-plugins-tabs]' );
		expect( tabs?.getAttribute( 'value' ) ).toBe( 'browse' );
		expect( tabs?.getAttribute( 'os-bind' ) ).toBe( 'tab' );
		expect( Array.from( root.querySelectorAll( 'os-tab' ) ).map( ( t ) => t.getAttribute( 'value' ) ) ).toEqual( [
			'installed',
			'browse',
			'featured',
		] );
		expect( root.querySelector( '[data-os-plugins-browse-host]' ) ).not.toBeNull();
		expect( root.querySelector( '[data-os-plugins-featured-host]' ) ).not.toBeNull();
		expect( root.querySelector( '[data-os-plugins-flyout]' ) ).not.toBeNull();
	} );

	it( 'hides the marketplace tabs without the install capability', () => {
		const { root } = mount( {}, {}, { caps: { activate: true, install: false, delete: false, upload: false, update: true } } );
		expect( root.querySelectorAll( 'os-tab' ).length ).toBe( 1 );
		expect( root.querySelector( '[data-os-plugins-browse-host]' ) ).toBeNull();
		expect( root.querySelector( '[data-os-plugins-featured-host]' ) ).toBeNull();
	} );

	it( 'replaces the table with a notice when the viewer cannot manage plugins', () => {
		const { root } = mount( {}, {}, { caps: { activate: false, install: false, delete: false, upload: false, update: false } } );
		expect( root.querySelector( '[data-os-plugins-table]' ) ).toBeNull();
		expect( root.querySelector( '[data-os-plugins-installed-host]' )?.textContent ).toContain(
			'You do not have permission to manage plugins.',
		);
	} );

	it( 'counts pending updates on the Update-available segment and keeps the bulk bar hidden until a selection', () => {
		const { root } = mount(
			{},
			{
				installed: [
					row(),
					row( {
						plugin: 'wordpress-seo/wp-seo',
						name: 'Yoast',
						openstation_update_available: { available: true, new_version: '2.0', package: 'x', slug: 'wordpress-seo' },
					} ),
				],
			},
		);
		const badge = root.querySelector( 'os-segment[value="update"] os-badge' );
		expect( badge?.hasAttribute( 'hidden' ) ).toBe( false );
		expect( badge?.textContent ).toBe( '1' );
		expect( root.querySelector( '.os-plugins__bulk' )?.hasAttribute( 'hidden' ) ).toBe( true );
		expect( root.querySelector( '[os-action="reload"]' ) ).not.toBeNull();
		expect( root.querySelector( '[os-bind="status"]' )?.getAttribute( 'value' ) ).toBeNull();
		expect( root.querySelector( '[os-bind="search"]' ) ).not.toBeNull();
	} );

	it( 'moves the bulk bar to the bottom on a phone', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		const { root } = mount();
		expect( root.querySelector( '.os-plugins__toolbar-right' ) ).toBeNull();
		expect( root.querySelector( '.os-plugins__bulk--footer' ) ).not.toBeNull();
		expect( root.querySelector( '[data-os-plugins-table]' )?.hasAttribute( 'stacked' ) ).toBe( true );
	} );

	it( 'offers Upload only to a viewer who may upload, and binds the browse toolbar', () => {
		const { root } = mount();
		expect( root.querySelector( '[data-os-plugins-browse-host] .dashicons-upload' ) ).not.toBeNull();
		expect( root.querySelector( '[os-bind="browse"]' )?.getAttribute( 'value' ) ).toBe( 'featured' );
		expect( root.querySelector( '[os-bind="query"]' ) ).not.toBeNull();
		const no = mount( {}, {}, { caps: { activate: true, install: true, delete: true, upload: false, update: true } } );
		expect( no.root.querySelector( '[data-os-plugins-browse-host] .dashicons-upload' ) ).toBeNull();
	} );
} );

describe( 'filterRows', () => {
	const rows = [
		row(),
		row( { plugin: 'jetpack/jetpack', name: 'Jetpack', status: 'active' } ),
		row( {
			plugin: 'wordpress-seo/wp-seo',
			name: 'Yoast SEO',
			openstation_update_available: { available: true, new_version: '2.0', package: 'x', slug: 'wordpress-seo' },
		} ),
	];

	it( 'segments by status and matches name, path and author', () => {
		expect( filterRows( rows, '', '' ) ).toHaveLength( 3 );
		expect( filterRows( rows, 'active', '' ).map( ( r ) => r.plugin ) ).toEqual( [ 'jetpack/jetpack' ] );
		expect( filterRows( rows, 'inactive', '' ) ).toHaveLength( 2 );
		expect( filterRows( rows, 'update', '' ).map( ( r ) => r.name ) ).toEqual( [ 'Yoast SEO' ] );
		expect( filterRows( rows, '', 'yoast' ) ).toHaveLength( 1 );
		expect( filterRows( rows, '', 'wp-seo' ) ).toHaveLength( 1 );
		expect( filterRows( rows, '', 'automattic' ) ).toHaveLength( 3 );
		expect( countUpdates( rows ) ).toBe( 1 );
	} );
} );

describe( 'the admin-ajax client', () => {
	const fetchMock = (): ReturnType< typeof vi.fn > => globalThis.fetch as unknown as ReturnType< typeof vi.fn >;
	const rest = createPluginsRest( () => extra() );

	it( 'browse POSTs to admin-ajax with the window nonce and returns the inner data', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => ajaxOk( { plugins: [ { slug: 'akismet', name: 'Akismet' } ], info: { results: 1 } } ) ),
		);
		const out = await rest.browsePlugins( { browse: 'featured', perPage: 10 } );
		const [ url, init ] = fetchMock().mock.calls[ 0 ] as [ string, RequestInit ];
		expect( url ).toBe( AJAX_URL );
		expect( init.method ).toBe( 'POST' );
		const body = init.body as URLSearchParams;
		expect( body.get( 'action' ) ).toBe( 'openstation_plugins_browse' );
		expect( body.get( '_ajax_nonce' ) ).toBe( 'plugins-window-nonce' );
		expect( body.get( 'browse' ) ).toBe( 'featured' );
		expect( body.get( 'per_page' ) ).toBe( '10' );
		expect( out.plugins ).toHaveLength( 1 );
	} );

	it( 'reads the nonce at call time, so a refreshed one is picked up', async () => {
		const cfg = extra();
		const live = createPluginsRest( () => cfg );
		vi.stubGlobal( 'fetch', vi.fn( async () => ajaxOk( {} ) ) );
		cfg.ajaxNonce = 'rolled';
		await live.fetchPluginInfo( 'akismet' );
		const init = fetchMock().mock.calls[ 0 ][ 1 ] as RequestInit;
		expect( ( init.body as URLSearchParams ).get( '_ajax_nonce' ) ).toBe( 'rolled' );
	} );

	it( 'unwraps a `success: false` envelope into a thrown error', async () => {
		vi.stubGlobal( 'fetch', vi.fn( async () => jsonResponse( { success: false, data: { message: 'wp.org is sleeping' } } ) ) );
		await expect( rest.browsePlugins( {} ) ).rejects.toThrow( /wp\.org is sleeping/ );
	} );

	it( 'install and update use Core’s `updates` nonce and the full plugin file', async () => {
		vi.stubGlobal( 'fetch', vi.fn( async () => ajaxOk( { plugin: 'akismet/akismet.php', slug: 'akismet' } ) ) );
		await rest.installPluginBySlug( 'akismet' );
		let body = ( fetchMock().mock.calls[ 0 ][ 1 ] as RequestInit ).body as URLSearchParams;
		expect( body.get( 'action' ) ).toBe( 'install-plugin' );
		expect( body.get( '_ajax_nonce' ) ).toBe( 'updates-nonce' );
		expect( body.get( 'slug' ) ).toBe( 'akismet' );

		await rest.updateInstalledPlugin( row() );
		body = ( fetchMock().mock.calls[ 1 ][ 1 ] as RequestInit ).body as URLSearchParams;
		expect( body.get( 'action' ) ).toBe( 'update-plugin' );
		expect( body.get( 'plugin' ) ).toBe( 'akismet/akismet.php' );
		expect( body.get( '_ajax_nonce' ) ).toBe( 'updates-nonce' );

		await rest.toggleAutoUpdate( row(), 'enable' );
		body = ( fetchMock().mock.calls[ 2 ][ 1 ] as RequestInit ).body as URLSearchParams;
		expect( body.get( 'action' ) ).toBe( 'toggle-auto-updates' );
		expect( body.get( 'asset' ) ).toBe( 'akismet/akismet.php' );
		expect( body.get( 'state' ) ).toBe( 'enable' );
	} );

	it( 'uploads multipart with the window nonce and the file under `pluginzip`', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( async () =>
				ajaxOk( { plugin_file: 'akismet/akismet.php', plugin_name: 'Akismet', plugin_version: '5.7', status: 'inactive', messages: [] } ),
			),
		);
		const file = new File( [ 'PK\x03\x04dummy zip bytes' ], 'akismet.zip', { type: 'application/zip' } );
		await rest.uploadPluginZip( file );
		let data = ( fetchMock().mock.calls[ 0 ][ 1 ] as RequestInit ).body as FormData;
		expect( data.get( 'action' ) ).toBe( 'openstation_plugins_upload' );
		expect( data.get( '_ajax_nonce' ) ).toBe( 'plugins-window-nonce' );
		expect( ( data.get( 'pluginzip' ) as File ).name ).toBe( 'akismet.zip' );
		expect( data.get( 'overwrite' ) ).toBeNull();

		await rest.uploadPluginZip( file, { overwrite: true } );
		data = ( fetchMock().mock.calls[ 1 ][ 1 ] as RequestInit ).body as FormData;
		expect( data.get( 'overwrite' ) ).toBe( '1' );
	} );

	it( 'surfaces the server’s `folder_exists` with its status code', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( async () =>
				jsonResponse( { success: false, data: { code: 'folder_exists', message: 'Replace it to continue.' } }, 409 ),
			),
		);
		const file = new File( [ 'PK' ], 'akismet.zip', { type: 'application/zip' } );
		await expect( rest.uploadPluginZip( file ) ).rejects.toMatchObject( { code: 'folder_exists', status: 409 } );
	} );

	it( 'recognises OpenStation itself with or without the extension', () => {
		expect( rest.isOpenStationSelf( 'desktop-mode/desktop-mode' ) ).toBe( true );
		expect( rest.isOpenStationSelf( 'desktop-mode/desktop-mode.php' ) ).toBe( true );
		expect( rest.isOpenStationSelf( 'akismet/akismet' ) ).toBe( false );
	} );
} );

describe( 'attachIconFallback', () => {
	const fireError = ( img: HTMLImageElement ): void => {
		img.dispatchEvent( new Event( 'error' ) );
	};

	it( 'walks every wp.org format at 256 before dropping to 128, then exhausts', () => {
		const img = document.createElement( 'img' );
		const base = 'https://ps.w.org/elementor/assets/';
		const seen: string[] = [];
		let exhausted = false;
		const firstSrc = attachIconFallback( img, base + 'icon.svg', () => {
			exhausted = true;
		} );
		expect( firstSrc ).toBe( base + 'icon.svg' );
		seen.push( firstSrc );
		img.src = firstSrc;
		for ( let i = 0; i < 8; i++ ) {
			fireError( img );
			seen.push( img.src );
		}
		expect( seen ).toEqual( [
			base + 'icon.svg',
			base + 'icon-256x256.png',
			base + 'icon-256x256.jpg',
			base + 'icon-256x256.jpeg',
			base + 'icon-256x256.gif',
			base + 'icon-128x128.png',
			base + 'icon-128x128.jpg',
			base + 'icon-128x128.jpeg',
			base + 'icon-128x128.gif',
		] );
		expect( exhausted ).toBe( false );
		fireError( img );
		expect( exhausted ).toBe( true );
	} );

	it( 'custom and local-folder URLs are one-shot', () => {
		for ( const url of [
			'https://cdn.example.com/my-plugin/icon.png',
			'http://example.test/wp-content/plugins/my-plugin/assets/icon.svg',
		] ) {
			const img = document.createElement( 'img' );
			let exhausted = false;
			img.src = attachIconFallback( img, url, () => {
				exhausted = true;
			} );
			expect( img.src ).toBe( url );
			fireError( img );
			expect( exhausted ).toBe( true );
		}
	} );
} );

describe( 'deriveSlug', () => {
	it( 'uses only the directory slug the server resolved — never the folder or the text domain', () => {
		expect( deriveSlug( row( { openstation_wporg_slug: 'akismet' } ) ) ).toBe( 'akismet' );
		expect( deriveSlug( row( { plugin: 'hello', textdomain: 'hello-dolly', openstation_wporg_slug: 'hello-dolly' } ) ) ).toBe(
			'hello-dolly',
		);
		expect( deriveSlug( row( { openstation_wporg_slug: null } ) ) ).toBe( '' );
		expect(
			deriveSlug(
				row( {
					plugin: 'acme-private-widgets/acme-private-widgets',
					textdomain: 'acme-private-widgets',
					openstation_icon_url: 'https://ps.w.org/acme-private-widgets/assets/icon.svg',
					openstation_wporg_slug: null,
				} ),
			),
		).toBe( '' );
		expect( deriveSlug( row() ) ).toBe( '' );
	} );
} );
