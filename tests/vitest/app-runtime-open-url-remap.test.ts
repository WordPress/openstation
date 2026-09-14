/**
 * The app runtime's `open_url` host effect consults the native-URL remap
 * registry before it opens an iframe window.
 *
 * Every other opener in the shell already did (the dock, the portal, the
 * top-window link interceptor, files-on-the-desktop, related entities),
 * so a plugin whose native window claims `admin.php?page=my-entries` got
 * the native window from the dock tile and an iframe of the classic page
 * from its own app's "Open in my Dashboard" door. Same URL, two answers.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildHost } from '../../src/app-runtime/index';
import {
	_resetNativeUrlRemap,
	bindNativeUrlRemap,
	registerNativeUrlRemap,
} from '../../src/native-url-remap';
import type { OsSettingsSnapshot } from '../../src/settings/registry';

const ADMIN_URL = 'http://example.test/wp-admin/';
const CLAIMED = ADMIN_URL + 'admin.php?page=my-entries&tab=trust';
const UNCLAIMED = ADMIN_URL + 'update-core.php';

function snapshot(): OsSettingsSnapshot {
	return {
		wallpaper: 'dark',
		accent: 'wp-blue',
		dockSize: 'default',
		desktopLayout: 'classic',
		dockRailRenderer: 'default',
		ai: { enabled: false, provider: 'openai', apiKey: '', transport: 'off' },
		nativePostsEnabled: false,
	};
}

const windowOpen = vi.fn( async () => undefined );
const openById = vi.fn( () => true );

beforeEach( () => {
	windowOpen.mockClear();
	openById.mockClear();
	( window as unknown as { wp: unknown } ).wp = {
		os: {
			deriveWindowId: ( url: string ) => 'derived:' + url,
			windowManager: { open: windowOpen, getById: () => undefined },
		},
	};
	bindNativeUrlRemap( { getSnapshot: snapshot, openById, adminUrl: ADMIN_URL } );
	registerNativeUrlRemap( {
		id: 'my-plugin/entries',
		nativeWindowId: 'my-plugin-entries',
		matches: ( _url, parsed ) =>
			parsed.pathname.endsWith( '/admin.php' ) && parsed.searchParams.get( 'page' ) === 'my-entries',
		params: ( _url, parsed ) => ( { tab: parsed.searchParams.get( 'tab' ) ?? '' } ),
	} );
} );

afterEach( () => {
	_resetNativeUrlRemap();
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'runtime host openUrl', () => {
	test( 'a URL a native window has claimed opens THAT window, with the remap params, and no iframe', () => {
		buildHost( 'app-window' ).openUrl?.( CLAIMED, 'Trust checks', 'dashicons-shield' );
		expect( openById ).toHaveBeenCalledTimes( 1 );
		expect( openById.mock.calls[ 0 ][ 0 ] ).toBe( 'my-plugin-entries' );
		expect( openById.mock.calls[ 0 ][ 1 ] ).toEqual( { params: { tab: 'trust' } } );
		expect( windowOpen ).not.toHaveBeenCalled();
	} );

	test( 'an unclaimed admin URL still opens as an iframe window', () => {
		buildHost( 'app-window' ).openUrl?.( UNCLAIMED, 'Updates', '' );
		expect( openById ).not.toHaveBeenCalled();
		expect( windowOpen ).toHaveBeenCalledTimes( 1 );
		expect( windowOpen.mock.calls[ 0 ][ 0 ] ).toMatchObject( { url: UNCLAIMED, title: 'Updates' } );
	} );

	test( 'a claimed URL whose native window refuses to open falls through to the iframe', () => {
		openById.mockReturnValueOnce( false );
		buildHost( 'app-window' ).openUrl?.( CLAIMED, '', '' );
		expect( windowOpen ).toHaveBeenCalledTimes( 1 );
	} );
} );
