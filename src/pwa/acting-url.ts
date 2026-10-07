export const ACTING_QUERY_KEYS = [
	'action',
	'action2',
	'_wpnonce',
	'nonce',
	'delete_all',
] as const;

export function actsOnLoad( pathname: string ): boolean {
	const file = pathname.slice( pathname.lastIndexOf( '/' ) + 1 );
	return /-new\.php$/.test( file );
}

export function urlActs( url: URL ): boolean {
	if ( actsOnLoad( url.pathname ) ) {
		return true;
	}
	for ( const key of ACTING_QUERY_KEYS ) {
		if ( url.searchParams.has( key ) ) {
			return true;
		}
	}
	return false;
}
