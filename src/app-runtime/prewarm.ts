import type { AppConfig, DispatchResponse, RuntimeHost } from './types';

export const PREWARM_TTL_MS = 30_000;

interface Warmed {
	promise: Promise< DispatchResponse | null >;
	at: number;
}

const warmed = new Map< string, Warmed >();

export type PrewarmParams = Record< string, string | number | boolean >;

function keyOf( id: string, params: PrewarmParams = {} ): string {
	const sorted = Object.keys( params ).sort().map( ( k ) => [ k, params[ k ] ] );
	return `${ id }\n${ JSON.stringify( sorted ) }`;
}

export function startPrewarm( config: AppConfig, hostFetch: RuntimeHost[ 'fetch' ], params: PrewarmParams = {} ): boolean {
	const key = keyOf( config.id, params );
	const held = warmed.get( key );
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
				params: { ...params },
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
	warmed.set( key, { promise, at: Date.now() } );
	return true;
}

export function takePrewarm( id: string, params: PrewarmParams = {} ): Promise< DispatchResponse | null > | undefined {
	const key = keyOf( id, params );
	const held = warmed.get( key );
	if ( ! held ) {
		return undefined;
	}
	warmed.delete( key );
	return Date.now() - held.at < PREWARM_TTL_MS ? held.promise : undefined;
}

export function hasPrewarm( id: string, params: PrewarmParams = {} ): boolean {
	const held = warmed.get( keyOf( id, params ) );
	return !! held && Date.now() - held.at < PREWARM_TTL_MS;
}

export function __resetPrewarmForTests(): void {
	warmed.clear();
}
