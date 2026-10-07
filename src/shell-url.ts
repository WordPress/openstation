export const SHELL_PAGE_SLUG = 'openstation';

export function isShellDocumentUrl( url: URL | string, base?: string ): boolean {
	let parsed: URL;
	if ( typeof url === 'string' ) {
		try {
			parsed = new URL(
				url,
				base ??
					( typeof window !== 'undefined'
						? window.location.href
						: undefined ),
			);
		} catch {
			return false;
		}
	} else {
		parsed = url;
	}
	const file = parsed.pathname.slice( parsed.pathname.lastIndexOf( '/' ) + 1 );
	return file === 'admin.php' && parsed.searchParams.get( 'page' ) === SHELL_PAGE_SLUG;
}

const SHELL_BOOT_ARGS = [
	'target',
	'intent',
	'openstation_overview',
	'openstation_hop',
	'openstation_hop_from',
] as const;

export function shellUrlWithoutBootArgs(
	url: URL | string,
	base?: string,
): string | null {
	let parsed: URL;
	try {
		parsed = new URL(
			typeof url === 'string' ? url : url.href,
			base ??
				( typeof window !== 'undefined'
					? window.location.href
					: undefined ),
		);
	} catch {
		return null;
	}

	if ( ! isShellDocumentUrl( parsed ) ) {
		return null;
	}

	if ( ! SHELL_BOOT_ARGS.some( ( arg ) => parsed.searchParams.has( arg ) ) ) {
		return null;
	}
	SHELL_BOOT_ARGS.forEach( ( arg ) => parsed.searchParams.delete( arg ) );

	return parsed.href;
}
