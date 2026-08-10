/**
 * Host detection and freed-window URL rules.
 *
 * The whole feature hangs off `getHostBridge()` returning non-null, so
 * most of these tests are about the ways it must return NULL: a
 * browser, a half-injected preload, a host app newer than this plugin.
 * Getting any of those wrong turns "OpenStation works in a browser"
 * into "OpenStation throws in a browser".
 */

import { afterEach, describe, expect, test } from 'vitest';

import {
	HOST_PROTOCOL,
	freedWindowUrl,
	getFrameBridge,
	getHostBridge,
	sendLabel,
} from '../src/host';

/** Minimal stand-in for the global the Electron preload injects. */
function installHost( overrides: Record< string, unknown > = {} ): void {
	( window as unknown as Record< string, unknown > ).openStationDesktopHost = {
		isDesktopHost: true,
		protocol: HOST_PROTOCOL,
		platform: 'darwin',
		osLabel: 'Mac',
		appVersion: '1.0.0',
		freeWindow: () => Promise.resolve( { ok: true } ),
		...overrides,
	};
}

afterEach( () => {
	delete ( window as unknown as Record< string, unknown > ).openStationDesktopHost;
	delete ( window as unknown as Record< string, unknown > ).openStationDesktopFrame;
} );

describe( 'getHostBridge', () => {
	test( 'returns null in a plain browser', () => {
		expect( getHostBridge() ).toBeNull();
	} );

	test( 'returns the bridge when a complete one was injected', () => {
		installHost();
		expect( getHostBridge() ).not.toBeNull();
	} );

	test( 'rejects an object that does not claim to be a host', () => {
		installHost( { isDesktopHost: false } );
		expect( getHostBridge() ).toBeNull();
	} );

	test( 'rejects a host speaking a newer protocol than this adapter', () => {
		installHost( { protocol: HOST_PROTOCOL + 1 } );
		expect( getHostBridge() ).toBeNull();
	} );

	test( 'accepts a host speaking an older protocol', () => {
		installHost( { protocol: HOST_PROTOCOL - 1 } );
		expect( getHostBridge() ).not.toBeNull();
	} );

	test( 'rejects a bridge missing the method every path calls', () => {
		installHost( { freeWindow: undefined } );
		expect( getHostBridge() ).toBeNull();
	} );

	test( 'rejects a non-numeric protocol rather than coercing it', () => {
		installHost( { protocol: 'one' } );
		expect( getHostBridge() ).toBeNull();
	} );
} );

describe( 'getFrameBridge', () => {
	test( 'is null in the shell, even with a host attached', () => {
		installHost();
		expect( getFrameBridge() ).toBeNull();
	} );

	test( 'is non-null inside a freed window', () => {
		( window as unknown as Record< string, unknown > ).openStationDesktopFrame = {
			isFreedWindow: true,
			platform: 'darwin',
			osLabel: 'Mac',
			getWindowId: () => 'edit-php',
			onReady: () => {},
		};
		expect( getFrameBridge()?.getWindowId() ).toBe( 'edit-php' );
	} );
} );

describe( 'sendLabel', () => {
	test( 'names the host OS the app reported', () => {
		expect( sendLabel( 'Mac' ) ).toBe( 'Send to your Mac' );
		expect( sendLabel( 'Windows PC' ) ).toBe( 'Send to your Windows PC' );
		expect( sendLabel( 'Linux desktop' ) ).toBe( 'Send to your Linux desktop' );
	} );

	test( 'falls back to a neutral phrase when the host says nothing', () => {
		expect( sendLabel( '' ) ).toBe( 'Send to your desktop' );
		expect( sendLabel( '   ' ) ).toBe( 'Send to your desktop' );
	} );

	test( 'routes both the label and the fallback through the translator', () => {
		const seen: string[] = [];
		const translate = ( text: string ) => {
			seen.push( text );
			return text;
		};
		sendLabel( 'Mac', translate );
		sendLabel( '', translate );
		expect( seen ).toEqual( [ 'Send to your %s', 'Send to your desktop' ] );
	} );
} );

describe( 'freedWindowUrl', () => {
	const opts = {
		adminUrl: 'https://example.test/wp-admin/',
		soloParam: 'openstation_solo',
		origin: 'https://example.test',
	};

	test( 'reuses the iframe URL for an iframe window', () => {
		const url = freedWindowUrl(
			{
				id: 'edit-php',
				config: { native: false },
				getCurrentUrl: () =>
					'https://example.test/wp-admin/edit.php?post_type=page',
			},
			opts,
		);
		expect( url ).toContain( '/wp-admin/edit.php' );
		expect( url ).toContain( 'post_type=page' );
		expect( url ).toContain( 'openstation_chromeless=1' );
		expect( url ).not.toContain( 'openstation_solo' );
	} );

	test( 're-adds the chromeless flag a navigation may have dropped', () => {
		const url = freedWindowUrl(
			{
				id: 'edit-php',
				config: {},
				getCurrentUrl: () => 'https://example.test/wp-admin/edit.php',
			},
			opts,
		);
		expect( url ).toContain( 'openstation_chromeless=1' );
	} );

	test( 'does not duplicate an already-present chromeless flag', () => {
		const url = freedWindowUrl(
			{
				id: 'edit-php',
				config: {},
				getCurrentUrl: () =>
					'https://example.test/wp-admin/edit.php?openstation_chromeless=1',
			},
			opts,
		);
		expect( url.match( /openstation_chromeless/g ) ).toHaveLength( 1 );
	} );

	test( 'sends a native window through solo mode instead', () => {
		const url = freedWindowUrl(
			{ id: 'os-files', config: { native: true } },
			opts,
		);
		expect( url ).toContain( '/wp-admin/index.php' );
		expect( url ).toContain( 'openstation_solo=os-files' );
	} );

	test( 'falls back to solo mode when an iframe window has no URL yet', () => {
		const url = freedWindowUrl(
			{ id: 'edit-php', config: { native: false }, getCurrentUrl: () => '' },
			opts,
		);
		expect( url ).toContain( 'openstation_solo=edit-php' );
	} );

	test( 'refuses a non-http scheme', () => {
		expect(
			freedWindowUrl(
				{
					id: 'x',
					config: {},
					getCurrentUrl: () => 'javascript:alert(1)',
				},
				opts,
			),
		).toBe( '' );
	} );

	test( 'returns empty when there is nothing to build a URL from', () => {
		expect( freedWindowUrl( { id: '', config: { native: true } }, opts ) ).toBe( '' );
		expect(
			freedWindowUrl(
				{ id: 'x', config: { native: true } },
				{ ...opts, adminUrl: '' },
			),
		).toBe( '' );
	} );

	test( 'honours a custom solo query var', () => {
		const url = freedWindowUrl(
			{ id: 'os-files', config: { native: true } },
			{ ...opts, soloParam: 'custom_solo' },
		);
		expect( url ).toContain( 'custom_solo=os-files' );
	} );
} );
