/**
 * Pins the contract for the framework's auto X-WP-Nonce injection.
 *
 * The injection is what makes `wp.os.fetch` "just work" against
 * REST endpoints from authenticated sessions — without it, plugin
 * authors hit silent 401s the moment they touch `/wp-json/...`
 * because WordPress's `rest_cookie_check_errors()` demotes a
 * cookie-only request to anonymous. The behavior is documented as
 * Stable so the cases below are load-bearing.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'vitest';
import { injectRestNonce } from '../../src/inject-rest-nonce';

function getNonceHeader( init: RequestInit | undefined ): string | null {
	if ( ! init?.headers ) {
		return null;
	}
	return new Headers( init.headers ).get( 'X-WP-Nonce' );
}

describe( 'injectRestNonce', () => {
	beforeEach( () => {
		( window as unknown as { openStationConfig?: unknown } ).openStationConfig = {
			restNonce: 'abc123',
		};
	} );

	afterEach( () => {
		delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
	} );

	test( 'adds the nonce to a pretty-permalink REST URL', () => {
		const init = injectRestNonce( '/wp-json/wp/v2/posts' );
		expect( getNonceHeader( init ) ).toBe( 'abc123' );
	} );

	test( 'adds the nonce to a plain-permalink REST URL', () => {
		const init = injectRestNonce( '/?rest_route=/wp/v2/posts' );
		expect( getNonceHeader( init ) ).toBe( 'abc123' );
	} );

	test( 'preserves caller-supplied headers when merging', () => {
		const init = injectRestNonce( '/wp-json/wp/v2/posts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
		} );
		expect( init?.method ).toBe( 'POST' );
		const headers = new Headers( init?.headers );
		expect( headers.get( 'Content-Type' ) ).toBe( 'application/json' );
		expect( headers.get( 'X-WP-Nonce' ) ).toBe( 'abc123' );
	} );

	test( 'never overrides a caller-set X-WP-Nonce', () => {
		const original: RequestInit = {
			headers: { 'X-WP-Nonce': 'caller-nonce' },
		};
		const result = injectRestNonce( '/wp-json/wp/v2/posts', original );
		// Caller-provided init is returned unchanged.
		expect( result ).toBe( original );
		expect( getNonceHeader( result ) ).toBe( 'caller-nonce' );
	} );

	test( 'skips non-REST same-origin URLs (e.g. admin-ajax)', () => {
		const original: RequestInit = { method: 'POST' };
		const result = injectRestNonce(
			'/wp-admin/admin-ajax.php',
			original,
		);
		expect( result ).toBe( original );
		expect( getNonceHeader( result ) ).toBeNull();
	} );

	test( 'skips cross-origin URLs even when they look like REST', () => {
		const original: RequestInit = {};
		const result = injectRestNonce(
			'https://other.example/wp-json/wp/v2/posts',
			original,
		);
		expect( result ).toBe( original );
		expect( getNonceHeader( result ) ).toBeNull();
	} );

	test( 'bails when openStationConfig is missing', () => {
		delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
		const original: RequestInit = {};
		const result = injectRestNonce(
			'/wp-json/wp/v2/posts',
			original,
		);
		expect( result ).toBe( original );
		expect( getNonceHeader( result ) ).toBeNull();
	} );

	test( 'bails when restNonce is an empty string', () => {
		( window as unknown as { openStationConfig?: unknown } ).openStationConfig = {
			restNonce: '',
		};
		const result = injectRestNonce( '/wp-json/wp/v2/posts' );
		expect( result ).toBeUndefined();
	} );

	test( 'accepts a URL object input', () => {
		const init = injectRestNonce(
			new URL( '/wp-json/wp/v2/posts', window.location.href ),
		);
		expect( getNonceHeader( init ) ).toBe( 'abc123' );
	} );

	test( 'accepts a Request input and preserves its headers', () => {
		const request = new Request(
			new URL( '/wp-json/wp/v2/posts', window.location.href ),
			{ headers: { 'Content-Type': 'application/json' } },
		);
		const init = injectRestNonce( request );
		const headers = new Headers( init?.headers );
		expect( headers.get( 'Content-Type' ) ).toBe( 'application/json' );
		expect( headers.get( 'X-WP-Nonce' ) ).toBe( 'abc123' );
	} );

	test( 'respects a Request input that already carries X-WP-Nonce', () => {
		const request = new Request(
			new URL( '/wp-json/wp/v2/posts', window.location.href ),
			{ headers: { 'X-WP-Nonce': 'caller-nonce' } },
		);
		const result = injectRestNonce( request );
		// No init supplied and Request already has the header → no
		// new init needs to be synthesized.
		expect( result ).toBeUndefined();
	} );
} );
