import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock( '../../src/commands', () => ( {
	registerCommand: vi.fn(),
	unregisterByOwner: vi.fn(),
} ) );

import { IframeCommandBridge } from '../../src/commands/iframe-bridge';
import { unregisterByOwner } from '../../src/commands';
import type { WindowManager } from '../../src/window-manager';

interface FakeWin {
	id: string;
	iframe: { contentWindow: { postMessage: ReturnType< typeof vi.fn > } };
}

function makeWin( id: string ): FakeWin {
	return { id, iframe: { contentWindow: { postMessage: vi.fn() } } };
}

function makeManager( wins: FakeWin[] ) {
	return {
		getById: ( id: string ) => wins.find( ( w ) => w.id === id ) ?? null,
		findByIframeSource: ( source: unknown ) =>
			wins.find( ( w ) => w.iframe.contentWindow === source ) ?? null,
		getFocused: () => null,
		open: vi.fn(),
		focus: vi.fn(),
	} as unknown as WindowManager;
}

function sentTypes( win: FakeWin ): string[] {
	return win.iframe.contentWindow.postMessage.mock.calls.map(
		( c ) => ( c[ 0 ] as { type: string } ).type,
	);
}

function focusWindow( id: string ): void {
	document.dispatchEvent(
		new CustomEvent( 'os-window-focused', { detail: { windowId: id } } ),
	);
}

function openPalette(): void {
	document.dispatchEvent(
		new CustomEvent( 'os-palette-opened', { detail: { id: 'test' } } ),
	);
}

function closePalette(): void {
	document.dispatchEvent(
		new CustomEvent( 'os-palette-closed', { detail: { id: 'test' } } ),
	);
}

beforeEach( () => {
	vi.useFakeTimers();
} );

afterEach( () => {
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.clearAllMocks();
} );

describe( 'IframeCommandBridge — palette gating', () => {
	test( 'focusing a window alone does not subscribe it', () => {
		const win = makeWin( 'edit-post' );
		new IframeCommandBridge( {
			manager: makeManager( [ win ] ),
			adminUrl: 'https://example.test/wp-admin/',
		} ).install();

		focusWindow( 'edit-post' );

		expect( sentTypes( win ) ).toEqual( [] );
	} );

	test( 'opening the palette subscribes the focused window', () => {
		const win = makeWin( 'edit-post' );
		new IframeCommandBridge( {
			manager: makeManager( [ win ] ),
			adminUrl: 'https://example.test/wp-admin/',
		} ).install();

		focusWindow( 'edit-post' );
		openPalette();

		expect( sentTypes( win ) ).toEqual( [ 'os-commands-subscribe' ] );
	} );

	test( 'closing the palette unsubscribes only after the grace delay', () => {
		const win = makeWin( 'edit-post' );
		new IframeCommandBridge( {
			manager: makeManager( [ win ] ),
			adminUrl: 'https://example.test/wp-admin/',
		} ).install();

		focusWindow( 'edit-post' );
		openPalette();
		closePalette();

		vi.advanceTimersByTime( 100 );
		expect( sentTypes( win ) ).toEqual( [ 'os-commands-subscribe' ] );

		vi.advanceTimersByTime( 300 );
		expect( sentTypes( win ) ).toEqual( [
			'os-commands-subscribe',
			'os-commands-unsubscribe',
		] );
	} );

	test( 'reopening within the grace window keeps the stream alive', () => {
		const win = makeWin( 'edit-post' );
		new IframeCommandBridge( {
			manager: makeManager( [ win ] ),
			adminUrl: 'https://example.test/wp-admin/',
		} ).install();

		focusWindow( 'edit-post' );
		openPalette();
		closePalette();
		vi.advanceTimersByTime( 100 );
		openPalette();
		vi.advanceTimersByTime( 1000 );

		expect( sentTypes( win ) ).toEqual( [ 'os-commands-subscribe' ] );
	} );

	test( 'focus change while the palette is open switches the stream', () => {
		const a = makeWin( 'edit-post' );
		const b = makeWin( 'upload' );
		new IframeCommandBridge( {
			manager: makeManager( [ a, b ] ),
			adminUrl: 'https://example.test/wp-admin/',
		} ).install();

		focusWindow( 'edit-post' );
		openPalette();
		focusWindow( 'upload' );

		expect( sentTypes( a ) ).toEqual( [
			'os-commands-subscribe',
			'os-commands-unsubscribe',
		] );
		expect( sentTypes( b ) ).toEqual( [ 'os-commands-subscribe' ] );

		expect( unregisterByOwner ).toHaveBeenCalledWith( 'iframe:edit-post' );
	} );

	test( 'focus change while the palette is closed evicts stale entries without streaming', () => {
		const a = makeWin( 'edit-post' );
		const b = makeWin( 'upload' );
		new IframeCommandBridge( {
			manager: makeManager( [ a, b ] ),
			adminUrl: 'https://example.test/wp-admin/',
		} ).install();

		focusWindow( 'edit-post' );
		focusWindow( 'upload' );

		expect( sentTypes( a ) ).toEqual( [] );
		expect( sentTypes( b ) ).toEqual( [] );
		expect( unregisterByOwner ).toHaveBeenCalledWith( 'iframe:edit-post' );
	} );

	test( 'closing the streamed window stops tracking it without posting to a dead iframe', () => {
		const win = makeWin( 'edit-post' );
		new IframeCommandBridge( {
			manager: makeManager( [ win ] ),
			adminUrl: 'https://example.test/wp-admin/',
		} ).install();

		focusWindow( 'edit-post' );
		openPalette();
		document.dispatchEvent(
			new CustomEvent( 'os-window-closed', {
				detail: { windowId: 'edit-post' },
			} ),
		);

		expect( sentTypes( win ) ).toEqual( [ 'os-commands-subscribe' ] );
		expect( unregisterByOwner ).toHaveBeenCalledWith( 'iframe:edit-post' );
	} );
} );
