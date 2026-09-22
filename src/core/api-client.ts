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

/**
 * A failed request, with the WP-style fields preserved when present.
 *
 * Every feature client throws this (or a subclass) so one helper,
 * `describeRestFailure()` in `./rest-failure`, can say WHY in the UI.
 * `message` is whatever the thrower wants the console to show, or `''`
 * for the server's words else the status; the human part the server
 * sent lives in `serverMessage`, so a caller never has to parse the
 * console line to recover it. A 2xx whose body was not the JSON the
 * route promised is thrown through `unreadableReplyError()`: that 2xx
 * status with an empty `serverMessage` is what says "unreadable".
 */
export class RestError extends Error {
	public readonly status: number;
	public readonly code?: string;
	public readonly data?: unknown;
	/** The `WP_Error` message from the body, verbatim, or `''`. */
	public readonly serverMessage: string;

	constructor(
		message: string,
		opts: { status: number; code?: string; data?: unknown; serverMessage?: string },
	) {
		// An empty message means "the server's words, else the status".
		super( message || opts.serverMessage || String( opts.status ) );
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

/**
 * A failed `Response` as a `RestError`, for callers that use
 * `trackedFetch` directly rather than a client. Reads the body once
 * for the WP-style fields; a non-JSON body leaves `serverMessage`
 * empty and the status as the message.
 */
export async function restErrorFromResponse( response: Response ): Promise< RestError > {
	let body: { code?: unknown; message?: unknown; data?: unknown } | null = null;
	try {
		body = ( await response.json() ) as { code?: unknown; message?: unknown; data?: unknown };
	} catch {
		body = null;
	}
	return new RestError( '', {
		status: response.status,
		code: typeof body?.code === 'string' ? body.code : undefined,
		data: body?.data,
		serverMessage: typeof body?.message === 'string' ? body.message : '',
	} );
}

/**
 * A 2xx whose body was not the JSON the route promised. The 2xx status
 * with an empty `serverMessage` is what tells the UI helper
 * "unreadable"; `message` is the client's own console line, with as
 * much diagnostic as it has.
 */
export function unreadableReplyError( status: number, message: string ): RestError {
	return new RestError( message, { status, code: 'openstation_bad_response' } );
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
			throw new RestError( '', {
				status: response.status,
				code: typeof wpErr?.code === 'string' ? wpErr.code : undefined,
				data: wpErr?.data,
				serverMessage: typeof wpErr?.message === 'string' ? wpErr.message : '',
			} );
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
