/**
 * Sends a same-origin REST request made with PUT, PATCH or DELETE as
 * POST with an `X-HTTP-Method-Override` header, the way Core's
 * `@wordpress/api-fetch` http-v1 middleware does.
 *
 * Some hosts block those methods, and WordPress Playground answers a
 * PATCH or PUT with 200 without passing its body to PHP, so the save
 * silently does nothing. WordPress's REST server dispatches on the
 * override header, so routes see the method the caller asked for.
 *
 * Same-origin only: Core's CORS response does not allow the override
 * header, so a cross-origin preflight would refuse the request.
 */

import { isSameOriginRestUrl, resolveUrl } from './inject-rest-nonce';

const OVERRIDE_HEADER = 'X-HTTP-Method-Override';
const OVERRIDDEN_METHODS = [ 'PUT', 'PATCH', 'DELETE' ];

/**
 * Returns a new {@link RequestInit} sent as POST with the override
 * header, or the original `init` reference when the request is left
 * as it is.
 */
export function overrideRestMethod(
	input: RequestInfo | URL,
	init?: RequestInit,
): RequestInit | undefined {
	const request =
		typeof Request !== 'undefined' && input instanceof Request ? input : null;
	const method = ( init?.method ?? request?.method ?? 'GET' ).toUpperCase();
	if ( ! OVERRIDDEN_METHODS.includes( method ) ) {
		return init;
	}
	const url = resolveUrl( input );
	if ( ! url || ! isSameOriginRestUrl( url ) ) {
		return init;
	}
	// Same header base fetch would use: `init.headers` replaces the
	// Request's own headers when present.
	const headers = new Headers( init?.headers ?? request?.headers ?? {} );
	headers.set( OVERRIDE_HEADER, method );
	return { ...( init ?? {} ), method: 'POST', headers };
}
