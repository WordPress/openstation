/**
 * Window activity notifier — the parent-side half of the background
 * heartbeat throttle. On window focus/blur it must post
 * `os-window-active` to that window's iframe, and an
 * `os-bridge-ready` ping (fired by the bridge after every in-window
 * navigation) must re-seed the fresh document with its current
 * active state.
 */
import { describe, expect, test, vi } from 'vitest';

import { installWindowActivityNotifier } from '../../src/window-activity-notifier';
import type { WindowManager } from '../../src/window-manager';

interface FakeWin {
	id: string;
	iframe: { contentWindow: { postMessage: ReturnType< typeof vi.fn > } };
}

function makeWin( id: string ): FakeWin {
	return { id, iframe: { contentWindow: { postMessage: vi.fn() } } };
}

function makeManager( wins: FakeWin[], focusedId: string | null ) {
	return {
		getById: ( id: string ) => wins.find( ( w ) => w.id === id ) ?? null,
		findByIframeSource: ( source: unknown ) =>
			wins.find( ( w ) => w.iframe.contentWindow === source ) ?? null,
		getFocused: () =>
			wins.find( ( w ) => w.id === focusedId ) ?? null,
	} as unknown as WindowManager;
}

function sent( win: FakeWin ): unknown[] {
	return win.iframe.contentWindow.postMessage.mock.calls.map( ( c ) => c[ 0 ] );
}

describe( 'window-activity-notifier', () => {
	test( 'focus and blur events post os-window-active with the right flag', () => {
		const win = makeWin( 'edit-post-a' );
		installWindowActivityNotifier( makeManager( [ win ], 'edit-post-a' ) );

		document.dispatchEvent(
			new CustomEvent( 'os-window-focused', {
				detail: { windowId: 'edit-post-a' },
			} ),
		);
		document.dispatchEvent(
			new CustomEvent( 'os-window-blurred', {
				detail: { windowId: 'edit-post-a' },
			} ),
		);

		expect( sent( win ) ).toEqual( [
			{ type: 'os-window-active', active: true },
			{ type: 'os-window-active', active: false },
		] );
	} );

	test( 'os-bridge-ready re-seeds a background window as inactive', () => {
		const background = makeWin( 'upload-b' );
		const focused = makeWin( 'edit-post-b' );
		installWindowActivityNotifier(
			makeManager( [ background, focused ], 'edit-post-b' ),
		);

		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				source: background.iframe.contentWindow as unknown as Window,
				data: { type: 'os-bridge-ready' },
			} ),
		);

		expect( sent( background ) ).toEqual( [
			{ type: 'os-window-active', active: false },
		] );
	} );
} );
