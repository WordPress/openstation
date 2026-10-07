export function normalizeSiteUrl( input: string ): string {
	const raw = String( input || '' ).trim();
	if ( ! raw ) {
		return '';
	}

	const withScheme = /^https?:\/\//i.test( raw ) ? raw : `https://${ raw }`;

	let url: URL;
	try {
		url = new URL( withScheme );
	} catch {
		return '';
	}

	if ( ! url.hostname ) {
		return '';
	}

	const path = url.pathname
		.replace( /\/(wp-admin|wp-login\.php|openstation|desktop-mode)(\/.*)?$/i, '/' )
		.replace( /\/+$/, '' );

	return url.origin + path;
}

export function shellEntryUrl( siteUrl: string ): string {
	const site = String( siteUrl || '' ).replace( /\/+$/, '' );
	return site ? `${ site }/openstation/` : '';
}

export function isSameSiteUrl( url: string, siteUrl: string ): boolean {
	const site = String( siteUrl || '' ).replace( /\/+$/, '' );
	if ( ! site ) {
		return false;
	}
	let target: URL;
	let base: URL;
	try {
		target = new URL( String( url || '' ) );
		base = new URL( site );
	} catch {
		return false;
	}
	if ( ! /^https?:$/.test( target.protocol ) ) {
		return false;
	}
	return target.host === base.host && target.protocol === base.protocol;
}

export function isLoopbackUrl( url: string ): boolean {
	let target: URL;
	try {
		target = new URL( String( url || '' ) );
	} catch {
		return false;
	}
	const host = target.hostname.toLowerCase();
	return (
		'localhost' === host ||
		'127.0.0.1' === host ||
		'[::1]' === host ||
		'::1' === host ||
		host.endsWith( '.localhost' )
	);
}

export function settledSiteUrl(
	landedUrl: string,
	configuredSite: string,
): string {
	const landed = normalizeSiteUrl( landedUrl );
	const configured = normalizeSiteUrl( configuredSite );
	if ( ! landed || ! configured ) {
		return '';
	}

	let a: URL;
	let b: URL;
	try {
		a = new URL( landed );
		b = new URL( configured );
	} catch {
		return '';
	}

	const from = b.hostname.toLowerCase();
	const to = a.hostname.toLowerCase();
	const related =
		from === to ||
		to.endsWith( `.${ from }` ) ||
		from.endsWith( `.${ to }` );

	return related ? landed : '';
}

export type NavigationVerdict = 'allow' | 'external' | 'block';

export function navigationVerdict(
	url: string,
	siteUrl: string,
): NavigationVerdict {
	if ( isSameSiteUrl( url, siteUrl ) ) {
		return 'allow';
	}
	return /^https?:\/\//i.test( String( url || '' ) ) ? 'external' : 'block';
}
