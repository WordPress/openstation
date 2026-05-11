/**
 * Auto-injects the WordPress REST cookie nonce (`X-WP-Nonce`) into
 * outbound fetch requests routed through the framework helper.
 *
 * Why this exists: WordPress's `rest_cookie_check_errors()` treats a
 * logged-in cookie request that arrives without `X-WP-Nonce` as
 * anonymous — it calls `wp_set_current_user( 0 )` mid-request. Any
 * permission callback that gates on `is_user_logged_in()` or a
 * capability check then fails, and the response is `401`. The
 * session cookie alone is not enough.
 *
 * Before this helper, every plugin author had to remember to attach
 * the header on every REST call, pulling the value out of
 * `desktopModeConfig.restNonce`. Forgetting silently 401'd in
 * production while passing locally with admin cookies that hadn't
 * yet expired. `wp.desktop.fetch` / `trackedFetch` now do it
 * automatically — pass the URL, get the auth.
 *
 * Scope of injection — all four conditions must hold:
 *
 *   1. `window.desktopModeConfig.restNonce` is a non-empty string.
 *   2. The request URL is **same-origin** (the nonce is a credential
 *      for this site; we MUST NOT leak it to third-party endpoints).
 *   3. The URL targets a WordPress REST endpoint, detected by either
 *      `/wp-json/` in the pathname (pretty permalinks) OR a
 *      `rest_route=` query parameter (plain permalinks).
 *   4. The caller has not already set `X-WP-Nonce` on `init.headers`
 *      or on the input `Request` — explicit caller-set values win.
 *
 * `admin-ajax.php` is intentionally NOT covered. Admin-ajax uses
 * per-action `_wpnonce` parameters with different action strings;
 * the `wp_rest` nonce wouldn't validate there.
 *
 * @since 0.20.0
 */

const NONCE_HEADER = 'X-WP-Nonce';

/**
 * Returns a possibly-new {@link RequestInit} with the REST nonce
 * header merged in, or the original `init` reference when no
 * injection is needed (so callers can pass the return value
 * straight through to `fetch`).
 */
export function injectRestNonce(
	input: RequestInfo | URL,
	init?: RequestInit,
): RequestInit | undefined {
	const nonce = readRestNonce();
	if ( ! nonce ) {
		return init;
	}
	const url = resolveUrl( input );
	if ( ! url || ! isSameOriginRestUrl( url ) ) {
		return init;
	}

	// Build the base header set fetch will actually use:
	// - If init.headers exists (even an empty object), fetch uses
	//   it exclusively and ignores any headers on a Request input.
	//   We mirror that to avoid silently dropping caller intent.
	// - If init.headers is absent and the input is a Request, we
	//   start from the Request's headers so we don't strip them
	//   when we hand a new init back.
	const baseHeaders =
		init?.headers ??
		( typeof Request !== 'undefined' && input instanceof Request
			? input.headers
			: undefined );
	const headers = new Headers( baseHeaders ?? {} );
	if ( headers.has( NONCE_HEADER ) ) {
		return init;
	}
	headers.set( NONCE_HEADER, nonce );
	return { ...( init ?? {} ), headers };
}

function readRestNonce(): string | undefined {
	if ( typeof window === 'undefined' ) {
		return undefined;
	}
	const cfg = ( window as unknown as {
		desktopModeConfig?: { restNonce?: unknown };
	} ).desktopModeConfig;
	const value = cfg?.restNonce;
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resolveUrl( input: RequestInfo | URL ): URL | null {
	try {
		const base =
			typeof window !== 'undefined' && window.location
				? window.location.href
				: undefined;
		if ( typeof input === 'string' ) {
			return new URL( input, base );
		}
		if ( input instanceof URL ) {
			return input;
		}
		if ( typeof Request !== 'undefined' && input instanceof Request ) {
			return new URL( input.url, base );
		}
		return null;
	} catch {
		return null;
	}
}

function isSameOriginRestUrl( url: URL ): boolean {
	if (
		typeof window === 'undefined' ||
		! window.location ||
		url.origin !== window.location.origin
	) {
		return false;
	}
	if ( url.pathname.includes( '/wp-json/' ) ) {
		return true;
	}
	if ( url.searchParams.has( 'rest_route' ) ) {
		return true;
	}
	return false;
}
