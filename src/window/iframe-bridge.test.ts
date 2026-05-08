/**
 * Tests for the iframe postMessage handlers that landed in 0.11.0:
 * `desktop-mode-ready`, `desktop-mode-navigate`, and
 * `desktop-mode-notification`. The older handlers (`title-change`,
 * `focus-request`, etc.) are covered by the cross-module
 * observability tests under `tests/vitest/`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bindAdminLinkDispatch, handleWindowMessage } from './iframe-bridge';
import { HOOKS } from '../hooks';
import type { Window } from './index';
import {
	_resetWindowChannelsForTests,
	markWindowContentLoading,
} from '../window-channels';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from '../../tests/vitest/helpers/hooks-stub';

function mockWindow( overrides: Partial< Window > = {} ): Window {
	const iframe = document.createElement( 'iframe' );
	const element = document.createElement( 'div' );
	return {
		id: 'test-window',
		element,
		iframe,
		onFocusRequest: null,
		setTitle: vi.fn(),
		...overrides,
	} as unknown as Window;
}

function postToWindow(
	win: Window,
	data: unknown,
	override: Partial< MessageEventInit > = {},
): void {
	const event = new MessageEvent( 'message', {
		data,
		origin: window.location.origin,
		source: win.iframe?.contentWindow,
		...override,
	} );
	handleWindowMessage( win, event );
}

describe( 'iframe-bridge: desktop-mode-ready', () => {
	let hooks: FakeWpHooks;
	beforeEach( () => {
		hooks = installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetWindowChannelsForTests();
	} );

	test( 'fires HOOKS.IFRAME_READY with { windowId }', () => {
		const win = mockWindow();
		const seen: Array< { windowId: string } > = [];
		hooks.addAction( HOOKS.IFRAME_READY, 'test', ( ...args ) => {
			seen.push( args[ 0 ] as { windowId: string } );
		} );

		postToWindow( win, { type: 'desktop-mode-ready' } );

		expect( seen ).toEqual( [ { windowId: 'test-window' } ] );
	} );

	test( 'fires HOOKS.WINDOW_CONTENT_LOADED on the loading → ready transition', () => {
		const win = mockWindow();
		const seen: Array< { windowId: string } > = [];
		hooks.addAction( HOOKS.WINDOW_CONTENT_LOADED, 'test', ( ...args ) => {
			seen.push( args[ 0 ] as { windowId: string } );
		} );
		// Construction-side mark — without it the loaded hook
		// would correctly stay silent (no transition to surface).
		markWindowContentLoading( 'test-window' );

		postToWindow( win, { type: 'desktop-mode-ready' } );

		expect( seen ).toEqual( [ { windowId: 'test-window' } ] );
	} );
} );

describe( 'iframe-bridge: desktop-mode-navigate', () => {
	let openSpy: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		installHooksStub();
		openSpy = vi.spyOn( window, 'open' ).mockImplementation( () => null );
	} );
	afterEach( () => {
		openSpy.mockRestore();
		clearHooksStub();
	} );

	test( 'target: "new" calls window.open with noopener/noreferrer', () => {
		const win = mockWindow();
		const target = window.location.origin + '/wp-admin/edit.php';

		postToWindow( win, {
			type: 'desktop-mode-navigate',
			url: target,
			target: 'new',
		} );

		expect( openSpy ).toHaveBeenCalledWith(
			target,
			'_blank',
			'noopener,noreferrer',
		);
	} );

	test( 'target: "self" assigns iframe.src', () => {
		const win = mockWindow();
		const target = window.location.origin + '/wp-admin/profile.php';

		postToWindow( win, {
			type: 'desktop-mode-navigate',
			url: target,
			target: 'self',
		} );

		expect( win.iframe!.src ).toBe( target );
		expect( openSpy ).not.toHaveBeenCalled();
	} );

	test( 'cross-origin URL is silently refused', () => {
		const win = mockWindow();
		const originalSrc = win.iframe!.src;

		postToWindow( win, {
			type: 'desktop-mode-navigate',
			url: 'https://evil.example.com/wp-admin/edit.php',
			target: 'self',
		} );

		expect( win.iframe!.src ).toBe( originalSrc );
		expect( openSpy ).not.toHaveBeenCalled();
	} );

	test( 'unparseable URL is silently refused', () => {
		const win = mockWindow();

		expect( () => {
			postToWindow( win, {
				type: 'desktop-mode-navigate',
				url: 'http://[invalid',
				target: 'new',
			} );
		} ).not.toThrow();
		expect( openSpy ).not.toHaveBeenCalled();
	} );
} );

describe( 'iframe-bridge: desktop-mode-notification', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		document.querySelectorAll( 'wpd-toast-container' ).forEach( ( el ) => el.remove() );
		clearHooksStub();
	} );

	test( 'renders a toast with title+body joined', () => {
		const win = mockWindow();

		postToWindow( win, {
			type: 'desktop-mode-notification',
			title: 'Saved',
			body: 'Settings updated',
		} );

		const toast = document.querySelector( 'wpd-toast' );
		expect( toast ).not.toBeNull();
		expect( toast!.textContent ).toContain( 'Saved' );
		expect( toast!.textContent ).toContain( 'Settings updated' );
	} );

	test( 'renders title only when body is empty', () => {
		const win = mockWindow();

		postToWindow( win, {
			type: 'desktop-mode-notification',
			title: 'Only title',
		} );

		const toast = document.querySelector( 'wpd-toast' );
		expect( toast ).not.toBeNull();
		expect( toast!.textContent ).toContain( 'Only title' );
	} );

	test( 'empty title drops the message', () => {
		const win = mockWindow();

		postToWindow( win, {
			type: 'desktop-mode-notification',
			title: '',
			body: 'orphan body',
		} );

		expect( document.querySelector( 'wpd-toast' ) ).toBeNull();
	} );
} );

describe( 'iframe-bridge: desktop-mode-iframe-admin-link', () => {
	type DispatchDeps = Parameters< typeof bindAdminLinkDispatch >[ 0 ];

	const adminUrl = window.location.origin + '/wp-admin/';

	function bindFakeDispatcher( overrides: Partial< NonNullable< DispatchDeps > > = {} ) {
		const openWindow = vi.fn();
		const findDockEntry = vi.fn().mockReturnValue( null );
		const deps: NonNullable< DispatchDeps > = {
			adminUrl,
			deriveSlug: ( url ) => {
				const parsed = new URL( url, adminUrl );
				const path = parsed.pathname.replace( /.*\/wp-admin\//, '' ).replace( /\.php$/, '-php' );
				const postType = parsed.searchParams.get( 'post_type' );
				return postType ? `${ path }-post-type-${ postType }` : path;
			},
			openWindow,
			findDockEntry,
			...overrides,
		};
		bindAdminLinkDispatch( deps );
		return { openWindow, findDockEntry };
	}

	function mockAdminWindow( opts: { id: string; baseId?: string } ): {
		win: Window;
		assignSpy: ReturnType< typeof vi.fn >;
	} {
		const iframe = document.createElement( 'iframe' );
		document.body.appendChild( iframe );
		const assignSpy = vi.fn();
		// JSDOM's `Location.assign` is non-configurable, so swap the
		// whole `contentWindow` for a stub we control. The bridge
		// only reads `contentWindow.location.assign` — no other
		// surface needs to round-trip.
		const fakeContentWindow = { location: { assign: assignSpy } };
		Object.defineProperty( iframe, 'contentWindow', {
			value: fakeContentWindow,
			configurable: true,
		} );
		const element = document.createElement( 'div' );
		const win = {
			id: opts.id,
			element,
			iframe,
			config: { baseId: opts.baseId ?? opts.id },
			onFocusRequest: null,
			setTitle: vi.fn(),
			close: vi.fn(),
		} as unknown as Window;
		return { win, assignSpy };
	}

	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		bindAdminLinkDispatch( null );
		document.querySelectorAll( 'iframe' ).forEach( ( el ) => el.remove() );
		clearHooksStub();
	} );

	test( 'same-slug click drives the source iframe via location.assign', () => {
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( {
			id: 'edit-php-post-type-page',
		} );

		const target =
			window.location.origin + '/wp-admin/edit.php?post_type=page&paged=2';
		postToWindow( win, { type: 'desktop-mode-iframe-admin-link', url: target } );

		expect( assignSpy ).toHaveBeenCalledWith( target );
		expect( openWindow ).not.toHaveBeenCalled();
		expect( win.close ).not.toHaveBeenCalled();
	} );

	test( 'different-slug click opens a fresh window and leaves the source intact', () => {
		const { openWindow, findDockEntry } = bindFakeDispatcher();
		findDockEntry.mockReturnValue( {
			title: 'Posts',
			icon: 'dashicons-admin-post',
			submenu: [],
			multi: true,
		} );
		const { win, assignSpy } = mockAdminWindow( {
			id: 'edit-php-post-type-page',
		} );

		const target =
			window.location.origin + '/wp-admin/edit.php?post_type=post';
		postToWindow( win, { type: 'desktop-mode-iframe-admin-link', url: target } );

		expect( openWindow ).toHaveBeenCalledTimes( 1 );
		expect( openWindow.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			id: 'edit-php-post-type-post',
			baseId: 'edit-php-post-type-post',
			url: target,
			title: 'Posts',
			icon: 'dashicons-admin-post',
			multi: true,
		} );
		expect( assignSpy ).not.toHaveBeenCalled();
		expect( win.close ).not.toHaveBeenCalled();
	} );

	test( 'different-slug click without a dock entry uses the link label as title', () => {
		const { openWindow } = bindFakeDispatcher();
		const { win } = mockAdminWindow( { id: 'edit-php-post-type-page' } );

		const target =
			window.location.origin +
			'/wp-admin/options-general.php?page=some-plugin';
		postToWindow( win, {
			type: 'desktop-mode-iframe-admin-link',
			url: target,
			label: 'Scheduler',
		} );

		expect( openWindow ).toHaveBeenCalledTimes( 1 );
		const arg = openWindow.mock.calls[ 0 ][ 0 ];
		expect( arg.icon ).toBe( 'dashicons-admin-generic' );
		expect( arg.title ).toBe( 'Scheduler' );
	} );

	test( 'different-slug click without dock entry or label falls back to slug', () => {
		const { openWindow } = bindFakeDispatcher();
		const { win } = mockAdminWindow( { id: 'edit-php-post-type-page' } );

		const target =
			window.location.origin +
			'/wp-admin/options-general.php?page=some-plugin';
		postToWindow( win, {
			type: 'desktop-mode-iframe-admin-link',
			url: target,
		} );

		expect( openWindow ).toHaveBeenCalledTimes( 1 );
		const arg = openWindow.mock.calls[ 0 ][ 0 ];
		expect( arg.title ).toBe( arg.id );
	} );

	test( 'dock entry title beats the link label', () => {
		const { openWindow, findDockEntry } = bindFakeDispatcher();
		findDockEntry.mockReturnValue( {
			title: 'Posts',
			icon: 'dashicons-admin-post',
			submenu: [],
			multi: true,
		} );
		const { win } = mockAdminWindow( { id: 'edit-php-post-type-page' } );

		postToWindow( win, {
			type: 'desktop-mode-iframe-admin-link',
			url: window.location.origin + '/wp-admin/edit.php?post_type=post',
			label: 'All the posts',
		} );

		expect( openWindow.mock.calls[ 0 ][ 0 ].title ).toBe( 'Posts' );
	} );

	test( 'cross-origin URL is silently refused', () => {
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( {
			id: 'edit-php-post-type-page',
		} );

		postToWindow( win, {
			type: 'desktop-mode-iframe-admin-link',
			url: 'https://evil.example.com/wp-admin/edit.php',
		} );

		expect( openWindow ).not.toHaveBeenCalled();
		expect( assignSpy ).not.toHaveBeenCalled();
	} );

	test( 'unbound deps drops the click without crashing', () => {
		// No bindFakeDispatcher() — leave deps null.
		const { win } = mockAdminWindow( { id: 'edit-php-post-type-page' } );

		expect( () => {
			postToWindow( win, {
				type: 'desktop-mode-iframe-admin-link',
				url: window.location.origin + '/wp-admin/upload.php',
			} );
		} ).not.toThrow();
	} );
} );

describe( 'iframe-bridge: foreign events', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => clearHooksStub() );

	test( 'cross-origin event never dispatches a handler', () => {
		const win = mockWindow();
		const setTitleSpy = win.setTitle as ReturnType< typeof vi.fn >;

		postToWindow(
			win,
			{ type: 'desktop-mode-title-change', title: 'evil' },
			{ origin: 'https://evil.example.com' },
		);

		expect( setTitleSpy ).not.toHaveBeenCalled();
	} );
} );
