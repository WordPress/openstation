/**
 * OpenStation Desktop — the local agent.
 *
 * A loopback HTTP server that lets **a browser** set windows free onto
 * the real desktop.
 *
 * ## Why this exists
 *
 * Inside the app, the shell reaches the host through an injected
 * preload global. A browser tab has no preload — so without this, "Send
 * to your Mac" worked only in the app, which is backwards: the app is
 * the thing that gives you native windows, and the browser is where
 * most people actually work. The app should be able to serve the
 * browser, not compete with it.
 *
 * So the app also runs as an agent: a tiny server on `127.0.0.1` that
 * the site's own admin page can call. Open OpenStation in Chrome, pick
 * "Send to your Mac", and the app running on your machine opens the
 * window.
 *
 * ## Why it is safe to run a server on your machine
 *
 * Four independent gates, because "localhost HTTP server" is a phrase
 * that should make anyone nervous:
 *
 * 1. **Loopback only.** Bound to `127.0.0.1`, so nothing off the
 *    machine can reach it at all.
 * 2. **A bearer token**, generated once per installation and known
 *    only to the paired site. Requiring an `Authorization` header also
 *    forces a CORS preflight, which means a hostile page cannot even
 *    fire a blind no-cors request at it.
 * 3. **One allowed origin** — the site the user connected the app to.
 *    Every other origin is refused at the preflight.
 * 4. **URLs are re-checked** against that same site before any window
 *    opens (`isAllowedUrl`, in the freed-window registry).
 *
 * The port is ephemeral and travels to the site in the handshake, so
 * there is no well-known port for anything to probe.
 */

import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { FreeWindowRequest, FreeWindowResult } from './protocol';

/** Largest body the agent will read, in bytes. */
const MAX_BODY = 64 * 1024;

/** A body that exceeded {@link MAX_BODY}, answered with `413`. */
class BodyTooLargeError extends Error {
	public readonly bodyTooLarge = true;
}

/**
 * Compare two secrets without letting the clock describe them.
 *
 * `a !== b` stops at the first differing byte, so the time it takes to
 * say no is a measurement of how much of the token the caller already
 * had. The `Origin` gate in front of this is a header, and a header is
 * something any non-browser caller can simply write — so on this
 * machine the token is the only real gate, and a gate that leaks itself
 * one byte at a time is worth closing.
 *
 * Lengths are compared first because `timingSafeEqual` throws on a
 * mismatch; the length of a bearer header is not a secret.
 *
 * @param a First value.
 * @param b Second value.
 * @return True when equal.
 */
function secretEquals( a: string, b: string ): boolean {
	const left = Buffer.from( String( a || '' ), 'utf8' );
	const right = Buffer.from( String( b || '' ), 'utf8' );
	if ( 0 === left.length || left.length !== right.length ) {
		return false;
	}
	return timingSafeEqual( left, right );
}

export interface AgentDeps {
	/** Bearer token the caller must present. */
	token: string;
	/** The site this app is paired with, e.g. `https://example.com`. */
	allowedOrigin: () => string;
	/** Open a window. */
	free: ( req: Partial< FreeWindowRequest > ) => FreeWindowResult;
	/** Close a freed window. */
	dock: ( windowId: string ) => boolean;
	/** Raise a freed window. */
	focus: ( windowId: string ) => boolean;
	/** Ids currently freed. */
	list: () => string[];
	/** Static description for `/ping`. */
	describe: () => Record< string, unknown >;
	/** Called on any request the browser makes, as an activity signal. */
	onActivity?: () => void;
}

export class LocalAgent {
	private server: Server | null = null;
	private boundPort = 0;

	/**
	 * @param deps Injected collaborators.
	 */
	constructor( private readonly deps: AgentDeps ) {}

	/** @return The bound port, or 0 when not listening. */
	get port(): number {
		return this.boundPort;
	}

	/** @return `http://127.0.0.1:<port>`, or '' when not listening. */
	get url(): string {
		return this.boundPort ? `http://127.0.0.1:${ this.boundPort }` : '';
	}

	/**
	 * Start listening on an ephemeral loopback port.
	 *
	 * @return The bound port. Resolves to 0 if the server could not
	 *         start — the app still works, it just cannot serve a
	 *         browser, which is a degradation and not a failure.
	 */
	start(): Promise< number > {
		if ( this.server ) {
			return Promise.resolve( this.boundPort );
		}
		return new Promise( ( resolve ) => {
			const server = createServer( ( req, res ) => this.handle( req, res ) );
			server.on( 'error', ( err ) => {
				console.error( '[openstation-desktop] local agent failed:', err );
				this.server = null;
				this.boundPort = 0;
				resolve( 0 );
			} );
			server.listen( 0, '127.0.0.1', () => {
				const address = server.address();
				this.server = server;
				this.boundPort =
					address && 'object' === typeof address ? address.port : 0;
				resolve( this.boundPort );
			} );
		} );
	}

	/** Stop listening. */
	stop(): void {
		this.server?.close();
		this.server = null;
		this.boundPort = 0;
	}

	/**
	 * @param req Request.
	 * @param res Response.
	 */
	private handle( req: IncomingMessage, res: ServerResponse ): void {
		const origin = String( req.headers.origin || '' );
		const allowed = this.deps.allowedOrigin();
		const originOk = !! allowed && origin === allowed;

		if ( originOk ) {
			res.setHeader( 'Access-Control-Allow-Origin', allowed );
			res.setHeader( 'Vary', 'Origin' );
			res.setHeader( 'Access-Control-Allow-Headers', 'authorization, content-type' );
			res.setHeader( 'Access-Control-Allow-Methods', 'GET, POST, OPTIONS' );
			// Chromium's Private Network Access check: a public-origin
			// page reaching a loopback server must be granted this
			// explicitly, or the preflight fails before the request is
			// ever made.
			res.setHeader( 'Access-Control-Allow-Private-Network', 'true' );
			res.setHeader( 'Access-Control-Max-Age', '600' );
		}

		if ( 'OPTIONS' === req.method ) {
			// A preflight from anywhere else gets no CORS headers, so the
			// browser refuses the real request on the caller's behalf.
			res.writeHead( originOk ? 204 : 403 );
			res.end();
			return;
		}

		// An `Origin`-less request is a non-browser caller (curl, another
		// program). It still needs the token, and it is not what this
		// interface is for, so it is refused outright.
		if ( ! originOk ) {
			this.json( res, 403, { error: 'origin not allowed' } );
			return;
		}

		const auth = String( req.headers.authorization || '' );
		if ( ! secretEquals( auth, `Bearer ${ this.deps.token }` ) ) {
			this.json( res, 401, { error: 'bad token' } );
			return;
		}

		this.deps.onActivity?.();

		const path = ( req.url || '' ).split( '?' )[ 0 ];

		if ( 'GET' === req.method && '/ping' === path ) {
			this.json( res, 200, {
				ok: true,
				...this.deps.describe(),
				freedWindows: this.deps.list(),
			} );
			return;
		}

		if ( 'GET' === req.method && '/windows' === path ) {
			this.json( res, 200, { windowIds: this.deps.list() } );
			return;
		}

		if ( 'POST' !== req.method ) {
			this.json( res, 405, { error: 'method not allowed' } );
			return;
		}

		void this.readBody( req )
			.then( ( body ) => {
				switch ( path ) {
					case '/free':
						this.json( res, 200, this.deps.free( body as Partial< FreeWindowRequest > ) );
						return;
					case '/dock':
						this.json( res, 200, {
							ok: this.deps.dock( String( ( body as { windowId?: string } ).windowId || '' ) ),
						} );
						return;
					case '/focus':
						this.json( res, 200, {
							ok: this.deps.focus( String( ( body as { windowId?: string } ).windowId || '' ) ),
						} );
						return;
					default:
						this.json( res, 404, { error: 'unknown route' } );
				}
			} )
			.catch( ( err ) => {
				const tooLarge = err instanceof BodyTooLargeError;
				if ( tooLarge ) {
					// Read the rest of the body? No — but the answer
					// goes out first, and only then does the socket go.
					res.once( 'finish', () => req.destroy() );
				}
				this.json( res, tooLarge ? 413 : 400, {
					error: err instanceof Error ? err.message : 'bad request',
				} );
			} );
	}

	/**
	 * @param req Request.
	 * @return Parsed JSON body.
	 */
	private readBody( req: IncomingMessage ): Promise< unknown > {
		return new Promise( ( resolve, reject ) => {
			// Chunks are collected as Buffers and measured in bytes.
			// Concatenating into a string measured `.length` in UTF-16
			// code units instead, which counts a 4-byte emoji as 2 —
			// so `MAX_BODY` was up to three times looser than it reads
			// for multi-byte input, and the limit is the whole point.
			const chunks: Buffer[] = [];
			let size = 0;
			let done = false;

			// One settle, one outcome. Destroying the request emits
			// `error` (and sometimes `end`), and the old code answered
			// the caller a second time after already rejecting — and
			// wrote a response onto a socket it had just torn down.
			const settle = ( fn: () => void ) => {
				if ( done ) {
					return;
				}
				done = true;
				fn();
			};

			req.on( 'data', ( chunk: Buffer ) => {
				if ( done ) {
					return;
				}
				chunks.push( chunk );
				size += chunk.length;
				if ( size > MAX_BODY ) {
					// Paused rather than destroyed. Tearing the socket
					// down here raced the refusal onto it, so the caller
					// got a closed connection instead of an answer;
					// `handle()` destroys it once the 413 has flushed.
					settle( () => reject( new BodyTooLargeError( 'body too large' ) ) );
					req.pause();
				}
			} );
			req.on( 'end', () => {
				settle( () => {
					if ( ! size ) {
						resolve( {} );
						return;
					}
					try {
						resolve( JSON.parse( Buffer.concat( chunks ).toString( 'utf8' ) ) );
					} catch {
						reject( new Error( 'invalid JSON' ) );
					}
				} );
			} );
			req.on( 'error', ( err ) => settle( () => reject( err ) ) );
		} );
	}

	/**
	 * @param res    Response.
	 * @param status HTTP status.
	 * @param body   JSON payload.
	 */
	private json( res: ServerResponse, status: number, body: unknown ): void {
		// An over-large body is refused by destroying the request, which
		// takes the socket with it — so by the time the rejection
		// reaches the error handler there is nothing left to answer on.
		// Writing anyway is how a refusal turns into an unhandled
		// `ERR_STREAM_WRITE_AFTER_END`.
		if ( res.writableEnded || res.destroyed ) {
			return;
		}
		const payload = JSON.stringify( body );
		res.writeHead( status, {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Length': Buffer.byteLength( payload ),
			// Nothing here is cacheable and some of it is a capability.
			'Cache-Control': 'no-store',
		} );
		res.end( payload );
	}
}
