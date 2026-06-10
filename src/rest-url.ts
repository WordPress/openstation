/**
 * Build a WordPress REST URL that works on every permalink structure.
 *
 * Why this exists: `rest_url()` server-side returns one of two shapes
 * depending on the site's Settings -> Permalinks choice:
 *
 *   - Pretty (Post name, Day and name, Custom, ...):
 *       `https://site.example/wp-json/`
 *   - Plain (the WordPress default on fresh installs):
 *       `https://site.example/index.php?rest_route=/`
 *
 * Naive `restRoot + 'wp/v2/posts?per_page=10'` concatenation works for
 * the first shape and silently breaks for the second (produces a URL
 * with two `?` separators; WordPress routes the request to the
 * homepage and returns HTML, JSON.parse throws). This helper takes a
 * REST root (either shape) plus a relative REST path and produces a
 * well-formed URL string that the WP router will accept.
 *
 * Path semantics:
 *   - Leading slashes on `path` are ignored.
 *   - A `?key=value` query string embedded in `path` is preserved and
 *     merged into the final URL.
 *
 * @since 0.8.3
 */

const FALLBACK_BASE = 'http://localhost/';

export function joinRestUrl( restRoot: string, path: string ): string {
	const base =
		typeof window !== 'undefined' && window.location
			? window.location.href
			: FALLBACK_BASE;
	const url = new URL( restRoot, base );

	const trimmed = path.replace( /^\/+/, '' );
	const queryAt = trimmed.indexOf( '?' );
	const route = queryAt === -1 ? trimmed : trimmed.slice( 0, queryAt );
	const extraQuery = queryAt === -1 ? '' : trimmed.slice( queryAt + 1 );

	if ( url.searchParams.has( 'rest_route' ) ) {
		const existing = url.searchParams.get( 'rest_route' ) ?? '/';
		const prefix = existing.endsWith( '/' ) ? existing : existing + '/';
		url.searchParams.set( 'rest_route', prefix + route );
	} else {
		const pathname = url.pathname.endsWith( '/' )
			? url.pathname
			: url.pathname + '/';
		url.pathname = pathname + route;
	}

	if ( extraQuery ) {
		const extras = new URLSearchParams( extraQuery );
		extras.forEach( ( value, key ) => {
			url.searchParams.append( key, value );
		} );
	}

	return url.toString();
}
