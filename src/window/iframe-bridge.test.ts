/**
 * Tests for the iframe postMessage handlers that landed in 0.11.0:
 * `desktop-mode-ready`, `desktop-mode-navigate`, and
 * `desktop-mode-notification`. The older handlers (`title-change`,
 * `focus-request`, etc.) are covered by the cross-module
 * observability tests under `tests/vitest/`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { handleWindowMessage } from './iframe-bridge';
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
