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

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { FreeWindowRequest, FreeWindowResult } from './protocol';

/** Largest body the agent will read, in bytes. */
const MAX_BODY = 64 * 1024;

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
		if ( auth !== `Bearer ${ this.deps.token }` ) {
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
				this.json( res, 400, {
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
			let raw = '';
			req.on( 'data', ( chunk ) => {
				raw += chunk;
				if ( raw.length > MAX_BODY ) {
					reject( new Error( 'body too large' ) );
					req.destroy();
				}
			} );
			req.on( 'end', () => {
				if ( ! raw ) {
					resolve( {} );
					return;
				}
				try {
					resolve( JSON.parse( raw ) );
				} catch {
					reject( new Error( 'invalid JSON' ) );
				}
			} );
			req.on( 'error', reject );
		} );
	}

	/**
	 * @param res    Response.
	 * @param status HTTP status.
	 * @param body   JSON payload.
	 */
	private json( res: ServerResponse, status: number, body: unknown ): void {
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
