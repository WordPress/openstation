const gravatarCache = new Map<
	string,
	string | null | Promise< string | null >
>();

export async function resolveAvatarUrl(
	raw: string,
): Promise< string | null > {
	if ( ! raw ) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = new URL( raw, window.location.href );
	} catch {
		return raw;
	}
	if ( ! /gravatar\.com$/i.test( parsed.hostname ) ) {
		return raw;
	}

	parsed.searchParams.delete( 'd' );
	parsed.searchParams.delete( 's' );
	const cacheKey = parsed.toString();

	const cached = gravatarCache.get( cacheKey );
	if ( cached !== undefined ) {
		return cached instanceof Promise ? cached : cached;
	}

	const probeUrl = new URL( raw, window.location.href );
	probeUrl.searchParams.set( 'd', 'blank' );
	const probe = new Promise< string | null >( ( resolve ) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			try {
				const canvas = document.createElement( 'canvas' );
				canvas.width = 1;
				canvas.height = 1;

				const ctx = canvas.getContext( '2d', { willReadFrequently: true } );
				if ( ! ctx ) {
					resolve( raw );
					return;
				}
				ctx.drawImage( img, 0, 0, 1, 1 );
				const pixel = ctx.getImageData( 0, 0, 1, 1 ).data;
				resolve( pixel[ 3 ] === 0 ? null : raw );
			} catch {
				resolve( raw );
			}
		};
		img.onerror = () => resolve( null );
		img.src = probeUrl.toString();
	} ).then( ( next ) => {
		gravatarCache.set( cacheKey, next );
		return next;
	} );
	gravatarCache.set( cacheKey, probe );
	return probe;
}

export function pickAvatarUrl( urls: Record< string, string > | undefined | null ): string {
	return urls?.[ '48' ] ?? urls?.[ '96' ] ?? urls?.[ '24' ] ?? '';
}

export function applyAvatarSrc( avatar: HTMLElement, raw: string ): void {
	if ( ! raw ) {
		return;
	}
	void resolveAvatarUrl( raw ).then( ( url ) => {
		if ( ! avatar.isConnected ) {
			return;
		}
		if ( url ) {
			avatar.setAttribute( 'src', url );
		} else {
			avatar.removeAttribute( 'src' );
		}
	} );
}

export function _resetAvatarResolveCache(): void {
	gravatarCache.clear();
}
