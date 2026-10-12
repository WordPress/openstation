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

/**
 * The `WP_Error` fields a body carries, when it is one. Anything that
 * is not a WP-shaped object yields no code, no data and an empty
 * message, so a plain-text or HTML body degrades to "the status alone".
 */
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

/**
 * A failed reply as a `RestError`, from a body the caller has already
 * parsed (or `null` when it was not JSON). `message` is the console
 * line; `''` means the server's words, else the status.
 */
export function restErrorFromBody( status: number, body: unknown, message = '' ): RestError {
	return new RestError( message, { status, ...wpErrorFields( body ) } );
}

/**
 * A failed `Response` as a `RestError`, for callers that use
 * `trackedFetch` directly rather than a client. Reads the body once
 * for the WP-style fields; a non-JSON body leaves `serverMessage`
 * empty and the status as the message.
 */
export async function restErrorFromResponse( response: Response, message = '' ): Promise< RestError > {
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	return restErrorFromBody( response.status, body, message );
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

export interface FeatureClientOptions {
	/** The console prefix for every failure line: `[openstation] files REST`. */
	prefix: string;
	/** Activity-bus source tag for the requests. */
	source: string;
	/** The URL to fetch for a path. */
	url: ( path: string ) => string;
	/** The nonce to send now (a live one, if the client refreshes it). */
	nonce: () => string;
	/**
	 * A 409's own error, built from the parsed body, or `null` to treat
	 * the 409 as any other refusal. Conflicts carry a payload the caller
	 * acts on (the server's current row), not a message.
	 */
	conflict?: ( body: unknown ) => Error | null;
}

/** What `createFeatureClient()` returns: one typed call against a feature's routes. */
export type FeatureCall = < T >( path: string, init?: RequestInit ) => Promise< T >;

/**
 * A feature's own REST client: nonce header, JSON body, text-then-JSON
 * parse, a typed conflict on 409, a `RestError` with the feature's
 * console prefix on any other failure, and `unreadableReplyError()`
 * for a 2xx whose body is not JSON. The notes and desktop-files
 * clients are this function with a prefix and a conflict shape each.
 *
 * A 2xx with an empty or unparseable body is something the consumers
 * cannot usefully do anything with: every route these clients call
 * returns a shaped object. Two sources in practice: OpenStation
 * replacing itself live (routes briefly re-register, a redirect to
 * wp-login HTML can sneak through), and a genuinely empty 200 body
 * (usually a server misconfiguration). Returning `null` would crash
 * the consumer with a cryptic property read far from the cause, so the
 * console line carries the parse error and the first 120 characters
 * of the body, usually enough to spot the PHP notice or login form
 * that crept in.
 */
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
