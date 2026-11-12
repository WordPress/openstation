/**
 * Desktop-files REST client: the nonce is read live on every request.
 *
 * Regression target: a boot-time snapshot of `wp_rest` left every
 * files call 403 (`rest_cookie_invalid_nonce`) once the Heartbeat
 * nonce tick rolled, while other clients that re-read
 * `window.openStationConfig.restNonce` kept working.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	getFolderZipUrl,
	getUploadDownloadUrl,
	installRestDeps,
	listPlacements,
	restoreTrashedItem,
} from '../../src/desktop-files/rest';

interface ConfigCarrier {
	openStationConfig?: { restNonce?: string };
}

function jsonResponse( body: unknown, status = 200 ): Response {
	return new Response( JSON.stringify( body ), {
		status,
		headers: { 'Content-Type': 'application/json' },
	} );
}

function headerValue( init: RequestInit, name: string ): string | null {
	return new Headers( init.headers as HeadersInit ).get( name );
}

describe( 'desktop-files REST nonce', () => {
	let fetchSpy: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		( window as unknown as ConfigCarrier ).openStationConfig = {
			restNonce: 'fresh-1',
		};
		installRestDeps( {
			baseUrl: 'https://example.test/wp-json/desktop-mode/v1/files',
			nonce: 'boot-time',
		} );
		fetchSpy = vi.fn( async () =>
			jsonResponse( { placements: [], folderId: 0 } ),
		);
		vi.stubGlobal( 'fetch', fetchSpy );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		delete ( window as unknown as ConfigCarrier ).openStationConfig;
	} );

	test( 'reads the live shell nonce on every call', async () => {
		await listPlacements();
		let init = fetchSpy.mock.calls[ 0 ][ 1 ] as RequestInit;
		expect( headerValue( init, 'X-WP-Nonce' ) ).toBe( 'fresh-1' );

		( window as unknown as ConfigCarrier ).openStationConfig!.restNonce =
			'fresh-2';
		await listPlacements();
		init = fetchSpy.mock.calls[ 1 ][ 1 ] as RequestInit;
		expect( headerValue( init, 'X-WP-Nonce' ) ).toBe( 'fresh-2' );
	} );

	test( 'recycle-bin restore also sends the live nonce', async () => {
		fetchSpy.mockResolvedValueOnce(
			jsonResponse( { ok: [ 5 ], errors: [] } ),
		);

		await restoreTrashedItem( 5, 'placement' );

		const init = fetchSpy.mock.calls[ 0 ][ 1 ] as RequestInit;
		expect( headerValue( init, 'X-WP-Nonce' ) ).toBe( 'fresh-1' );
	} );

	test( 'minted download URLs carry the live nonce', () => {
		expect( getUploadDownloadUrl( 7 ) ).toContain( '_wpnonce=fresh-1' );
		expect( getFolderZipUrl( 9 ) ).toContain( '_wpnonce=fresh-1' );
	} );
} );
