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
