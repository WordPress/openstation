import type { AppConfig, DispatchResponse, RuntimeHost } from './types';

export const PREWARM_TTL_MS = 30_000;

interface Warmed {
	promise: Promise< DispatchResponse | null >;
	at: number;
}

const warmed = new Map< string, Warmed >();

export function startPrewarm( config: AppConfig, hostFetch: RuntimeHost[ 'fetch' ] ): boolean {
	const held = warmed.get( config.id );
	if ( held && Date.now() - held.at < PREWARM_TTL_MS ) {
		return false;
	}
	const headers: Record< string, string > = {
		Accept: 'application/json',
		'Content-Type': 'application/json',
	};
	if ( config.restNonce ) {
		headers[ 'X-WP-Nonce' ] = config.restNonce;
	}

	const promise = hostFetch(
		config.endpoint,
		{
			method: 'POST',
			headers,
			body: JSON.stringify( {
				action: 'mount',
				view: 'main',
				state: { ...config.state },
				args: {},
				params: {},
				client: { width: 0, height: 0 },
			} ),
		},
		{ source: `openstation/app/${ config.id }/prewarm`, silent: true },
	)
		.then( async ( response ) => {
			if ( ! response.ok ) {
				return null;
			}
			const payload = ( await response.json() ) as DispatchResponse | null;
			return payload && payload.ok === true ? payload : null;
		} )
		.catch( () => null );
	warmed.set( config.id, { promise, at: Date.now() } );
	return true;
}

export function takePrewarm( id: string ): Promise< DispatchResponse | null > | undefined {
	const held = warmed.get( id );
	if ( ! held ) {
		return undefined;
	}
	warmed.delete( id );
	return Date.now() - held.at < PREWARM_TTL_MS ? held.promise : undefined;
}

export function hasPrewarm( id: string ): boolean {
	const held = warmed.get( id );
	return !! held && Date.now() - held.at < PREWARM_TTL_MS;
}

export function __resetPrewarmForTests(): void {
	warmed.clear();
}
