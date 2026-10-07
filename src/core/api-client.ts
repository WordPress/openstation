import { trackedFetch, type TrackedFetchOpts } from '../tracked-fetch';

export interface RestClientOptions {

	baseUrl: string;

	nonce?: string;

	headers?: Record< string, string >;

	source?: string;

	silent?: boolean;
}

export interface RequestOptions extends TrackedFetchOpts {

	recover?: ( errorBody: unknown, response: Response ) => unknown;
}

export class RestError extends Error {
	public readonly status: number;
	public readonly code?: string;
	public readonly data?: unknown;

	public readonly serverMessage: string;

	constructor(
		message: string,
		opts: { status: number; code?: string; data?: unknown; serverMessage?: string },
	) {
		super( message || opts.serverMessage || `HTTP ${ opts.status }` );
		this.name = 'RestError';
		this.status = opts.status;
		this.code = opts.code;
		this.data = opts.data;
		this.serverMessage = opts.serverMessage ?? '';
	}
}

export function isRestError( err: unknown ): err is RestError {
	return err instanceof RestError;
}

function wpErrorFields( body: unknown ): { code?: string; data?: unknown; serverMessage: string } {
	const wp =
		typeof body === 'object' && body !== null
			? ( body as { code?: unknown; message?: unknown; data?: unknown } )
			: undefined;
	return {
		code: typeof wp?.code === 'string' ? wp.code : undefined,
		data: wp?.data,
		serverMessage: typeof wp?.message === 'string' ? wp.message : '',
	};
}

export function restErrorFromBody( status: number, body: unknown, message = '' ): RestError {
	return new RestError( message, { status, ...wpErrorFields( body ) } );
}

export async function restErrorFromResponse( response: Response, message = '' ): Promise< RestError > {
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	return restErrorFromBody( response.status, body, message );
}

export function unreadableReplyError( status: number, message: string ): RestError {
	return new RestError( message, { status, code: 'openstation_bad_response' } );
}

export interface FeatureClientOptions {

	prefix: string;

	source: string;

	url: ( path: string ) => string;

	nonce: () => string;

	conflict?: ( body: unknown ) => Error | null;
}

export type FeatureCall = < T >( path: string, init?: RequestInit ) => Promise< T >;

export function createFeatureClient( options: FeatureClientOptions ): FeatureCall {
	const { prefix, source, conflict } = options;
	return async < T >( path: string, init: RequestInit = {} ): Promise< T > => {
		const headers = new Headers( init.headers ?? {} );
		headers.set( 'X-WP-Nonce', options.nonce() );
		if ( init.body && ! headers.has( 'Content-Type' ) ) {
			headers.set( 'Content-Type', 'application/json' );
		}
		const res = await trackedFetch(
			options.url( path ),
			{ ...init, headers, credentials: 'same-origin' },
			{ source },
		);
		const text = await res.text();
		let body: unknown = null;
		let parseError: Error | null = null;
		if ( text ) {
			try {
				body = JSON.parse( text );
			} catch ( e ) {
				parseError = e as Error;
			}
		}
		if ( ! res.ok ) {
			if ( res.status === 409 && conflict ) {
				const typed = conflict( body );
				if ( typed ) {
					throw typed;
				}
			}
			const { code, serverMessage } = wpErrorFields( body );
			throw restErrorFromBody(
				res.status,
				body,
				`${ prefix } ${ res.status }: ${ code ?? '' } ${ serverMessage }`.trim(),
			);
		}
		if ( null === body ) {
			if ( parseError && text ) {
				const head = text.slice( 0, 120 ).replace( /\s+/g, ' ' );
				throw unreadableReplyError(
					res.status,
					`${ prefix } ${ res.status } returned non-JSON body — ${ parseError.message }. First 120 chars: ${ head }`,
				);
			}
			throw unreadableReplyError( res.status, `${ prefix } ${ res.status }: empty or unparseable body.` );
		}
		return body as T;
	};
}

export interface RestClient {
	request< T = unknown >(
		path: string,
		init?: RequestInit,
		opts?: RequestOptions,
	): Promise< T >;
	get< T = unknown >( path: string, opts?: RequestOptions ): Promise< T >;
	post< T = unknown >( path: string, body?: unknown, opts?: RequestOptions ): Promise< T >;
	put< T = unknown >( path: string, body?: unknown, opts?: RequestOptions ): Promise< T >;
	delete< T = unknown >( path: string, opts?: RequestOptions ): Promise< T >;
}

export function createRestClient( opts: RestClientOptions ): RestClient {
	const baseUrl = opts.baseUrl;
	const baseHeaders = opts.headers ?? {};
	const baseSource = opts.source;
	const baseSilent = opts.silent;
	const nonce = opts.nonce;

	function buildUrl( path: string ): string {
		if ( /^https?:\/\//i.test( path ) ) {
			return path;
		}

		if ( path.startsWith( '/' ) && baseUrl.endsWith( '/' ) ) {
			return baseUrl + path.slice( 1 );
		}
		if ( ! path.startsWith( '/' ) && ! baseUrl.endsWith( '/' ) ) {
			return baseUrl + '/' + path;
		}
		return baseUrl + path;
	}

	async function request< T >(
		path: string,
		init: RequestInit = {},
		reqOpts: RequestOptions = {},
	): Promise< T > {
		const headers: Record< string, string > = { ...baseHeaders };
		if ( nonce ) {
			headers[ 'X-WP-Nonce' ] = nonce;
		}

		if ( init.body !== undefined && init.body !== null ) {
			headers[ 'Content-Type' ] = 'application/json';
		}
		Object.assign( headers, ( init.headers as Record< string, string > | undefined ) ?? {} );

		const fetchOpts: TrackedFetchOpts = {
			source: reqOpts.source ?? baseSource,
			windowId: reqOpts.windowId,
		};
		if ( reqOpts.silent !== undefined ) {
			fetchOpts.silent = reqOpts.silent;
		} else if ( baseSilent !== undefined ) {
			fetchOpts.silent = baseSilent;
		}

		const response = await trackedFetch(
			buildUrl( path ),
			{ ...init, headers },
			fetchOpts,
		);

		const text = await response.text();
		let parsed: unknown;
		if ( text !== '' ) {
			try {
				parsed = JSON.parse( text );
			} catch {
				parsed = text;
			}
		}

		if ( ! response.ok ) {
			if ( reqOpts.recover ) {
				return reqOpts.recover( parsed, response ) as T;
			}
			throw restErrorFromBody( response.status, parsed );
		}

		return parsed as T;
	}

	return {
		request,
		get( path, reqOpts ) {
			return request( path, { method: 'GET' }, reqOpts );
		},
		post( path, body, reqOpts ) {
			return request(
				path,
				{ method: 'POST', body: body === undefined ? undefined : JSON.stringify( body ) },
				reqOpts,
			);
		},
		put( path, body, reqOpts ) {
			return request(
				path,
				{ method: 'PUT', body: body === undefined ? undefined : JSON.stringify( body ) },
				reqOpts,
			);
		},
		delete( path, reqOpts ) {
			return request( path, { method: 'DELETE' }, reqOpts );
		},
	};
}
