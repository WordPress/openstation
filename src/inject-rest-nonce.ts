const NONCE_HEADER = 'X-WP-Nonce';

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
		openStationConfig?: { restNonce?: unknown };
	} ).openStationConfig;
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
