import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { FreeWindowRequest, FreeWindowResult } from './protocol';

const MAX_BODY = 64 * 1024;

class BodyTooLargeError extends Error {
	public readonly bodyTooLarge = true;
}

function secretEquals( a: string, b: string ): boolean {
	const left = Buffer.from( String( a || '' ), 'utf8' );
	const right = Buffer.from( String( b || '' ), 'utf8' );
	if ( 0 === left.length || left.length !== right.length ) {
		return false;
	}
	return timingSafeEqual( left, right );
}

export interface AgentDeps {

	token: string;

	allowedOrigin: () => string;

	free: ( req: Partial< FreeWindowRequest > ) => FreeWindowResult;

	dock: ( windowId: string ) => boolean;

	focus: ( windowId: string ) => boolean;

	list: () => string[];

	describe: () => Record< string, unknown >;

	onActivity?: () => void;
}

export class LocalAgent {
	private server: Server | null = null;
	private boundPort = 0;

	constructor( private readonly deps: AgentDeps ) {}

	get port(): number {
		return this.boundPort;
	}

	get url(): string {
		return this.boundPort ? `http://127.0.0.1:${ this.boundPort }` : '';
	}

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

	stop(): void {
		this.server?.close();
		this.server = null;
		this.boundPort = 0;
	}

	private handle( req: IncomingMessage, res: ServerResponse ): void {
		const origin = String( req.headers.origin || '' );
		const allowed = this.deps.allowedOrigin();
		const originOk = !! allowed && origin === allowed;

		if ( originOk ) {
			res.setHeader( 'Access-Control-Allow-Origin', allowed );
			res.setHeader( 'Vary', 'Origin' );
			res.setHeader( 'Access-Control-Allow-Headers', 'authorization, content-type' );
			res.setHeader( 'Access-Control-Allow-Methods', 'GET, POST, OPTIONS' );

			res.setHeader( 'Access-Control-Allow-Private-Network', 'true' );
			res.setHeader( 'Access-Control-Max-Age', '600' );
		}

		if ( 'OPTIONS' === req.method ) {

			res.writeHead( originOk ? 204 : 403 );
			res.end();
			return;
		}

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

					res.once( 'finish', () => req.destroy() );
				}
				this.json( res, tooLarge ? 413 : 400, {
					error: err instanceof Error ? err.message : 'bad request',
				} );
			} );
	}

	private readBody( req: IncomingMessage ): Promise< unknown > {
		return new Promise( ( resolve, reject ) => {

			const chunks: Buffer[] = [];
			let size = 0;
			let done = false;

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

	private json( res: ServerResponse, status: number, body: unknown ): void {

		if ( res.writableEnded || res.destroyed ) {
			return;
		}
		const payload = JSON.stringify( body );
		res.writeHead( status, {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Length': Buffer.byteLength( payload ),

			'Cache-Control': 'no-store',
		} );
		res.end( payload );
	}
}
