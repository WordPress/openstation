/**
 * Tests for the iframe postMessage handlers:
 * `os-ready`, `os-navigate`, and
 * `os-notification`. The older handlers (`title-change`,
 * `focus-request`, etc.) are covered by the cross-module
 * observability tests under `tests/vitest/`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	adoptPageTitle,
	bindAdminLinkDispatch,
	handleFinishedScreenHandoff,
	handleWindowMessage,
} from './iframe-bridge';
import {
	_resetDestructiveAdminActionsForTests,
	registerDestructiveAdminAction,
} from '../destructive-admin-actions';
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

const { osConfirm } = vi.hoisted( () => ( { osConfirm: vi.fn() } ) );
vi.mock( '../ui/components/os-confirm-dialog/os-confirm-dialog', () => ( {
	osConfirm,
} ) );

function mockWindow( overrides: Partial< Window > = {} ): Window {
	const iframe = document.createElement( 'iframe' );
	const element = document.createElement( 'div' );
	return {
		id: 'test-window',
		element,
		iframe,
		onFocusRequest: null,
		setTitle: vi.fn(),
		destroy: vi.fn(),
		_isDestroyed: false,
		_closePending: false,
		_iframeCloseTimeout: null,
		// Activity surface — the bridge brackets iframe requests onto
		// the title-bar status ring, and resets on every new document.
		_markActivityStart: vi.fn(),
		_markActivitySettled: vi.fn(),
		_resetActivity: vi.fn(),
		_noteNavigationActivity: vi.fn(),
		_settleNavigationActivity: vi.fn( () => false ),
		// Release / drop for a navigation paint withheld over an
		// unsaved-changes prompt — see `./unsaved-guard.ts`.
		_commitDeferredNavigation: vi.fn(),
		_clearDeferredNavigation: vi.fn(),
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

describe( 'iframe-bridge: os-ready', () => {
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

		postToWindow( win, { type: 'os-ready' } );

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

		postToWindow( win, { type: 'os-ready' } );

		expect( seen ).toEqual( [ { windowId: 'test-window' } ] );
	} );

	test( 'a new document resets the activity count', () => {
		// An iframe that navigates mid-request takes its pending
		// `end` messages with it. Without the reset the ring stays
		// lit for the rest of the window's life.
		const win = mockWindow();
		postToWindow( win, { type: 'os-ready' } );
		expect( win._resetActivity ).toHaveBeenCalled();
	} );

	test( 'a document that answers a form submit settles it instead', () => {
		// The submit's own outcome is on the ring — resetting here
		// would throw away the thing the ring exists to show.
		const win = mockWindow( {
			_settleNavigationActivity: vi.fn( () => true ),
		} as unknown as Partial< Window > );

		postToWindow( win, { type: 'os-ready' } );

		expect( win._settleNavigationActivity ).toHaveBeenCalledWith( true );
		expect( win._resetActivity ).not.toHaveBeenCalled();
	} );

	test( 'the head report settles it earlier, and touches nothing else', () => {
		// Every navigation posts one, submit or not, so a window with
		// nothing waiting comes away untouched — and it is not the
		// closing report, which stays `os-ready`'s job.
		const win = mockWindow();

		postToWindow( win, { type: 'os-iframe-navigated' } );

		expect( win._settleNavigationActivity ).toHaveBeenCalledWith();
		expect( win._resetActivity ).not.toHaveBeenCalled();
		expect( win._markActivityStart ).not.toHaveBeenCalled();
	} );
} );

describe( 'iframe-bridge: os-iframe-unloading', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => clearHooksStub() );

	test( 'releases a navigation paint the shell withheld over a prompt', () => {
		const win = mockWindow();

		postToWindow( win, { type: 'os-iframe-unloading' } );

		expect( win._commitDeferredNavigation ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a paint still armed when the next document is ready is dropped, not run', () => {
		// Overtaken: running it here would arm the overlay for a load
		// that has already finished, and the ready edge that would
		// have cleared it is spent.
		const win = mockWindow();

		postToWindow( win, { type: 'os-ready' } );

		expect( win._clearDeferredNavigation ).toHaveBeenCalledTimes( 1 );
		expect( win._commitDeferredNavigation ).not.toHaveBeenCalled();
	} );
} );

describe( 'iframe-bridge: os-iframe-activity', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => clearHooksStub() );

	test( 'start marks the window busy', () => {
		const win = mockWindow();
		postToWindow( win, { type: 'os-iframe-activity', phase: 'start' } );
		expect( win._markActivityStart ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'only a navigation start waits on the next document', () => {
		// An ordinary start has an `end` of its own coming.
		const plain = mockWindow();
		postToWindow( plain, { type: 'os-iframe-activity', phase: 'start' } );
		expect( plain._noteNavigationActivity ).not.toHaveBeenCalled();

		const nav = mockWindow();
		postToWindow( nav, {
			type: 'os-iframe-activity',
			phase: 'start',
			navigation: true,
		} );
		expect( nav._markActivityStart ).toHaveBeenCalledTimes( 1 );
		expect( nav._noteNavigationActivity ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a 2xx end settles as success', () => {
		const win = mockWindow();
		postToWindow( win, {
			type: 'os-iframe-activity',
			phase: 'end',
			failed: false,
			status: 200,
		} );
		expect( win._markActivitySettled ).toHaveBeenCalledWith(
			true,
			undefined,
		);
	} );

	test( 'an HTTP error settles as failure and carries the status', () => {
		const win = mockWindow();
		postToWindow( win, {
			type: 'os-iframe-activity',
			phase: 'end',
			failed: true,
			status: 500,
		} );
		const [ ok, message ] = ( win._markActivitySettled as ReturnType<
			typeof vi.fn
		> ).mock.calls[ 0 ];
		expect( ok ).toBe( false );
		expect( message ).toContain( '500' );
	} );

	test( 'a network-level failure reports no status number', () => {
		// `status: 0` is the iframe's marker for "no response
		// arrived" — printing it would be noise, not information.
		const win = mockWindow();
		postToWindow( win, {
			type: 'os-iframe-activity',
			phase: 'end',
			failed: true,
			status: 0,
		} );
		const [ ok, message ] = ( win._markActivitySettled as ReturnType<
			typeof vi.fn
		> ).mock.calls[ 0 ];
		expect( ok ).toBe( false );
		expect( message ).not.toContain( '0' );
	} );

	test( 'an unknown phase does nothing', () => {
		const win = mockWindow();
		postToWindow( win, { type: 'os-iframe-activity', phase: 'nonsense' } );
		expect( win._markActivityStart ).not.toHaveBeenCalled();
		expect( win._markActivitySettled ).not.toHaveBeenCalled();
	} );
} );

describe( 'iframe-bridge: os-navigate', () => {
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
			type: 'os-navigate',
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
			type: 'os-navigate',
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
			type: 'os-navigate',
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
				type: 'os-navigate',
				url: 'http://[invalid',
				target: 'new',
			} );
		} ).not.toThrow();
		expect( openSpy ).not.toHaveBeenCalled();
	} );
} );

describe( 'iframe-bridge: os-notification', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		document.querySelectorAll( 'os-toast-container' ).forEach( ( el ) => el.remove() );
		clearHooksStub();
	} );

	test( 'renders a toast with title+body joined', () => {
		const win = mockWindow();

		postToWindow( win, {
			type: 'os-notification',
			title: 'Saved',
			body: 'Settings updated',
		} );

		const toast = document.querySelector( 'os-toast' );
		expect( toast ).not.toBeNull();
		expect( toast!.textContent ).toContain( 'Saved' );
		expect( toast!.textContent ).toContain( 'Settings updated' );
	} );

	test( 'renders title only when body is empty', () => {
		const win = mockWindow();

		postToWindow( win, {
			type: 'os-notification',
			title: 'Only title',
		} );

		const toast = document.querySelector( 'os-toast' );
		expect( toast ).not.toBeNull();
		expect( toast!.textContent ).toContain( 'Only title' );
	} );

	test( 'empty title drops the message', () => {
		const win = mockWindow();

		postToWindow( win, {
			type: 'os-notification',
			title: '',
			body: 'orphan body',
		} );

		expect( document.querySelector( 'os-toast' ) ).toBeNull();
	} );
} );

describe( 'iframe-bridge: os-iframe-admin-link', () => {
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

	function mockAdminWindow( opts: {
		id: string;
		baseId?: string;
		/**
		 * The URL the iframe is currently showing. Diverges from the
		 * window's opening slug once the submenu tab strip re-points
		 * the iframe in place. Omitted → no live URL readable, which
		 * is the pre-navigation state.
		 */
		currentUrl?: string;
	} ): {
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
			getCurrentUrl: () => opts.currentUrl ?? '',
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
		postToWindow( win, { type: 'os-iframe-admin-link', url: target } );

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
		postToWindow( win, { type: 'os-iframe-admin-link', url: target } );

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

	test( 'click matching the live iframe slug navigates in place, not a new window', () => {
		// Appearance window opened on `themes.php`, then re-pointed at
		// `nav-menus.php` by the submenu tab strip. Its `baseId` still
		// says `themes-php`, so the Menus screen's own tab links used
		// to read as cross-page and spawn a window per click.
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( {
			id: 'themes-php',
			currentUrl:
				window.location.origin +
				'/wp-admin/nav-menus.php?openstation_chromeless=1',
		} );

		const target =
			window.location.origin + '/wp-admin/nav-menus.php?action=edit&menu=2';
		postToWindow( win, { type: 'os-iframe-admin-link', url: target } );

		expect( assignSpy ).toHaveBeenCalledWith( target );
		expect( openWindow ).not.toHaveBeenCalled();
		expect( win.close ).not.toHaveBeenCalled();
	} );

	test( 'live slug never narrows the same-page set — baseId still matches', () => {
		// A window that navigated away from its landing page must still
		// treat a link BACK to that landing page as in-place.
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( {
			id: 'themes-php',
			currentUrl: window.location.origin + '/wp-admin/nav-menus.php',
		} );

		const target = window.location.origin + '/wp-admin/themes.php';
		postToWindow( win, { type: 'os-iframe-admin-link', url: target } );

		expect( assignSpy ).toHaveBeenCalledWith( target );
		expect( openWindow ).not.toHaveBeenCalled();
	} );

	test( 'live slug that matches neither side still opens a fresh window', () => {
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( {
			id: 'themes-php',
			currentUrl: window.location.origin + '/wp-admin/nav-menus.php',
		} );

		const target = window.location.origin + '/wp-admin/upload.php';
		postToWindow( win, { type: 'os-iframe-admin-link', url: target } );

		expect( openWindow ).toHaveBeenCalledTimes( 1 );
		expect( assignSpy ).not.toHaveBeenCalled();
	} );

	test( 'different-slug click without a dock entry uses the link label as title', () => {
		const { openWindow } = bindFakeDispatcher();
		const { win } = mockAdminWindow( { id: 'edit-php-post-type-page' } );

		const target =
			window.location.origin +
			'/wp-admin/options-general.php?page=some-plugin';
		postToWindow( win, {
			type: 'os-iframe-admin-link',
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
			type: 'os-iframe-admin-link',
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
			type: 'os-iframe-admin-link',
			url: window.location.origin + '/wp-admin/edit.php?post_type=post',
			label: 'All the posts',
		} );

		expect( openWindow.mock.calls[ 0 ][ 0 ].title ).toBe( 'Posts' );
	} );

	test( 'a new-context link never drives the window it was clicked in', () => {
		// `target="_blank"` asks for one thing: that the page it was
		// clicked on survives. The same-slug branch would move that
		// window instead, which is worse than the browser tab it used
		// to get.
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( {
			id: 'edit-php-post-type-page',
		} );

		postToWindow( win, {
			type: 'os-iframe-admin-link',
			url:
				window.location.origin +
				'/wp-admin/edit.php?post_type=page&paged=2',
			newContext: true,
		} );

		expect( assignSpy ).not.toHaveBeenCalled();
		expect( openWindow ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a new-context link skips the destructive in-place branch too', () => {
		// That branch fires on a slug MISMATCH, which is exactly the
		// shape a `_blank` reaches the parent with.
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( { id: 'edit-php' } );

		postToWindow( win, {
			type: 'os-iframe-admin-link',
			url:
				window.location.origin +
				'/wp-admin/post.php?post=42&action=trash&_wpnonce=abc',
			newContext: true,
		} );

		expect( assignSpy ).not.toHaveBeenCalled();
		expect( openWindow ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'cross-origin URL is silently refused', () => {
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( {
			id: 'edit-php-post-type-page',
		} );

		postToWindow( win, {
			type: 'os-iframe-admin-link',
			url: 'https://evil.example.com/wp-admin/edit.php',
		} );

		expect( openWindow ).not.toHaveBeenCalled();
		expect( assignSpy ).not.toHaveBeenCalled();
	} );

	test( 'destructive action (trash) navigates the source iframe in place, not a new window', () => {
		// Vanilla wp-admin treats Trash / Untrash / Delete row
		// actions as in-place: the list refreshes with the
		// "1 post moved to the Trash. Undo." notice. Reproducing
		// that here keeps the source list authoritative (avoids
		// a stale row) AND lets WP's `wp_get_referer()` resolve
		// to the source page (Referer is the iframe's current
		// URL during `location.assign`, not the parent shell's).
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( { id: 'edit-php' } );

		const target =
			window.location.origin +
			'/wp-admin/post.php?post=42&action=trash&_wpnonce=abc&openstation_chromeless=1';
		postToWindow( win, {
			type: 'os-iframe-admin-link',
			url: target,
		} );

		expect( assignSpy ).toHaveBeenCalledWith( target );
		expect( openWindow ).not.toHaveBeenCalled();
		expect( win.close ).not.toHaveBeenCalled();
	} );

	test( 'destructive action without a nonce still opens a new window', () => {
		// `?action=trash` with no `_wpnonce` is meaningless to WP
		// (`check_admin_referer` would reject it). The action-name
		// match alone isn't a reliable signal — a plugin could
		// reuse the word for a non-destructive flow. The nonce
		// presence is the actual disambiguator.
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( { id: 'edit-php' } );

		const target =
			window.location.origin +
			'/wp-admin/post.php?post=42&action=trash';
		postToWindow( win, {
			type: 'os-iframe-admin-link',
			url: target,
		} );

		expect( openWindow ).toHaveBeenCalledTimes( 1 );
		expect( assignSpy ).not.toHaveBeenCalled();
	} );

	test( 'Edit row action (no nonce) opens a new window — destructive whitelist does not over-claim', () => {
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( { id: 'edit-php' } );

		const target =
			window.location.origin +
			'/wp-admin/post.php?post=42&action=edit';
		postToWindow( win, {
			type: 'os-iframe-admin-link',
			url: target,
		} );

		expect( openWindow ).toHaveBeenCalledTimes( 1 );
		expect( assignSpy ).not.toHaveBeenCalled();
	} );

	test( 'plugin-registered destructive predicate keeps cross-page URL in place', () => {
		// The extension point: an action name OUTSIDE the built-in
		// whitelist gets in-place behavior because a plugin
		// registered a predicate for it.
		_resetDestructiveAdminActionsForTests();
		registerDestructiveAdminAction( {
			id: 'test/woo-trash-order',
			matches: ( _url, parsed ) =>
				parsed.pathname.endsWith( '/admin.php' ) &&
				parsed.searchParams.get( 'page' ) === 'wc-orders' &&
				parsed.searchParams.get( 'action' ) === 'trash' &&
				parsed.searchParams.has( '_wpnonce' ),
		} );

		try {
			const { openWindow } = bindFakeDispatcher();
			const { win, assignSpy } = mockAdminWindow( {
				id: 'admin-php-page-wc-orders',
			} );
			( win.config as unknown as { url: string } ).url =
				window.location.origin + '/wp-admin/admin.php?page=wc-orders';

			const target =
				window.location.origin +
				'/wp-admin/admin.php?page=wc-orders&action=trash&order=99&_wpnonce=woo';
			postToWindow( win, {
				type: 'os-iframe-admin-link',
				url: target,
			} );

			expect( openWindow ).not.toHaveBeenCalled();
			expect( assignSpy ).toHaveBeenCalledTimes( 1 );
			const navigated = new URL( String( assignSpy.mock.calls[ 0 ][ 0 ] ) );
			// Still goes through `stampSourceReferer` for the same
			// Referrer-Policy reasons as built-in destructive actions.
			expect( navigated.searchParams.get( '_wp_http_referer' ) ).toBe(
				'/wp-admin/admin.php?page=wc-orders',
			);
			expect( navigated.searchParams.get( 'action' ) ).toBe( 'trash' );
		} finally {
			_resetDestructiveAdminActionsForTests();
		}
	} );

	test( 'plugin-registered predicate that returns false leaves the URL on the cross-page path', () => {
		_resetDestructiveAdminActionsForTests();
		registerDestructiveAdminAction( {
			id: 'test/never-matches',
			matches: () => false,
		} );

		try {
			const { openWindow } = bindFakeDispatcher();
			const { win, assignSpy } = mockAdminWindow( { id: 'edit-php' } );

			const target =
				window.location.origin +
				'/wp-admin/admin.php?page=foo&action=export&_wpnonce=zzz';
			postToWindow( win, {
				type: 'os-iframe-admin-link',
				url: target,
			} );

			expect( openWindow ).toHaveBeenCalledTimes( 1 );
			expect( assignSpy ).not.toHaveBeenCalled();
		} finally {
			_resetDestructiveAdminActionsForTests();
		}
	} );

	test( 'comment moderation action (spam) navigates in place', () => {
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( { id: 'edit-comments-php' } );

		const target =
			window.location.origin +
			'/wp-admin/comment.php?action=spamcomment&c=99&_wpnonce=xyz';
		postToWindow( win, {
			type: 'os-iframe-admin-link',
			url: target,
		} );

		expect( assignSpy ).toHaveBeenCalledWith( target );
		expect( openWindow ).not.toHaveBeenCalled();
	} );

	test( 'cross-page open stamps `_wp_http_referer` from the source window URL', () => {
		// Safety-net regression: even with the destructive-action
		// short-circuit in place, plugin-specific side-effect URLs
		// that DON'T match the whitelist will still open a new
		// window — and there a fresh iframe has no prior in-frame
		// navigation, so the browser's `Referer` header on the
		// destination request is the desktop shell's URL. Threading
		// `_wp_http_referer` makes `wp_get_referer()` resolve to the
		// page the user clicked from, preventing post-action
		// redirects from bouncing to whatever URL the shell page
		// happens to be on.
		const { openWindow } = bindFakeDispatcher();
		const { win } = mockAdminWindow( { id: 'edit-php' } );
		( win.config as unknown as { url: string } ).url =
			window.location.origin + '/wp-admin/edit.php?openstation_chromeless=1';

		// Cross-page URL with a nonce but an action name OUTSIDE
		// the destructive whitelist — represents a plugin's custom
		// side-effect link.
		const target =
			window.location.origin +
			'/wp-admin/admin.php?page=my-plugin&action=custom-export&_wpnonce=abc';
		postToWindow( win, {
			type: 'os-iframe-admin-link',
			url: target,
		} );

		expect( openWindow ).toHaveBeenCalledTimes( 1 );
		const openedUrl = String( openWindow.mock.calls[ 0 ][ 0 ].url );
		const parsed = new URL( openedUrl );
		// The `openstation_chromeless` flag is stripped from the
		// referer hint — `wp_get_referer()` consumers pass the
		// result downstream into further redirects, and a
		// chromeless-flagged referer would loop the flag into URLs
		// that shouldn't carry it. The post-redirect preserve
		// filter (server-side) reattaches it where needed.
		expect( parsed.searchParams.get( '_wp_http_referer' ) ).toBe(
			'/wp-admin/edit.php',
		);
		// Original action params survive the rewrite.
		expect( parsed.searchParams.get( 'action' ) ).toBe( 'custom-export' );
		expect( parsed.searchParams.get( 'page' ) ).toBe( 'my-plugin' );
	} );

	test( 'destructive action in-place navigation stamps `_wp_http_referer`', () => {
		// Real-world `Referrer-Policy` headers can downgrade the
		// browser's `Referer` to just the origin, dropping the path
		// WP needs to redirect back to the list. The explicit hint
		// makes the destination resolution deterministic.
		const { openWindow } = bindFakeDispatcher();
		const { win, assignSpy } = mockAdminWindow( { id: 'edit-php' } );
		( win.config as unknown as { url: string } ).url =
			window.location.origin + '/wp-admin/edit.php?openstation_chromeless=1';

		const target =
			window.location.origin +
			'/wp-admin/post.php?post=42&action=trash&_wpnonce=abc&openstation_chromeless=1';
		postToWindow( win, {
			type: 'os-iframe-admin-link',
			url: target,
		} );

		expect( openWindow ).not.toHaveBeenCalled();
		expect( assignSpy ).toHaveBeenCalledTimes( 1 );
		const navigatedTo = String( assignSpy.mock.calls[ 0 ][ 0 ] );
		const parsed = new URL( navigatedTo );
		expect( parsed.searchParams.get( '_wp_http_referer' ) ).toBe(
			'/wp-admin/edit.php',
		);
		// Action params survive the rewrite.
		expect( parsed.searchParams.get( 'action' ) ).toBe( 'trash' );
		expect( parsed.searchParams.get( 'post' ) ).toBe( '42' );
		expect( parsed.searchParams.get( '_wpnonce' ) ).toBe( 'abc' );
	} );

	test( 'cross-page open does not double-stamp an existing `_wp_http_referer`', () => {
		const { openWindow } = bindFakeDispatcher();
		const { win } = mockAdminWindow( { id: 'edit-php' } );
		( win.config as unknown as { url: string } ).url =
			window.location.origin + '/wp-admin/edit.php';

		const target =
			window.location.origin +
			'/wp-admin/post.php?post=42&action=trash&_wp_http_referer=%2Fwp-admin%2Fcustom.php';
		postToWindow( win, {
			type: 'os-iframe-admin-link',
			url: target,
		} );

		expect( openWindow ).toHaveBeenCalledTimes( 1 );
		const openedUrl = String( openWindow.mock.calls[ 0 ][ 0 ].url );
		const parsed = new URL( openedUrl );
		// Caller-supplied referer wins — we don't overwrite.
		expect( parsed.searchParams.get( '_wp_http_referer' ) ).toBe(
			'/wp-admin/custom.php',
		);
	} );

	test( 'unbound deps drops the click without crashing', () => {
		// No bindFakeDispatcher() — leave deps null.
		const { win } = mockAdminWindow( { id: 'edit-php-post-type-page' } );

		expect( () => {
			postToWindow( win, {
				type: 'os-iframe-admin-link',
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
			{ type: 'os-title-change', title: 'evil' },
			{ origin: 'https://evil.example.com' },
		);

		expect( setTitleSpy ).not.toHaveBeenCalled();
	} );
} );

describe( 'iframe-bridge: os-bridge-beforeunload-response', () => {
	beforeEach( () => {
		installHooksStub();
		osConfirm.mockReset();
	} );
	afterEach( () => clearHooksStub() );

	test( 'prevent: false destroys the window without showing a dialog', async () => {
		const win = mockWindow();

		postToWindow( win, {
			type: 'os-bridge-beforeunload-response',
			prevent: false,
		} );
		await vi.dynamicImportSettled();

		expect( osConfirm ).not.toHaveBeenCalled();
		expect( win.destroy ).toHaveBeenCalledTimes( 1 );
		expect( win._closePending ).toBe( false );
	} );

	test( 'prevent: true, user confirms — destroys the window', async () => {
		const win = mockWindow();
		osConfirm.mockResolvedValue( true );

		postToWindow( win, {
			type: 'os-bridge-beforeunload-response',
			prevent: true,
			message: 'You have unsaved edits.',
		} );
		await vi.dynamicImportSettled();
		await vi.waitFor( () => expect( win.destroy ).toHaveBeenCalledTimes( 1 ) );

		expect( osConfirm ).toHaveBeenCalledWith(
			expect.objectContaining( { title: 'You have unsaved edits.', danger: true } ),
		);
	} );

	test( 'prevent: true, user cancels — window stays open', async () => {
		const win = mockWindow();
		osConfirm.mockResolvedValue( false );

		postToWindow( win, {
			type: 'os-bridge-beforeunload-response',
			prevent: true,
		} );
		await vi.dynamicImportSettled();
		await vi.waitFor( () => expect( osConfirm ).toHaveBeenCalledTimes( 1 ) );

		expect( win.destroy ).not.toHaveBeenCalled();
	} );

	test( 'prevent: true, missing message — falls back to a default dialog title', async () => {
		const win = mockWindow();
		osConfirm.mockResolvedValue( false );

		postToWindow( win, {
			type: 'os-bridge-beforeunload-response',
			prevent: true,
		} );
		await vi.dynamicImportSettled();

		expect( osConfirm ).toHaveBeenCalledWith(
			expect.objectContaining( { title: 'Unsaved changes' } ),
		);
	} );

	test( 'confirm dialog import failing still destroys the window (fail safe)', async () => {
		const win = mockWindow();
		osConfirm.mockRejectedValue( new Error( 'boom' ) );

		postToWindow( win, {
			type: 'os-bridge-beforeunload-response',
			prevent: true,
		} );
		await vi.dynamicImportSettled();
		await vi.waitFor( () => expect( win.destroy ).toHaveBeenCalledTimes( 1 ) );
	} );

	test( 'ignores the response entirely if the window is already destroyed', async () => {
		const win = mockWindow( { _isDestroyed: true } );

		postToWindow( win, {
			type: 'os-bridge-beforeunload-response',
			prevent: false,
		} );
		await vi.dynamicImportSettled();

		expect( win.destroy ).not.toHaveBeenCalled();
		expect( osConfirm ).not.toHaveBeenCalled();
	} );

	test( 'a correlated response belongs to the navigation guard, not the close flow', async () => {
		const win = mockWindow();

		// The pre-navigation query in `unsaved-guard.ts` listens for
		// its own reply. Reading it here too would close a window
		// whose user only clicked a submenu tab.
		postToWindow( win, {
			type: 'os-bridge-beforeunload-response',
			prevent: false,
			requestId: 'os-unsaved-guard-1-1',
		} );
		await vi.dynamicImportSettled();

		expect( win.destroy ).not.toHaveBeenCalled();
		expect( osConfirm ).not.toHaveBeenCalled();
	} );

	test( 'clears the pending safety timeout on any response', () => {
		vi.useFakeTimers();
		const clearSpy = vi.spyOn( global, 'clearTimeout' );
		const timeoutId = setTimeout( () => {}, 500 );
		const win = mockWindow( { _iframeCloseTimeout: timeoutId } );

		postToWindow( win, {
			type: 'os-bridge-beforeunload-response',
			prevent: false,
		} );

		expect( clearSpy ).toHaveBeenCalledWith( timeoutId );
		expect( win._iframeCloseTimeout ).toBeNull();
		vi.useRealTimers();
	} );
} );

describe( 'iframe-bridge: finished-screen handoff', () => {
	type DispatchDeps = Parameters< typeof bindAdminLinkDispatch >[ 0 ];

	const adminUrl = window.location.origin + '/wp-admin/';

	function bindFakeDispatcher() {
		const openWindow = vi.fn();
		const findDockEntry = vi.fn().mockReturnValue( null );
		const deps: NonNullable< DispatchDeps > = {
			adminUrl,
			deriveSlug: ( url ) => {
				const parsed = new URL( url, adminUrl );
				const file = parsed.pathname
					.replace( /.*\/wp-admin\//, '' )
					.replace( /\.php$/, '-php' );
				const post = parsed.searchParams.get( 'post' );
				return post ? `${ file }-post-${ post }` : file;
			},
			openWindow,
			findDockEntry,
		};
		bindAdminLinkDispatch( deps );
		return { openWindow, findDockEntry };
	}

	/** A window whose iframe reports no navigation-timing entry. */
	function mockScreenWindow( openedUrl: string ): Window {
		const iframe = document.createElement( 'iframe' );
		document.body.appendChild( iframe );
		Object.defineProperty( iframe, 'contentWindow', {
			value: { location: { href: '', assign: vi.fn() } },
			configurable: true,
		} );
		return {
			id: 'revision-php',
			element: document.createElement( 'div' ),
			iframe,
			config: { baseId: 'revision-php', url: openedUrl, title: 'Revisions' },
			close: vi.fn(),
			setTitle: vi.fn(),
			getCurrentUrl: () => openedUrl,
		} as unknown as Window;
	}

	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		bindAdminLinkDispatch( null );
		document.querySelectorAll( 'iframe' ).forEach( ( el ) => el.remove() );
		clearHooksStub();
	} );

	test( 'a revisions window that lands on the editor hands off and closes', () => {
		// The restore is a `document.location` assignment in Core's
		// revisions.js, so the shell never sees a click — WP's redirect
		// just turns the Revisions window into a second editor next to
		// the one it was opened from.
		const { openWindow } = bindFakeDispatcher();
		const win = mockScreenWindow(
			window.location.origin + '/wp-admin/revision.php?revision=31',
		);

		const landed =
			window.location.origin +
			'/wp-admin/post.php?post=4&action=edit&message=5&revision=31';
		expect( handleFinishedScreenHandoff( win, landed ) ).toBe( true );

		expect( openWindow ).toHaveBeenCalledTimes( 1 );
		const arg = openWindow.mock.calls[ 0 ][ 0 ];
		expect( arg.id ).toBe( 'post-php-post-4' );
		// `message=5` is what renders "Post restored to revision from …"
		// in the editor — the only confirmation the restore happened.
		expect( arg.url ).toContain( 'message=5' );
		expect( win.close ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'staying on the revisions screen is not a handoff', () => {
		const { openWindow } = bindFakeDispatcher();
		const win = mockScreenWindow(
			window.location.origin + '/wp-admin/revision.php?revision=31',
		);

		expect(
			handleFinishedScreenHandoff(
				win,
				window.location.origin + '/wp-admin/revision.php?revision=30',
			),
		).toBe( false );
		expect( openWindow ).not.toHaveBeenCalled();
		expect( win.close ).not.toHaveBeenCalled();
	} );

	test( 'a window on any other screen is left alone', () => {
		// The submenu tab strip re-points windows across slugs on
		// purpose (Appearance → Menus); closing one out from under that
		// click would be hostile.
		const { openWindow } = bindFakeDispatcher();
		const win = mockScreenWindow(
			window.location.origin + '/wp-admin/themes.php',
		);

		expect(
			handleFinishedScreenHandoff(
				win,
				window.location.origin + '/wp-admin/nav-menus.php',
			),
		).toBe( false );
		expect( openWindow ).not.toHaveBeenCalled();
		expect( win.close ).not.toHaveBeenCalled();
	} );

	test( 'an unbound dispatcher leaves the window open rather than closing it onto nothing', () => {
		bindAdminLinkDispatch( null );
		const win = mockScreenWindow(
			window.location.origin + '/wp-admin/revision.php?revision=31',
		);

		expect(
			handleFinishedScreenHandoff(
				win,
				window.location.origin + '/wp-admin/post.php?post=4&action=edit',
			),
		).toBe( false );
		expect( win.close ).not.toHaveBeenCalled();
	} );
} );

describe( 'iframe-bridge: adoptPageTitle', () => {
	/** A window whose iframe document reports `documentTitle`. */
	function mockTitledWindow(
		config: Record< string, unknown >,
		documentTitle: string,
	): Window {
		const iframe = document.createElement( 'iframe' );
		Object.defineProperty( iframe, 'contentDocument', {
			value: { title: documentTitle },
			configurable: true,
		} );
		return {
			id: 'revision-php',
			element: document.createElement( 'div' ),
			iframe,
			config,
			setTitle: vi.fn(),
		} as unknown as Window;
	}

	test( 'a guessed title is replaced by the page’s own screen name', () => {
		// The classic editor's revisions link reads "Browse", which
		// says nothing about revisions once it is a window name.
		const win = mockTitledWindow(
			{ title: 'Browse', titleFromPage: true },
			'Revisions ‹ My Site — WordPress',
		);

		adoptPageTitle( win );

		expect( win.setTitle ).toHaveBeenCalledWith( 'Revisions' );
	} );

	test( 'a title the shell knows is never overwritten', () => {
		const win = mockTitledWindow(
			{ title: 'Posts' },
			'Posts ‹ My Site — WordPress',
		);

		adoptPageTitle( win );

		expect( win.setTitle ).not.toHaveBeenCalled();
	} );

	test( 'an unrecognised title format is kept whole rather than cut wrong', () => {
		const win = mockTitledWindow(
			{ title: 'Browse', titleFromPage: true },
			'Revisions | My Site',
		);

		adoptPageTitle( win );

		expect( win.setTitle ).toHaveBeenCalledWith( 'Revisions | My Site' );
	} );

	test( 'an unchanged name does not churn the title bar', () => {
		const win = mockTitledWindow(
			{ title: 'Revisions', titleFromPage: true },
			'Revisions ‹ My Site — WordPress',
		);

		adoptPageTitle( win );

		expect( win.setTitle ).not.toHaveBeenCalled();
	} );
} );
