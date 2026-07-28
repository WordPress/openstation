/**
 * Generic REST client built on top of `trackedFetch`.
 *
 * **Why this exists.** Four feature folders (`posts-window`,
 * `my-wordpress`, `recycle-bin`, `desktop-files`) each ship their
 * own ~60-line `rest.ts` wrapping `trackedFetch` with: nonce
 * injection, JSON parsing, WP error → Error normalization, and
 * occasional `term_exists`-style recovery. The implementations are
 * 90% identical and 10% domain-specific.
 *
 * **What this provides.** A `createRestClient()` factory that
 * returns a typed `request< T >()` plus shorthand `get`/`post`/
 * `put`/`delete` methods. Domain-specific recoveries are layered
 * on top via the `recover` option (a callback that decides whether
 * a non-OK response should be re-thrown or swallowed into a value).
 *
 * **What this does NOT do.** It does not pretend to be a full HTTP
 * library. No automatic retries, no request cancellation, no
 * response caching. Those are feature concerns; if you need them,
 * wrap a returned client.
 */

import { trackedFetch, type TrackedFetchOpts } from '../tracked-fetch';

export interface RestClientOptions {
	/** Base URL — endpoints passed to `request` are appended verbatim, so include a trailing `/` if you want it. */
	baseUrl: string;
	/** REST nonce sent as `X-WP-Nonce` on every request. */
	nonce?: string;
	/** Static headers merged into every request. Per-request `init.headers` win on conflict. */
	headers?: Record< string, string >;
	/** Default activity-bus tag. Per-request `opts.source` wins. */
	source?: string;
	/** Default `silent`. Per-request `opts.silent` wins. */
	silent?: boolean;
}

export interface RequestOptions extends TrackedFetchOpts {
	/**
	 * Optional override for the failure path. Receives the parsed
	 * error body (if JSON) and the raw `Response`. Return a value
	 * to swallow; throw or rethrow to propagate. Useful for
	 * `term_exists`-style "non-fatal conflict" handling that
	 * only the calling feature understands.
	 */
	recover?: ( errorBody: unknown, response: Response ) => unknown;
}

/** A normalized REST error with the WP-style fields preserved when present. */
export class RestError extends Error {
	public readonly status: number;
	public readonly code?: string;
	public readonly data?: unknown;

	constructor(
		message: string,
		opts: { status: number; code?: string; data?: unknown },
	) {
		super( message );
		this.name = 'RestError';
		this.status = opts.status;
		this.code = opts.code;
		this.data = opts.data;
	}
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
		// Avoid double slashes; preserve callers that include their own.
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
		// Default content-type for body requests; per-call init wins.
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
			const wpErr =
				typeof parsed === 'object' && parsed !== null
					? ( parsed as { message?: unknown; code?: unknown; data?: unknown } )
					: undefined;
			throw new RestError(
				typeof wpErr?.message === 'string'
					? wpErr.message
					: `${ response.status } ${ response.statusText }`,
				{
					status: response.status,
					code: typeof wpErr?.code === 'string' ? wpErr.code : undefined,
					data: wpErr?.data,
				},
			);
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
