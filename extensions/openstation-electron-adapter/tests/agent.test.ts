/**
 * The local agent.
 *
 * This is a real HTTP server on the user's machine, which is a phrase
 * that should make anyone nervous — so most of what follows is about
 * the ways it must refuse. The happy path is four assertions; the gates
 * are the rest.
 *
 * The server is started for real on loopback rather than mocked: the
 * interesting behaviour is CORS preflight, header handling and status
 * codes, none of which a fake `http` module would reproduce faithfully.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { LocalAgent } from '../app/src/lib/agent';

const TOKEN = 'a'.repeat( 64 );
const ORIGIN = 'https://example.test';

let agent: LocalAgent;
let base: string;
let freed: string[];
let free: ReturnType< typeof vi.fn >;
let dock: ReturnType< typeof vi.fn >;
let focus: ReturnType< typeof vi.fn >;
let onActivity: ReturnType< typeof vi.fn >;
let allowedOrigin: string;

beforeEach( async () => {
	freed = [];
	allowedOrigin = ORIGIN;
	free = vi.fn( ( req: { windowId?: string } ) => {
		freed.push( String( req.windowId ) );
		return { ok: true, windowId: String( req.windowId ), reused: false };
	} );
	dock = vi.fn( ( id: string ) => {
		const i = freed.indexOf( id );
		if ( i < 0 ) {
			return false;
		}
		freed.splice( i, 1 );
		return true;
	} );
	focus = vi.fn( ( id: string ) => freed.includes( id ) );
	onActivity = vi.fn();

	agent = new LocalAgent( {
		token: TOKEN,
		allowedOrigin: () => allowedOrigin,
		free: free as never,
		dock: dock as never,
		focus: focus as never,
		list: () => [ ...freed ],
		describe: () => ( { app: 'OpenStation Desktop', osLabel: 'Mac' } ),
		onActivity: onActivity as never,
	} );

	const port = await agent.start();
	expect( port ).toBeGreaterThan( 0 );
	base = agent.url;
} );

afterEach( () => agent.stop() );

/**
 * @param path Route.
 * @param init Fetch options.
 */
function call( path: string, init: RequestInit = {} ) {
	return fetch( `${ base }${ path }`, {
		...init,
		headers: {
			Origin: ORIGIN,
			Authorization: `Bearer ${ TOKEN }`,
			'Content-Type': 'application/json',
			...( init.headers as Record< string, string > ),
		},
	} );
}

describe( 'binding', () => {
	test( 'listens on loopback only', () => {
		// Nothing off the machine can reach it — the first of the four
		// gates, and the one that makes the rest a defence in depth
		// rather than the only defence.
		expect( agent.url ).toMatch( /^http:\/\/127\.0\.0\.1:\d+$/ );
	} );

	test( 'starting twice keeps the same port', async () => {
		expect( await agent.start() ).toBe( agent.port );
	} );

	test( 'stop releases the port', () => {
		agent.stop();
		expect( agent.url ).toBe( '' );
		expect( agent.port ).toBe( 0 );
	} );
} );

describe( 'the happy path', () => {
	test( 'ping describes the host and what is open', async () => {
		const res = await call( '/ping' );
		const body = await res.json();

		expect( res.status ).toBe( 200 );
		expect( body ).toMatchObject( { ok: true, app: 'OpenStation Desktop', osLabel: 'Mac' } );
		expect( body.freedWindows ).toEqual( [] );
	} );

	test( 'free opens a window and windows reports it', async () => {
		const res = await call( '/free', {
			method: 'POST',
			body: JSON.stringify( {
				windowId: 'edit-php',
				url: 'https://example.test/wp-admin/edit.php',
			} ),
		} );

		expect( await res.json() ).toMatchObject( { ok: true, windowId: 'edit-php' } );
		expect( free ).toHaveBeenCalled();

		const list = await ( await call( '/windows' ) ).json();
		expect( list.windowIds ).toEqual( [ 'edit-php' ] );
	} );

	test( 'dock and focus reach the registry', async () => {
		await call( '/free', {
			method: 'POST',
			body: JSON.stringify( { windowId: 'edit-php', url: 'https://example.test/x' } ),
		} );

		expect( await ( await call( '/focus', {
			method: 'POST',
			body: JSON.stringify( { windowId: 'edit-php' } ),
		} ) ).json() ).toEqual( { ok: true } );

		expect( await ( await call( '/dock', {
			method: 'POST',
			body: JSON.stringify( { windowId: 'edit-php' } ),
		} ) ).json() ).toEqual( { ok: true } );

		expect( ( await ( await call( '/windows' ) ).json() ).windowIds ).toEqual( [] );
	} );

	test( 'a browser request counts as user activity', async () => {
		await call( '/ping' );
		expect( onActivity ).toHaveBeenCalled();
	} );
} );

describe( 'the gates', () => {
	test( 'refuses a request with no token', async () => {
		const res = await fetch( `${ base }/ping`, { headers: { Origin: ORIGIN } } );
		expect( res.status ).toBe( 401 );
	} );

	test( 'refuses a wrong token', async () => {
		const res = await call( '/ping', {
			headers: { Authorization: 'Bearer ' + 'b'.repeat( 64 ) },
		} );
		expect( res.status ).toBe( 401 );
	} );

	test( 'refuses a token that is only a prefix of the real one', async () => {
		// The origin gate in front of this is a header, and a header is
		// something any program on the machine can simply write — so the
		// token is the real gate here, and it is compared in constant
		// time. A near-miss must be as uninformative as a wild guess: no
		// "warmer", nothing to walk a byte at a time.
		for ( const guess of [
			'Bearer ',
			`Bearer ${ TOKEN.slice( 0, 1 ) }`,
			`Bearer ${ TOKEN.slice( 0, TOKEN.length - 1 ) }`,
			`Bearer ${ TOKEN }x`,
			TOKEN,
		] ) {
			const res = await call( '/ping', {
				headers: { Authorization: guess },
			} );
			expect( res.status ).toBe( 401 );
		}
	} );

	test( 'refuses everything when the app has no token to check against', async () => {
		// An empty configured token must not collapse into "an empty
		// header matches" — a constant-time compare that accepts two
		// zero-length buffers would do exactly that.
		const open = new LocalAgent( {
			token: '',
			allowedOrigin: () => ORIGIN,
			free: () => ( { ok: true, windowId: 'x', reused: false } ),
			dock: () => true,
			focus: () => true,
			list: () => [],
			describe: () => ( {} ),
		} );
		const port = await open.start();
		const res = await fetch( `http://127.0.0.1:${ port }/ping`, {
			headers: { Origin: ORIGIN, Authorization: 'Bearer ' },
		} );
		open.stop();
		expect( res.status ).toBe( 401 );
	} );

	test( 'refuses another origin even with the right token', async () => {
		// The token could leak; the origin check is what keeps a leak
		// from being usable from a hostile page.
		const res = await fetch( `${ base }/ping`, {
			headers: { Origin: 'https://evil.test', Authorization: `Bearer ${ TOKEN }` },
		} );
		expect( res.status ).toBe( 403 );
	} );

	test( 'refuses a request with no origin at all', async () => {
		// curl, or another program on the machine. Not what this
		// interface is for.
		const res = await fetch( `${ base }/ping`, {
			headers: { Authorization: `Bearer ${ TOKEN }` },
		} );
		expect( res.status ).toBe( 403 );
	} );

	test( 'refuses everything when no site is paired', async () => {
		allowedOrigin = '';
		const res = await call( '/ping' );
		expect( res.status ).toBe( 403 );
	} );

	test( 'never acts on a refused request', async () => {
		await fetch( `${ base }/free`, {
			method: 'POST',
			headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' },
			body: JSON.stringify( { windowId: 'x', url: 'https://example.test/x' } ),
		} );
		expect( free ).not.toHaveBeenCalled();
	} );
} );

describe( 'CORS preflight', () => {
	test( 'grants the paired origin, including private-network access', async () => {
		const res = await fetch( `${ base }/free`, {
			method: 'OPTIONS',
			headers: {
				Origin: ORIGIN,
				'Access-Control-Request-Method': 'POST',
				'Access-Control-Request-Headers': 'authorization,content-type',
			},
		} );

		expect( res.status ).toBe( 204 );
		expect( res.headers.get( 'access-control-allow-origin' ) ).toBe( ORIGIN );
		expect( res.headers.get( 'access-control-allow-headers' ) ).toContain( 'authorization' );
		// Chromium refuses a public page → loopback request without
		// this, before the real request is ever sent.
		expect( res.headers.get( 'access-control-allow-private-network' ) ).toBe( 'true' );
	} );

	test( 'refuses any other origin at the preflight', async () => {
		const res = await fetch( `${ base }/free`, {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://evil.test',
				'Access-Control-Request-Method': 'POST',
			},
		} );

		expect( res.status ).toBe( 403 );
		expect( res.headers.get( 'access-control-allow-origin' ) ).toBeNull();
	} );
} );

describe( 'bad input', () => {
	test( 'rejects malformed JSON without falling over', async () => {
		const res = await call( '/free', { method: 'POST', body: '{ not json' } );
		expect( res.status ).toBe( 400 );
		expect( free ).not.toHaveBeenCalled();
	} );

	test( 'measures the body limit in bytes, not UTF-16 code units', async () => {
		// A 4-byte emoji is 2 code units, so counting `String.length`
		// let a body up to three times the documented 64 KB through.
		// Astral characters are the honest test of which is being
		// counted. Deliberately just over the limit in bytes and
		// comfortably under it in code units.
		const emoji = '\u{1F600}'; // 4 bytes, 2 code units.
		const payload = JSON.stringify( { windowId: emoji.repeat( 17_000 ) } );

		const res = await call( '/free', {
			method: 'POST',
			body: payload,
		} );

		expect( res.status ).toBe( 413 );
		expect( free ).not.toHaveBeenCalled();
	} );

	test( 'an over-large body refuses once and stays up', async () => {
		// The refusal destroys the request, which used to be followed by
		// a write onto the torn-down socket. If that regresses the
		// server takes an unhandled stream error; the next call is the
		// assertion that it did not.
		await call( '/free', {
			method: 'POST',
			body: JSON.stringify( { windowId: 'x'.repeat( 200_000 ) } ),
		} ).catch( () => undefined );

		const after = await call( '/ping' );
		expect( after.status ).toBe( 200 );
	} );

	test( 'rejects an unknown route', async () => {
		const res = await call( '/wat', { method: 'POST', body: '{}' } );
		expect( res.status ).toBe( 404 );
	} );

	test( 'rejects an unsupported method', async () => {
		const res = await call( '/ping', { method: 'DELETE' } );
		expect( res.status ).toBe( 405 );
	} );

	test( 'answers are never cached', async () => {
		const res = await call( '/ping' );
		expect( res.headers.get( 'cache-control' ) ).toBe( 'no-store' );
	} );
} );
