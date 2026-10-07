import { trackedFetch } from '../tracked-fetch';

export function wantsBrowserTab( event?: MouseEvent ): boolean {
	return (
		!! event &&
		( event.metaKey || event.ctrlKey || event.shiftKey || 1 === event.button )
	);
}

export function hopToAdmin( url: string, event?: MouseEvent ): void {
	if ( wantsBrowserTab( event ) ) {
		window.open( url, '_blank', 'noopener,noreferrer' );
		return;
	}
	window.location.assign( url );
}

export interface HopMinter {
	( target: string, direction: 'next' | 'prev' ): Promise< string | null >;
}

export function createHopMinter( deps: {
	hopUrl: string;
	restNonce: string;
} ): HopMinter {
	return async ( target, direction ) => {
		try {
			const response = await trackedFetch(
				deps.hopUrl,
				{
					method: 'POST',
					credentials: 'same-origin',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': deps.restNonce,
					},
					body: JSON.stringify( { target, direction } ),
				},
				{ source: 'desktop-mode/network-hop' },
			);
			if ( ! response.ok ) {
				return null;
			}
			const data = ( await response.json() ) as { url?: unknown };
			return typeof data.url === 'string' && data.url !== '' ? data.url : null;
		} catch {
			return null;
		}
	};
}
