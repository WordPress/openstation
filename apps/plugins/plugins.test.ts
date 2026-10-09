/**
 * Plugins app — the client half: the view frame (tabs gated by the
 * caps, the status filter and its update count, the bulk bar, the
 * phone layout), the installed-list filter, the admin-ajax client
 * (nonces, envelopes, error mapping, multipart upload), the wp.org
 * HTML sanitiser, the changelog / FAQ parsers, the self-mutation
 * exit, the up-to-date detection, the bulk gating, the upload's
 * replace flow, the Browse gallery's paging, the card drag teardown,
 * the Heartbeat echo skip, the wp.org icon candidate chain and the
 * directory-slug gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeHost } from '@openstation/app';
import { mockViewContext, renderedText } from '../../src/app-runtime/testing';
import { bulkButtons, freshBusy, isUpToDateError } from './parts/actions';
import { installPluginDropTargets } from './parts/card-drag';
import { createBrowseGallery } from './parts/gallery';
import { isSafeUrl, sanitizeHtml, stripHtml } from './parts/html';
import { attachIconFallback } from './parts/icon-fallback';
import { deriveSlug } from './parts/installed-detail';
import { countUpdates, filterRows, freshInstalledUi, haystacksFor } from './parts/installed-library';
import { leaveAfterSelfMutation, selfGone } from './parts/mutations';
import { createPluginsRest, readJsonOrThrow, unwrapAjaxEnvelope } from './parts/rest';
import {
	fullPluginFile,
	isActiveStatus,
	pluginChangeId,
	type AppData,
	type AppState,
	type InstalledPlugin,
	type PluginsExtra,
	type PluginsHost,
} from './parts/types';
import type { OsTable } from '../../src/ui/components/os-table/os-table';
import { openDetailFlyout } from './parts/flyout-detail';
import { openUploadDialog } from './parts/upload-dialog';
import { parseChangelogEntries, parseFaqPairs } from './parts/wporg-sections';
import app from './plugins.os';

const AJAX_URL = 'http://example.test/wp-admin/admin-ajax.php';

function extra( over: Partial< PluginsExtra > = {} ): PluginsExtra {
	const caps = { activate: true, install: true, delete: true, upload: true, update: true, ...( over.caps ?? {} ) };
	return {
		// What `App::menu()` ships in the config extra and the strip
		// renders from, caps already applied — see `plugins.os.php`.
		menuTabs: caps.install
			? [
				{ id: 'installed', label: 'Installed' },
				{ id: 'browse', label: 'Add Plugin' },
				{ id: 'featured', label: 'OpenStation plugins' },
			]
			: [ { id: 'installed', label: 'Installed' } ],
		ajaxUrl: AJAX_URL,
		ajaxNonce: 'plugins-window-nonce',
		updatesNonce: 'updates-nonce',
		caps: { activate: true, install: true, delete: true, upload: true, update: true },
		autoUpdatesEnabled: true,
		selfPluginFile: 'desktop-mode/desktop-mode',
		adminUrl: 'http://example.test/wp-admin/',
		deactivationFeedback: null,
		editorUrl: '',
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

const fetchMock = (): ReturnType< typeof vi.fn > => globalThis.fetch as unknown as ReturnType< typeof vi.fn >;
const restOver = ( cfg = extra() ) => createPluginsRest( () => cfg, ( url, init ) => globalThis.fetch( url, init ) );

/** A host for the parts that never touch the view. */
function fakeHost( over: Partial< PluginsHost > = {} ): PluginsHost & { toasts: string[]; dispatched: string[] } {
	const cfg = extra();
	const toasts: string[] = [];
	const dispatched: string[] = [];
	const installed = over.installed ?? [ row() ];
	return {
		extra: cfg,
		installed,
		rest: restOver( cfg ),
		root: document.body,
		busy: freshBusy(),
		caches: { info: new Map(), reviews: new Map() },
		dispatch: async ( action ) => {
			dispatched.push( action );
			return true;
		},
		refresh: async () => true,
		repaint: () => undefined,
		toast: ( message ) => {
			toasts.push( message );
		},
		confirm: async () => true,
		refreshMenu: () => undefined,
		installedFor: ( slug ) => installed.find( ( r ) => r.textdomain === slug ),
		broadcastChange: () => undefined,
		toasts,
		dispatched,
		...over,
	};
}

function mount(
	state: Partial< AppState > = {},
	data: Partial< AppData > = {},
	over: Partial< PluginsExtra > = {},
	host: Partial< RuntimeHost > = {},
	loading = false,
) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx = mockViewContext< AppState, AppData >( {
		state: { tab: 'installed', installedView: 'cards', status: '', search: '', browse: 'featured', query: '', ...state },
		data: { installed: [ row() ], error: '', ...data },
		loading,
		root,
		extra: extra( over ) as unknown as Record< string, unknown >,
		host: { fetch: ( input, init ) => globalThis.fetch( input, init ), ...host },
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
	it( 'renders installed plugin cards with production component imports', async () => {
		// A type-only import used to leave the preserved table inert,
		// exposing its empty slot even when installed rows existed.
		expect( customElements.get( 'os-table' ) ).toBeDefined();
		const { root } = mount();
		await Promise.resolve();
		const card = root.querySelector( '[data-plugin-card]' )!;
		expect( card.shadowRoot ).not.toBeNull();
		expect( renderedText( card ) ).toContain( 'Akismet' );
		expect( root.querySelector( '.os-plugins__library-empty' ) ).toBeNull();
	} );

	it( 'declares a placeholder: the frame paints before mount with a library loading state', () => {
		expect( app.placeholder!( {} ) ).toEqual( { installed: [], error: '' } );

		const { root } = mount( {}, { installed: [] }, {}, {}, true );
		expect( root.querySelector( '[data-os-plugins-tabs]' ) ).not.toBeNull();
		expect( root.querySelector( '.os-plugins__collections' ) ).not.toBeNull();
		expect( root.querySelector( '.os-plugins__library-scroll' )?.getAttribute( 'aria-busy' ) ).toBe( 'true' );

		const settled = mount();
		expect( settled.root.querySelector( '.os-plugins__library-scroll' )?.getAttribute( 'aria-busy' ) ).toBe( 'false' );
	} );

	it( 'paints the three tabs on the state tab, bound to it, with the framework list frame', () => {
		const { root } = mount( { tab: 'browse' } );
		expect( root.querySelector( '[data-os-plugins-root]' )?.classList.contains( 'os-app-list' ) ).toBe( true );
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
		expect( root.querySelector( 'os-tabpanel[for="installed"]' )?.hasAttribute( 'hidden' ) ).toBe( true );
		expect( root.querySelector( 'os-tabpanel[for="browse"]' )?.hasAttribute( 'hidden' ) ).toBe( false );
	} );

	it( 'hides the marketplace tabs without the install capability', () => {
		const { root } = mount( {}, {}, { caps: { activate: true, install: false, delete: false, upload: false, update: true } } );
		expect( root.querySelectorAll( 'os-tab' ).length ).toBe( 1 );
		expect( root.querySelector( '[data-os-plugins-browse-host]' ) ).toBeNull();
		expect( root.querySelector( '[data-os-plugins-featured-host]' ) ).toBeNull();
	} );

	it( 'counts pending updates on the Updates collection and keeps selection mode out of the way', () => {
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
		const status = root.querySelector( '[data-filter="update"]' );
		expect( status?.querySelector( 'strong' )?.textContent ).toBe( '1' );
		expect( root.querySelector( '.os-plugins__selection' )?.hasAttribute( 'hidden' ) ).toBe( true );
		expect( root.querySelector( '[os-action="reload"]' ) ).not.toBeNull();
		expect( root.querySelector( '[os-bind="search"]' )?.classList.contains( 'os-app-list__search' ) ).toBe( true );
	} );

	it( 'keeps the same library and anchored selection tray on a phone', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		const { root } = mount();
		expect( root.querySelector( '.os-plugins__selection' )?.parentElement?.className ).toBe( 'os-plugins__library' );
		expect( root.querySelector( '.os-plugins__collections' ) ).not.toBeNull();
		expect( root.querySelector( '[os-bind="browse"]' )?.tagName.toLowerCase() ).toBe( 'os-select' );
		expect( root.querySelector( 'os-table' ) ).toBeNull();
	} );

	it( 'offers Upload only to a viewer who may upload, and binds the browse toolbar', () => {
		const { root } = mount();
		expect( root.querySelector( '[data-os-plugins-browse-host] .dashicons-upload' ) ).not.toBeNull();
		expect( root.querySelector( '[os-bind="browse"]' )?.getAttribute( 'value' ) ).toBe( 'featured' );
		expect( root.querySelector( '[os-bind="query"]' ) ).not.toBeNull();
		const no = mount( {}, {}, { caps: { activate: true, install: true, delete: true, upload: false, update: true } } );
		expect( no.root.querySelector( '[data-os-plugins-browse-host] .dashicons-upload' ) ).toBeNull();
	} );

	it( 'offers the Plugin File Editor as a tab that opens Core’s editor in its own window', () => {
		const openUrl = vi.fn();
		const { root, ctx } = mount( {}, {}, { editorUrl: 'http://example.test/wp-admin/plugin-editor.php' }, { openUrl } );
		const tabs = root.querySelector< HTMLElement & { value: string } >( '[data-os-plugins-tabs]' )!;
		const editor = root.querySelector< HTMLElement >( '[data-os-plugins-editor]' )!;
		expect( editor.getAttribute( 'value' ) ).not.toBe( 'installed' );

		editor.dispatchEvent( new CustomEvent( 'os-tab-pick', { bubbles: true, composed: true, detail: { value: editor.getAttribute( 'value' ) } } ) );
		expect( openUrl ).toHaveBeenCalledWith( 'http://example.test/wp-admin/plugin-editor.php', 'Plugin File Editor', 'dashicons-admin-plugins' );

		// Arrow keys select the tab they land on; the editor tab hands it back.
		tabs.value = editor.getAttribute( 'value' )!;
		tabs.dispatchEvent( new CustomEvent( 'os-tab-change', { bubbles: true, detail: { value: tabs.value } } ) );
		expect( tabs.value ).toBe( 'installed' );
		expect( ctx.state.tab ).toBe( 'installed' );

		// No editor URL (a block theme, multisite, no `edit_plugins`): no tab.
		const none = mount();
		expect( none.root.querySelector( '[data-os-plugins-editor]' ) ).toBeNull();
	} );

	it( 'does not fetch a gallery until its tab is on screen', () => {
		mount( { tab: 'installed' } );
		expect( fetchMock() ).not.toHaveBeenCalled();
		mount( { tab: 'featured' } );
		const actions = fetchMock().mock.calls.map( ( [ , init ] ) => ( ( init as RequestInit ).body as URLSearchParams ).get( 'action' ) );
		expect( actions ).toEqual( [ 'openstation_plugins_featured' ] );
	} );

	it( 'refreshes on a foreign change but skips its own and the Heartbeat echo of its own', async () => {
		let listener: ( ( topic: string, payload?: unknown ) => void ) | null = null;
		const dispatch = vi.fn( async () => true );
		const { ctx } = mount( {}, {}, {}, {
			onBroadcast: ( _topic, cb ) => {
				listener = cb;
				return () => undefined;
			},
		} );
		ctx.dispatch = dispatch;
		app.mounted?.( ctx );
		expect( listener ).not.toBeNull();
		const fire = ( payload: unknown ): void => listener!( 'os.plugin.changed', payload );

		fire( { source: 'plugins-app', plugin: 'akismet/akismet', action: 'activate' } );
		expect( dispatch ).not.toHaveBeenCalled();

		fire( { source: 'plugins-window', plugin: 'akismet/akismet', action: 'activate' } );
		expect( dispatch ).toHaveBeenCalledTimes( 1 );

		// The relay of our own activation: broadcast records the id.
		( window as unknown as { wp: { os: { broadcast: unknown } } } ).wp.os.broadcast = vi.fn();
		const ui = ctx.ui< { host: PluginsHost } >( () => {
			throw new Error( 'ui bag missing' );
		} );
		ui.host.broadcastChange( { plugin: 'akismet/akismet', action: 'activate' } );
		fire( { source: 'heartbeat', action: 'activate', ids: [ pluginChangeId( 'akismet/akismet.php' ) ] } );
		expect( dispatch ).toHaveBeenCalledTimes( 1 );

		// Somebody else's plugin through Heartbeat still refreshes.
		fire( { source: 'heartbeat', action: 'activate', ids: [ pluginChangeId( 'jetpack/jetpack.php' ) ] } );
		expect( dispatch ).toHaveBeenCalledTimes( 2 );
	} );
} );

describe( 'the installed filter', () => {
	const rows = [
		row(),
		row( { plugin: 'jetpack/jetpack', name: 'Jetpack', status: 'active' } ),
		row( { plugin: 'akismet-network/akismet-network', name: 'Network Akismet', status: 'network-active' } ),
		row( {
			plugin: 'wordpress-seo/wp-seo',
			name: 'Yoast SEO',
			author: '<a href="https://yoast.com">Team Yoast</a>',
			openstation_update_available: { available: true, new_version: '2.0', package: 'x', slug: 'wordpress-seo' },
		} ),
	];

	it( 'segments by status, treating network-active as active, and matches name, path and author', () => {
		expect( filterRows( rows, '', '' ) ).toHaveLength( 4 );
		expect( filterRows( rows, 'active', '' ).map( ( r ) => r.plugin ) ).toEqual( [
			'jetpack/jetpack',
			'akismet-network/akismet-network',
		] );
		expect( filterRows( rows, 'inactive', '' ) ).toHaveLength( 2 );
		expect( filterRows( rows, 'update', '' ).map( ( r ) => r.name ) ).toEqual( [ 'Yoast SEO' ] );
		expect( filterRows( rows, '', 'YOAST' ) ).toHaveLength( 1 );
		expect( filterRows( rows, '', 'wp-seo' ) ).toHaveLength( 1 );
		expect( filterRows( rows, '', 'automattic' ) ).toHaveLength( 3 );
		expect( filterRows( rows, '', 'team yoast' ) ).toHaveLength( 1 );
		expect( countUpdates( rows ) ).toBe( 1 );
		expect( isActiveStatus( 'network-active' ) ).toBe( true );
	} );

	it( 'precomputes the lowercase haystacks once per list identity', () => {
		const ui = freshInstalledUi();
		const first = haystacksFor( rows, ui.haystacks );
		expect( first.get( 'wordpress-seo/wp-seo' ) ).toBe( 'yoast seo wordpress-seo/wp-seo team yoast' );
		expect( haystacksFor( rows, ui.haystacks ) ).toBe( first );
		expect( haystacksFor( [ ...rows ], ui.haystacks ) ).not.toBe( first );
		expect( filterRows( rows, '', 'team yoast', first ) ).toHaveLength( 1 );
	} );
} );

describe( 'the admin-ajax client', () => {
	it( 'browse POSTs to admin-ajax with the window nonce and returns the inner data', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => ajaxOk( { plugins: [ { slug: 'akismet', name: 'Akismet' } ], info: { results: 1 } } ) ),
		);
		const out = await restOver().browsePlugins( { browse: 'featured', perPage: 10 } );
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
		const live = restOver( cfg );
		vi.stubGlobal( 'fetch', vi.fn( async () => ajaxOk( {} ) ) );
		cfg.ajaxNonce = 'rolled';
		await live.fetchPluginInfo( 'akismet' );
		const init = fetchMock().mock.calls[ 0 ][ 1 ] as RequestInit;
		expect( ( init.body as URLSearchParams ).get( '_ajax_nonce' ) ).toBe( 'rolled' );
	} );

	it( 'unwraps a `success: false` envelope into a thrown error', async () => {
		vi.stubGlobal( 'fetch', vi.fn( async () => jsonResponse( { success: false, data: { message: 'wp.org is sleeping' } } ) ) );
		await expect( restOver().browsePlugins( {} ) ).rejects.toThrow( /wp\.org is sleeping/ );
	} );

	it( 'reports a non-JSON body with its status, and maps Core’s `errorCode` onto `code`', async () => {
		await expect( readJsonOrThrow( new Response( '<html>Fatal', { status: 500 } ) ) ).rejects.toThrow( /500 with non-JSON body/ );
		await expect(
			readJsonOrThrow( jsonResponse( { success: false, data: { errorCode: 'up_to_date', errorMessage: 'Latest.' } }, 400 ) ),
		).rejects.toMatchObject( { code: 'up_to_date', message: 'Latest.', status: 400 } );
		await expect( readJsonOrThrow( jsonResponse( { nothing: true }, 502 ) ) ).rejects.toThrow( 'Request failed (502).' );
		// Core's `install-plugin` ships without the envelope.
		expect( unwrapAjaxEnvelope< { slug: string } >( { slug: 'akismet' }, 200 ) ).toEqual( { slug: 'akismet' } );
		expect( () => unwrapAjaxEnvelope( { success: false, data: { code: 'nope', message: 'No.' } }, 200 ) ).toThrow( 'No.' );
	} );

	it( 'install and update use Core’s `updates` nonce and the full plugin file', async () => {
		vi.stubGlobal( 'fetch', vi.fn( async () => ajaxOk( { plugin: 'akismet/akismet.php', slug: 'akismet' } ) ) );
		const rest = restOver();
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
		const rest = restOver();
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
		await expect( restOver().uploadPluginZip( file ) ).rejects.toMatchObject( { code: 'folder_exists', status: 409 } );
	} );

	it( 'recognises OpenStation itself with or without the extension', () => {
		const rest = restOver();
		expect( rest.isOpenStationSelf( 'desktop-mode/desktop-mode' ) ).toBe( true );
		expect( rest.isOpenStationSelf( 'desktop-mode/desktop-mode.php' ) ).toBe( true );
		expect( rest.isOpenStationSelf( 'akismet/akismet' ) ).toBe( false );
		expect( fullPluginFile( 'akismet/akismet' ) ).toBe( 'akismet/akismet.php' );
		expect( fullPluginFile( 'akismet/akismet.php' ) ).toBe( 'akismet/akismet.php' );
	} );
} );

describe( 'the wp.org HTML sanitiser', () => {
	it( 'drops scripts, handlers and unsafe URLs but keeps the text and the safe markup', () => {
		const out = sanitizeHtml(
			'<p onclick="x()">Hi <b>there</b><script>alert(1)</script></p>' +
				'<a href="javascript:alert(1)">bad</a>' +
				'<a href="java\tscript:alert(1)">tab</a>' +
				'<a href="https://example.test" target="_top" style="color:red">good</a>' +
				'<img src="data:image/png;base64,AAAA" onerror="x()"><iframe src="https://evil"></iframe><em>fin</em>',
		);
		expect( out ).not.toMatch( /script|onclick|onerror|iframe|style=/ );
		expect( out ).toContain( 'Hi <b>there</b>' );
		expect( out ).toContain( 'alert(1)' ); // the script's TEXT survives, inert
		expect( out ).toContain( '<a>bad</a>' );
		expect( out ).toContain( '<a>tab</a>' );
		expect( out ).toContain( '<a href="https://example.test" target="_top">good</a>' );
		expect( out ).toContain( '<img>' );
		expect( out ).toContain( '<em>fin</em>' );
	} );

	it( 'reads the scheme the way a browser does', () => {
		expect( isSafeUrl( '/relative' ) ).toBe( true );
		expect( isSafeUrl( '#hash' ) ).toBe( true );
		expect( isSafeUrl( 'https://x' ) ).toBe( true );
		expect( isSafeUrl( 'MAILTO:a@b' ) ).toBe( true );
		expect( isSafeUrl( 'javascript:x' ) ).toBe( false );
		expect( isSafeUrl( ' java\nscript:x' ) ).toBe( false );
		expect( isSafeUrl( 'data:text/html,x' ) ).toBe( false );
		expect( isSafeUrl( 'vbscript:x' ) ).toBe( false );
	} );

	it( 'strips tags without loading anything', () => {
		expect( stripHtml( '<a href="https://x"><b>Team</b> Yoast</a>' ) ).toBe( 'Team Yoast' );
		expect( stripHtml( '' ) ).toBe( '' );
		expect( stripHtml( '<img src="https://x/y.png" onerror="x()">plain' ) ).toBe( 'plain' );
	} );
} );

describe( 'the changelog and FAQ parsers', () => {
	it( 'splits a changelog on version headings, `=` fences included, and tolerates missing bodies', () => {
		const entries = parseChangelogEntries( '<h4>= 2.0.0 =</h4><ul><li>New</li></ul>loose text<h4>1.9</h4><p>Fixes</p><h4>1.8</h4>' );
		expect( entries.map( ( e ) => e.version ) ).toEqual( [ '2.0.0', '1.9', '1.8' ] );
		expect( entries[ 0 ].body ).toContain( '<li>New</li>' );
		expect( entries[ 0 ].body ).toContain( '<p>loose text</p>' );
		expect( entries[ 2 ].body ).toBe( '' );
	} );

	it( 'answers with nothing when no heading carries a version, so the caller shows the plain HTML', () => {
		expect( parseChangelogEntries( '<p>Just a paragraph</p>' ) ).toEqual( [] );
		expect( parseChangelogEntries( '<h4>Notes</h4><p>No versions here</p>' ) ).toEqual( [] );
		expect( parseChangelogEntries( '' ) ).toEqual( [] );
		expect( parseChangelogEntries( '<script>x</script>' ) ).toEqual( [] );
	} );

	it( 'pairs FAQ questions with their answers under every shape wp.org ships', () => {
		const headings = parseFaqPairs( '<h4>Q1?</h4><p>A1</p><h3>Q2?</h3><p>A2a</p><p>A2b</p><h4>Empty?</h4>' );
		expect( headings.map( ( p ) => p.question ) ).toEqual( [ 'Q1?', 'Q2?', 'Empty?' ] );
		expect( headings[ 1 ].answer ).toContain( 'A2b' );
		expect( headings[ 2 ].answer ).toBe( '' );

		// The malformed `<dt>Q</h4><p>A` nesting the directory emits.
		const malformed = parseFaqPairs( '<dt>Q3</h4><p></p><p>A3</p><dt>  Q4 <em>x</em></h4><p>A4</p>' );
		expect( malformed.map( ( p ) => p.question ) ).toEqual( [ 'Q3', 'Q4' ] );
		expect( malformed[ 0 ].answer ).toBe( '<p>A3</p>' );
		expect( malformed[ 1 ].answer ).toContain( '<em>x</em>' );

		const list = parseFaqPairs( '<dl><dt>Q5</dt><dd>A5</dd><dt></dt><dd>orphan</dd></dl>' );
		expect( list ).toEqual( [ { question: 'Q5', answer: 'A5' } ] );

		expect( parseFaqPairs( '<p>No headings at all</p>' ) ).toEqual( [] );
		expect( parseFaqPairs( '' ) ).toEqual( [] );
	} );
} );

describe( 'the mutations that take OpenStation down', () => {
	it( 'knows when the row it just changed is itself, gone or off', () => {
		const self = row( { plugin: 'desktop-mode/desktop-mode', name: 'OpenStation', status: 'active' } );
		expect( selfGone( fakeHost( { installed: [ self ] } ), 'desktop-mode/desktop-mode' ) ).toBe( false );
		expect( selfGone( fakeHost( { installed: [ { ...self, status: 'inactive' } ] } ), 'desktop-mode/desktop-mode' ) ).toBe( true );
		expect( selfGone( fakeHost( { installed: [] } ), 'desktop-mode/desktop-mode' ) ).toBe( true );
		expect( selfGone( fakeHost( { installed: [] } ), 'akismet/akismet' ) ).toBe( false );
	} );

	it( 'toasts, then leaves for the classic admin after a beat', () => {
		vi.useFakeTimers();
		try {
			const host = fakeHost();
			leaveAfterSelfMutation( host, true );
			expect( host.toasts[ 0 ] ).toMatch( /deleted/ );
			leaveAfterSelfMutation( host, false );
			expect( host.toasts[ 1 ] ).toMatch( /deactivated/ );
			expect( vi.getTimerCount() ).toBe( 2 );
			vi.clearAllTimers();
		} finally {
			vi.useRealTimers();
		}
	} );
} );

describe( 'the actions', () => {
	it( 'detects Core’s "already up to date" by code or by its translated message', () => {
		( window as unknown as { wp: { i18n: unknown } } ).wp.i18n = { __: ( s: string ) => s };
		expect( isUpToDateError( { code: 'up_to_date' } ) ).toBe( true );
		expect( isUpToDateError( new Error( 'The plugin is at the latest version.' ) ) ).toBe( true );
		expect( isUpToDateError( new Error( 'Download failed.' ) ) ).toBe( false );
		expect( isUpToDateError( null ) ).toBe( false );
	} );

	it( 'offers bulk verbs by capability and by what the selection allows', () => {
		const rows = [
			row(),
			row( { plugin: 'jetpack/jetpack', status: 'active' } ),
			row( {
				plugin: 'wordpress-seo/wp-seo',
				openstation_update_available: { available: true, new_version: '2', package: 'x', slug: 'wordpress-seo' },
			} ),
			row( {
				plugin: 'premium/premium',
				openstation_update_available: { available: true, new_version: '2', package: '', slug: '' },
			} ),
		];
		const all = rows.map( ( r ) => r.plugin );
		const labels = ( host: PluginsHost, ids: string[] ): string[] => bulkButtons( host, ids, () => undefined ).map( ( b ) => b.label );

		expect( labels( fakeHost( { installed: rows } ), all ) ).toEqual( [ 'Update 1', 'Activate', 'Deactivate', 'Delete' ] );
		expect( labels( fakeHost( { installed: rows } ), [ 'jetpack/jetpack' ] ) ).toEqual( [ 'Deactivate' ] );
		expect( labels( fakeHost( { installed: rows } ), [] ) ).toEqual( [] );

		const cfg = extra( { caps: { activate: true, install: false, delete: false, upload: false, update: false } } );
		expect( labels( fakeHost( { installed: rows, extra: cfg } ), all ) ).toEqual( [ 'Activate', 'Deactivate' ] );
	} );
} );

describe( 'the upload dialog', () => {
	it( 'asks to replace on a 409 and retries with overwrite', async () => {
		const file = new File( [ 'PK' ], 'akismet.zip', { type: 'application/zip' } );
		let calls = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => {
				calls++;
				return calls === 1
					? jsonResponse( { success: false, data: { code: 'folder_exists', message: 'Exists.' } }, 409 )
					: ajaxOk( { plugin_file: 'akismet/akismet.php', plugin_name: 'Akismet', plugin_version: '5', status: 'inactive', messages: [] } );
			} ),
		);
		const confirm = vi.fn( async () => true );
		const broadcast = vi.fn();
		const host = fakeHost( { confirm, broadcastChange: broadcast } );
		const pending = openUploadDialog( host, file );
		const submit = document.querySelector< HTMLElement >( '.os-plugins__upload-actions os-button[variant="primary"]' );
		expect( submit?.hasAttribute( 'disabled' ) ).toBe( false );
		submit?.click();
		await vi.waitFor( () => expect( calls ).toBe( 2 ) );
		expect( confirm ).toHaveBeenCalledTimes( 1 );
		expect( ( ( fetchMock().mock.calls[ 1 ][ 1 ] as RequestInit ).body as FormData ).get( 'overwrite' ) ).toBe( '1' );
		await vi.waitFor( () => expect( document.querySelector( '.os-plugins__upload-success-heading' ) ).not.toBeNull() );
		expect( broadcast ).toHaveBeenCalledWith( { plugin: 'akismet/akismet.php', action: 'install' } );
		document.querySelector< HTMLElement >( '.os-plugins__upload-actions os-button[variant="ghost"]' )?.click();
		await expect( pending ).resolves.toMatchObject( { plugin_file: 'akismet/akismet.php' } );
	} );

	it( 'closes on Escape heard on its own overlay, and cancels on a refusal to replace', async () => {
		const file = new File( [ 'PK' ], 'akismet.zip', { type: 'application/zip' } );
		vi.stubGlobal( 'fetch', vi.fn( async () => jsonResponse( { success: false, data: { code: 'folder_exists', message: 'Exists.' } }, 409 ) ) );
		const host = fakeHost( { confirm: async () => false } );
		const pending = openUploadDialog( host, file );
		document.querySelector< HTMLElement >( '.os-plugins__upload-actions os-button[variant="primary"]' )?.click();
		await vi.waitFor( () => expect( document.querySelector( '.os-plugins__upload-status' )?.textContent ).toMatch( /already installed/ ) );
		const overlay = document.querySelector< HTMLElement >( '.os-plugins__upload-overlay' )!;
		overlay.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		await expect( pending ).resolves.toBeNull();
		expect( document.querySelector( '.os-plugins__upload-overlay' ) ).toBeNull();
	} );
} );

describe( 'the Browse gallery', () => {
	const page = ( n: number, slugs: string[], pages = 3 ) =>
		ajaxOk( { plugins: slugs.map( ( slug ) => ( { slug, name: slug, author: 'a', short_description: '', rating: 80, num_ratings: 1, active_installs: 10 } ) ), info: { page: n, pages } } );

	it( 'pages on the sentinel, dedupes across pages and stops at wp.org’s page count', async () => {
		const bodies = [ page( 1, [ 'a', 'b' ] ), page( 2, [ 'b', 'c' ] ), page( 3, [ 'd' ] ) ];
		vi.stubGlobal( 'fetch', vi.fn( async () => bodies.shift() ?? page( 4, [ 'e' ] ) ) );
		const galleryEl = document.createElement( 'div' );
		const statusEl = document.createElement( 'p' );
		document.body.append( galleryEl, statusEl );
		let observerCb: ( ( entries: Array< { isIntersecting: boolean } > ) => void ) | null = null;
		( globalThis as { IntersectionObserver: unknown } ).IntersectionObserver = class {
			constructor( cb: ( entries: Array< { isIntersecting: boolean } > ) => void ) {
				observerCb = cb;
			}
			observe() {}
			disconnect() {}
			unobserve() {}
		};
		const gallery = createBrowseGallery( { host: fakeHost( { installed: [] } ), flyout: () => null } );
		const opts = { gallery: galleryEl, status: statusEl, filter: 'featured' as const, query: '', active: false };
		gallery.sync( opts );
		expect( fetchMock() ).not.toHaveBeenCalled();
		gallery.sync( { ...opts, active: true } );
		await vi.waitFor( () => expect( galleryEl.querySelectorAll( '[data-slug]' ).length ).toBe( 2 ) );
		observerCb!( [ { isIntersecting: true } ] );
		await vi.waitFor( () => expect( galleryEl.querySelectorAll( '[data-slug]' ).length ).toBe( 3 ) );
		observerCb!( [ { isIntersecting: true } ] );
		await vi.waitFor( () => expect( galleryEl.querySelectorAll( '[data-slug]' ).length ).toBe( 4 ) );
		observerCb!( [ { isIntersecting: true } ] );
		await Promise.resolve();
		expect( fetchMock() ).toHaveBeenCalledTimes( 3 );
		expect( Array.from( galleryEl.querySelectorAll( '[data-slug]' ) ).map( ( c ) => ( c as HTMLElement ).dataset.slug ) ).toEqual( [ 'a', 'b', 'c', 'd' ] );
		// The sentinel stays last so the observer keeps seeing it.
		expect( galleryEl.lastElementChild?.classList.contains( 'os-plugins__gallery-sentinel' ) ).toBe( true );
	} );
} );

describe( 'the card drag', () => {
	it( 'registers the dock drop target and tears it down with the window', () => {
		const off = vi.fn();
		const registerDropTarget = vi.fn( () => off );
		( window as unknown as { wp: { os: unknown } } ).wp.os = { dragManager: { registerDropTarget }, registerSystemTile: vi.fn(), showToast: vi.fn() };
		const dock = document.createElement( 'div' );
		dock.className = 'os-dock';
		document.body.appendChild( dock );
		const teardown = installPluginDropTargets();
		expect( registerDropTarget ).toHaveBeenCalledTimes( 1 );
		expect( ( registerDropTarget.mock.calls[ 0 ] as unknown[] )[ 0 ] ).toMatchObject( { id: 'desktop-mode-plugins/dock', element: dock } );
		teardown();
		expect( off ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'is a no-op without a dock or a drag manager', () => {
		expect( () => installPluginDropTargets()() ).not.toThrow();
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
		expect( deriveSlug( row() ) ).toBe( '' );
	} );
} );

describe( 'the installed plugin library', () => {
	const libraryRows = (): InstalledPlugin[] => [
		row( { plugin: 'sleep/sleep', name: 'Sleeping plugin', openstation_size_kb: 400 } ),
		row( { plugin: 'network/network', name: 'Network plugin', status: 'network-active', openstation_can_manage: { activate: false, deactivate: false, delete: false } } ),
		row( { plugin: 'update/update', name: 'Update plugin', status: 'active', openstation_size_kb: 100,
			openstation_update_available: { available: true, new_version: '2.0', package: 'download.zip', slug: 'update' } } ),
	];
	const click = ( root: HTMLElement, selector: string ): void => {
		const el = root.querySelector< HTMLElement >( selector );
		expect( el, selector ).not.toBeNull();
		el!.click();
	};

	it( 'puts updates first, with every plugin in exactly one shelf and its actions beside it', () => {
		const { root } = mount( {}, { installed: libraryRows() } );
		expect( root.querySelector( 'os-table, table' ) ).toBeNull();
		expect( root.querySelector( '.os-plugins__workspace > style' )?.textContent ).toContain( '.os-plugins__library' );
		expect( Array.from( root.querySelectorAll< HTMLElement >( '[data-plugin-card]' ) ).map( ( el ) => el.dataset.pluginCard ) )
			.toEqual( [ 'update/update', 'network/network', 'sleep/sleep' ] );
		const update = root.querySelector( '[data-plugin-card="update/update"]' );
		expect( update?.textContent ).toContain( '2.0' );
		expect( update?.querySelector( '.os-plugins__module-actions os-button' )?.textContent ).toBe( 'Update' );
		expect( update?.querySelector( '.os-plugins__module-actions' )?.textContent ).toContain( 'Deactivate' );
		expect( root.querySelector( '[data-plugin-card="network/network"]' )?.textContent ).toContain( 'Network active' );
		expect( root.querySelector( '[data-plugin-card="network/network"] .os-plugins__module-actions os-button' ) ).toBeNull();
	} );

	it( 'filters locally, preserves actions, and drops selections that become hidden', () => {
		const { root, ctx } = mount( {}, { installed: libraryRows() } );
		const updateButton = root.querySelector( '[data-plugin-card="update/update"] .os-plugins__module-actions os-button' );
		root.querySelector( '.os-plugins__pick' )!.dispatchEvent( new CustomEvent( 'os-checkbox-change', { detail: { checked: true } } ) );
		root.querySelector( '.os-plugins__selection os-checkbox' )!.dispatchEvent( new CustomEvent( 'os-checkbox-change', { detail: { checked: true } } ) );
		expect( root.querySelector( '.os-plugins__selection-count' )?.textContent ).toBe( '3 selected' );
		expect( root.querySelector( '[data-plugin-card="update/update"] .os-plugins__module-actions os-button' ) ).toBe( updateButton );
		click( root, '[data-filter="inactive"]' );
		expect( ctx.state.status ).toBe( 'inactive' );
		expect( root.querySelector( '[data-plugin-card="sleep/sleep"] .os-plugins__module-actions' )?.textContent ).toContain( 'Activate' );
		expect( root.querySelector( '[data-plugin-card="sleep/sleep"] .os-plugins__module-icon' ) ).not.toBeNull();
		expect( root.querySelectorAll( '[data-plugin-card]' ) ).toHaveLength( 1 );
		expect( root.querySelector( '.os-plugins__selection-count' )?.textContent ).toBe( '1 selected' );
		expect( fetchMock() ).not.toHaveBeenCalled();
	} );

	it( 'always shows compact checkboxes and opens bulk tools only with a selection', async () => {
		const { root } = mount( {}, { installed: libraryRows() } );
		const box = root.querySelector( '.os-plugins__pick' )!;
		expect( box.hasAttribute( 'hidden' ) ).toBe( false );
		expect( box.hasAttribute( 'label' ) ).toBe( false );
		expect( root.querySelectorAll( '.os-plugins__library-tools [data-plugin-view]' ) ).toHaveLength( 2 );
		expect( root.querySelector( '.os-plugins__selection' )?.hasAttribute( 'hidden' ) ).toBe( true );
		await Promise.resolve();
		expect( box.shadowRoot?.querySelector( 'input' )?.getAttribute( 'aria-label' ) ).toMatch( /^Select / );
		box.dispatchEvent( new CustomEvent( 'os-checkbox-change', { detail: { checked: true } } ) );
		expect( root.querySelector( '.os-plugins__selection' )?.hasAttribute( 'hidden' ) ).toBe( false );
		box.dispatchEvent( new CustomEvent( 'os-checkbox-change', { detail: { checked: false } } ) );
		expect( root.querySelector( '.os-plugins__selection' )?.hasAttribute( 'hidden' ) ).toBe( true );
	} );

	it( 'selects only downloadable updates and waits for an explicit bulk action', () => {
		const rows = libraryRows();
		rows.push( row( { plugin: 'premium/premium', openstation_update_available: { available: true, new_version: '3', package: '', slug: 'premium' } } ) );
		const { root } = mount( {}, { installed: rows } );
		click( root, '[data-shelf="update"] .os-plugins__shelf-heading os-button' );
		expect( root.querySelector( '.os-plugins__selection-count' )?.textContent ).toBe( '1 selected' );
		expect( root.querySelector( '.os-plugins__selection-actions' )?.textContent ).toContain( 'Update 1' );
		expect( fetchMock() ).not.toHaveBeenCalled();
	} );

	it( 'adds update candidates without clearing previously selected inactive plugins', () => {
		const { root } = mount( {}, { installed: libraryRows() } );
		root.querySelector( '[data-plugin-card="sleep/sleep"] os-checkbox' )!.dispatchEvent( new CustomEvent( 'os-checkbox-change', { detail: { checked: true } } ) );
		click( root, '[data-shelf="update"] .os-plugins__shelf-heading os-button' );
		expect( root.querySelector( '.os-plugins__selection-count' )?.textContent ).toBe( '2 selected' );
		expect( root.querySelector( '[data-plugin-card="sleep/sleep"] os-checkbox' )?.hasAttribute( 'checked' ) ).toBe( true );
	} );

	it( 'sorts by disk size without a request or mutating the server list', () => {
		const rows = libraryRows();
		const { root } = mount( {}, { installed: rows } );
		root.querySelector( '.os-plugins__library-tools os-select' )!.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'size' } } ) );
		expect( Array.from( root.querySelectorAll< HTMLElement >( '[data-plugin-card]' ) ).map( ( el ) => el.dataset.pluginCard ) )
			.toEqual( [ 'sleep/sleep', 'update/update', 'network/network' ] );
		expect( rows.map( ( r ) => r.plugin ) ).toEqual( [ 'sleep/sleep', 'network/network', 'update/update' ] );
		expect( root.querySelector( '[data-plugin-card="sleep/sleep"] .os-plugins__module-actions' )?.textContent ).toContain( 'Activate' );
		expect( root.querySelector( '[data-plugin-card="update/update"] .os-plugins__module-actions os-button' )?.textContent ).toBe( 'Update' );
		expect( fetchMock() ).not.toHaveBeenCalled();
	} );

	it( 'keeps inspector actions independent, preserves details on repaint, and returns keyboard focus', async () => {
		const { root, ctx } = mount();
		const original = root.querySelector( '[data-plugin-card] .os-plugins__module-actions os-button' );
		click( root, '[data-plugin-details]' );
		await Promise.resolve();
		const inspector = root.querySelector( '.os-plugins__inspector' );
		expect( inspector ).not.toBeNull();
		expect( inspector?.querySelector( '.os-plugins__module-actions os-button' ) ).not.toBe( original );
		expect( original?.isConnected ).toBe( true );
		expect( root.ownerDocument.activeElement ).toBe( root.querySelector( '[data-plugin-back]' ) );
		const details = root.querySelector( '.os-plugins__inspector-content' );
		ctx.repaint();
		expect( root.querySelector( '.os-plugins__inspector-content' ) ).toBe( details );
		inspector!.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		await Promise.resolve();
		expect( root.querySelector( '.os-plugins__inspector' ) ).toBeNull();
		expect( root.ownerDocument.activeElement ).toBe( root.querySelector( '[data-plugin-details]' ) );
	} );

	it( 'names search and detail controls inside their shadow roots', async () => {
		const { root } = mount();
		await Promise.resolve();
		expect( root.querySelector( '[data-filter="all"]' )?.shadowRoot?.querySelector( 'button' )?.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( root.querySelector( '[data-plugin-details]' )?.shadowRoot?.querySelector( 'button' )?.getAttribute( 'aria-label' ) ).toBe( 'Details for Akismet' );
	} );

	it( 'shows auto-update policy in the inspector and honors capability gates', () => {
		const { root } = mount( {}, { installed: [ row( { openstation_auto_update: { supported: true, enabled: true, forced: true } } ) ] },
			{ caps: { install: false, activate: false, delete: false, update: false, upload: false } } );
		expect( root.querySelector( '.os-plugins__module-actions os-button' ) ).toBeNull();
		click( root, '[data-plugin-details]' );
		expect( root.querySelector( '.os-plugins__inspector-updates' )?.textContent ).toContain( 'Auto-updates enabled' );
		expect( root.querySelector( '.os-plugins__inspector-updates os-button' ) ).toBeNull();
	} );

	it( 'resets an empty search and distinguishes a load error from an empty result', () => {
		const { root, ctx } = mount( { search: 'not-a-plugin' } );
		const field = root.querySelector( '.os-plugins__library-tools os-text-field' );
		expect( root.querySelectorAll( '[data-plugin-card]' ) ).toHaveLength( 0 );
		expect( field?.getAttribute( 'value' ) ).toBe( 'not-a-plugin' );
		click( root, '.os-plugins__library-empty os-button' );
		expect( ctx.state.search ).toBe( '' );
		expect( root.querySelectorAll( '[data-plugin-card]' ) ).toHaveLength( 1 );
		// The field follows the state it is bound to, or the next keystroke re-filters on stale text.
		expect( field?.getAttribute( 'value' ) ?? '' ).toBe( '' );
		const failed = mount( {}, { installed: [], error: 'Connection lost' } );
		expect( failed.root.querySelector( 'os-notice' )?.textContent ).toContain( 'Connection lost' );
		expect( failed.root.querySelector( '.os-plugins__library-empty' ) ).toBeNull();
	} );
} );

describe( 'the installed table and view preference', () => {
	const pickView = ( root: HTMLElement, view: string ): void => root.querySelector< HTMLElement >( `[data-plugin-view="${ view }"]` )!.click();
	const tableOf = ( root: HTMLElement ) => root.querySelector< OsTable< InstalledPlugin > >( '[data-os-plugins-table]' )!;

	it( 'paints the saved table with real rows, decoded titles, and bounded text', async () => {
		const name = 'Save &amp; Go ' + 'VeryLongPluginName'.repeat( 40 );
		const { root } = mount( { installedView: 'table' }, { installed: [ row( { name, author: 'Author'.repeat( 80 ), version: '1.2.3'.repeat( 80 ) } ) ] } );
		await Promise.resolve();
		const table = tableOf( root );
		expect( table.shadowRoot?.querySelector( 'tbody' )?.textContent ).toContain( 'Save & Go' );
		expect( table.shadowRoot?.querySelector( 'tbody' )?.textContent ).not.toContain( '&amp;' );
		expect( table.shadowRoot?.querySelector( '[data-plugin-title]' )?.getAttribute( 'title' ) ).toBe( stripHtml( name ) );
		expect( root.querySelector( '[data-plugin-card]' ) ).toBeNull();
		expect( table.shadowRoot?.querySelector( '.os-plugins__table-copy os-button' ) ).toBeNull();
		expect( table.getAttribute( 'sticky-columns' ) ).toBe( '2' );
		expect( table.shadowRoot?.querySelector( '[data-os-plugins-styles="installed-table"]' )?.textContent ).toContain( 'table-layout: fixed' );
	} );

	it( 'switches immediately, serializes saves, and keeps selection through a round trip between views', async () => {
		const { root, ctx } = mount();
		let finish!: ( value: boolean ) => void;
		ctx.dispatch = vi.fn( () => new Promise<boolean>( ( resolve ) => {
			finish = resolve;
		} ) );
		root.querySelector( '.os-plugins__pick' )!.dispatchEvent( new CustomEvent( 'os-checkbox-change', { detail: { checked: true } } ) );
		pickView( root, 'table' );
		expect( ctx.state.installedView ).toBe( 'table' );
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'save_view', { view: 'table' } );
		expect( root.querySelector( '[data-plugin-view="cards"]' )?.hasAttribute( 'disabled' ) ).toBe( true );
		expect( Array.from( tableOf( root ).selection ) ).toEqual( [ 'akismet/akismet' ] );
		pickView( root, 'cards' );
		expect( ctx.dispatch ).toHaveBeenCalledTimes( 1 );
		finish( true );
		await vi.waitFor( () => expect( root.querySelector( '[data-plugin-view="cards"]' )?.hasAttribute( 'disabled' ) ).toBe( false ) );
		ctx.dispatch = vi.fn( async () => true );
		pickView( root, 'cards' );
		expect( root.querySelector( '.os-plugins__pick' )?.hasAttribute( 'checked' ) ).toBe( true );
	} );

	it( 'rolls the view back when saving fails and does not save the placeholder', async () => {
		const { root, ctx } = mount();
		ctx.dispatch = vi.fn( async () => false );
		pickView( root, 'table' );
		await vi.waitFor( () => expect( ctx.state.installedView ).toBe( 'cards' ) );
		expect( root.querySelector( '[data-plugin-card]' ) ).not.toBeNull();
		const pending = mount( {}, { installed: [] }, {}, {}, true );
		pending.ctx.dispatch = vi.fn( async () => true );
		pickView( pending.root, 'table' );
		expect( pending.ctx.dispatch ).not.toHaveBeenCalled();
	} );

	it( 'preserves row nodes on selection and opens the inspector with correct focus restoration', async () => {
		const { root, ctx } = mount( { installedView: 'table' } );
		await Promise.resolve();
		const table = tableOf( root );
		const name = table.shadowRoot!.querySelector< HTMLElement >( '[data-plugin-title]' )!;
		table.select( 'akismet/akismet' );
		await Promise.resolve();
		expect( table.shadowRoot!.querySelector( '[data-plugin-title]' ) ).toBe( name );
		expect( root.querySelector( '.os-plugins__selection-count' )?.textContent ).toBe( '1 selected' );
		table.shadowRoot!.querySelector< HTMLElement >( '.os-plugins__table-actions' )!.click();
		expect( root.querySelector( '.os-plugins__inspector' ) ).toBeNull();
		name.click();
		await Promise.resolve();
		expect( root.querySelector( '.os-plugins__inspector' ) ).not.toBeNull();
		root.querySelector< HTMLElement >( '[data-plugin-back]' )!.click();
		await Promise.resolve();
		expect( table.shadowRoot?.activeElement ).toBe( table.shadowRoot?.querySelector( '[data-plugin-actions]' ) );
		ctx.state.search = 'not-found';
		ctx.repaint();
		expect( tableOf( root ).hidden ).toBe( true );
		expect( tableOf( root ).selection.size ).toBe( 0 );
	} );

	it( 'uses decoded, inert titles in both detail surfaces', () => {
		const encoded = 'Save &amp; Go &lt;img src=x onerror=alert(1)&gt;';
		const { root } = mount( {}, { installed: [ row( { name: encoded } ) ] } );
		root.querySelector< HTMLElement >( '[data-plugin-details]' )!.click();
		const title = root.querySelector( '.os-plugins__inspector-content' )?.shadowRoot?.querySelector( '.os-plugins__detail-title' );
		expect( title?.textContent ).toBe( 'Save & Go <img src=x onerror=alert(1)>' );
		expect( title?.querySelector( 'img' ) ).toBeNull();
		const flyout = document.createElement( 'div' );
		document.body.appendChild( flyout );
		const host = fakeHost();
		openDetailFlyout( flyout, 'test', { slug: 'test', name: encoded, version: '1', last_updated: '', tested: '', author: '', short_description: '', rating: 0, num_ratings: 0, active_installs: 0 }, host );
		expect( flyout.querySelector( '.os-plugins__flyout-hero-title' )?.textContent ).toBe( 'Save & Go <img src=x onerror=alert(1)>' );
		expect( flyout.querySelector( '.os-plugins__flyout-hero-title img' ) ).toBeNull();
	} );
} );
