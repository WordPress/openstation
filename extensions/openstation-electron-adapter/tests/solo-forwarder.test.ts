import { describe, expect, test, vi } from 'vitest';

import { installSoloForwarder, sameDocument } from '../src/solo-forwarder';
import type { AdapterConfig } from '../src/types';

const CONFIG = {
	soloParam: 'openstation_solo',
} as unknown as AdapterConfig;

function harness(
	windows: Record< string, unknown >,
	soloId = 'desktop-mode-games',
) {
	let handler: ( ( p: { windowId?: string } ) => void ) | null = null;

	const os = {
		config: {
			adminUrl: 'https://example.test/wp-admin/',
			soloWindow: soloId,
		},
		HOOKS: { WINDOW_OPENED: 'os.window.opened' },
		hooks: {
			addAction: (
				_name: string,
				_ns: string,
				cb: ( p: { windowId?: string } ) => void,
			) => {
				handler = cb;
			},
		},
		windowManager: {
			getById: ( id: string ) => windows[ id ] ?? null,
		},
	};

	const openWindow = vi.fn(
		async ( _req: Record< string, unknown > ): Promise< { ok: boolean; error?: string } > => ( {
			ok: true,
		} ),
	);
	const frame = { isFreedWindow: true as const, openWindow };

	installSoloForwarder( frame, os, CONFIG );

	return {
		openWindow,
		frame,
		fire: ( windowId: string ) => handler?.( { windowId } ),
	};
}

function fakeWindow( id: string, over: Record< string, unknown > = {} ) {
	return {
		id,
		config: { title: id, native: true, ...( over.config as object ) },
		element: { getBoundingClientRect: () => ( { width: 800, height: 600 } ) },
		getCurrentUrl: () => '',
		close: vi.fn(),
		...over,
	};
}

describe( 'forwarding', () => {
	test( 'sends a newly opened window to the host as a native window', async () => {
		const game = fakeWindow( 'os-game-inkfall' );
		const h = harness( { 'os-game-inkfall': game } );

		h.fire( 'os-game-inkfall' );
		await vi.waitFor( () => expect( h.openWindow ).toHaveBeenCalled() );

		const req = h.openWindow.mock.calls[ 0 ][ 0 ] as Record< string, unknown >;
		expect( req.windowId ).toBe( 'os-game-inkfall' );
		expect( req.native ).toBe( true );

		expect( String( req.url ) ).toContain( 'openstation_solo=os-game-inkfall' );
	} );

	test( 'closes the local copy once the host has it', async () => {

		const game = fakeWindow( 'os-game-inkfall' );
		const h = harness( { 'os-game-inkfall': game } );

		h.fire( 'os-game-inkfall' );
		await vi.waitFor( () => expect( game.close ).toHaveBeenCalled() );
	} );

	test( 'leaves the solo window itself alone', () => {

		const h = harness( { 'desktop-mode-games': fakeWindow( 'desktop-mode-games' ) } );

		h.fire( 'desktop-mode-games' );

		expect( h.openWindow ).not.toHaveBeenCalled();
	} );

	test( 'carries an iframe window’s own URL rather than solo mode', async () => {
		const post = fakeWindow( 'post-php', {
			config: { native: false, title: 'Edit Post', url: '' },
			getCurrentUrl: () => 'https://example.test/wp-admin/post.php?post=7',
		} );
		const h = harness( { 'post-php': post } );

		h.fire( 'post-php' );
		await vi.waitFor( () => expect( h.openWindow ).toHaveBeenCalled() );

		const url = String(
			( h.openWindow.mock.calls[ 0 ][ 0 ] as Record< string, unknown > ).url,
		);
		expect( url ).toContain( '/wp-admin/post.php' );
		expect( url ).toContain( 'openstation_chromeless=1' );
	} );

	test( 'falls back to the configured URL before the window has navigated', async () => {

		const post = fakeWindow( 'post-php', {
			config: {
				native: false,
				title: 'Edit Post',
				url: 'https://example.test/wp-admin/post-new.php',
			},
			getCurrentUrl: () => '',
		} );
		const h = harness( { 'post-php': post } );

		h.fire( 'post-php' );
		await vi.waitFor( () => expect( h.openWindow ).toHaveBeenCalled() );

		expect(
			String( ( h.openWindow.mock.calls[ 0 ][ 0 ] as Record< string, unknown > ).url ),
		).toContain( 'post-new.php' );
	} );
} );

describe( 'sameDocument', () => {
	const BASE = 'https://example.test/wp-admin/index.php';

	test( 'ignores the flags that only describe how a page is rendered', () => {
		expect(
			sameDocument(
				`${ BASE }?openstation_chromeless=1`,
				`${ BASE }?desktop_mode_portal=1&desktop_mode_portal_intent=1`,
			),
		).toBe( true );
	} );

	test( 'treats two different solo windows as different', () => {

		expect(
			sameDocument(
				`${ BASE }?openstation_solo=os-game-inkfall`,
				`${ BASE }?openstation_solo=desktop-mode-games`,
			),
		).toBe( false );
	} );

	test( 'catches a solo URL against its own chromeless twin', () => {
		expect(
			sameDocument(
				`${ BASE }?openstation_solo=os-game-inkfall&openstation_chromeless=1`,
				`${ BASE }?openstation_solo=os-game-inkfall&desktop_mode_portal=1`,
			),
		).toBe( true );
	} );

	test( 'distinguishes different screens', () => {
		expect(
			sameDocument( `${ BASE }`, 'https://example.test/wp-admin/edit.php' ),
		).toBe( false );
	} );

	test( 'ignores query order', () => {
		expect(
			sameDocument( `${ BASE }?a=1&b=2`, `${ BASE }?b=2&a=1` ),
		).toBe( true );
	} );
} );

describe( 'when it cannot forward', () => {
	test( 'keeps the local window if the host refuses', async () => {

		const game = fakeWindow( 'os-game-inkfall' );
		const os = harness( { 'os-game-inkfall': game } );
		os.openWindow.mockResolvedValue( { ok: false, error: 'nope' } );
		const spy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );

		os.fire( 'os-game-inkfall' );
		await vi.waitFor( () => expect( spy ).toHaveBeenCalled() );

		expect( game.close ).not.toHaveBeenCalled();
		spy.mockRestore();
	} );

	test( 'keeps the local window if the host throws', async () => {
		const game = fakeWindow( 'os-game-inkfall' );
		const os = harness( { 'os-game-inkfall': game } );
		os.openWindow.mockRejectedValue( new Error( 'ipc gone' ) );
		const spy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );

		os.fire( 'os-game-inkfall' );
		await vi.waitFor( () => expect( spy ).toHaveBeenCalled() );

		expect( game.close ).not.toHaveBeenCalled();
		spy.mockRestore();
	} );

	test( 'does nothing at all against a host too old to offer openWindow', () => {

		let handler: unknown = null;
		const os = {
			config: { adminUrl: 'https://example.test/wp-admin/', soloWindow: 'x' },
			HOOKS: { WINDOW_OPENED: 'os.window.opened' },
			hooks: {
				addAction: ( _n: string, _ns: string, cb: unknown ) => {
					handler = cb;
				},
			},
			windowManager: { getById: () => null },
		};

		installSoloForwarder( { isFreedWindow: true }, os, CONFIG );

		expect( handler ).toBeNull();
	} );

	test( 'ignores a window the manager does not know', () => {
		const h = harness( {} );
		h.fire( 'ghost' );
		expect( h.openWindow ).not.toHaveBeenCalled();
	} );
} );
