/**
 * App Framework runtime — the hover-intent prewarm.
 *
 * `wp.os.apps.prewarm( id )` sends a closed app window's first `mount`
 * ahead of the open; the session that opens takes the answer instead
 * of fetching. What these tests pin: the request is the one the
 * session would have sent (silent, declared state, no params), a warm
 * is held once and taken once, it goes stale, a deep link never takes
 * it, and a warm that failed falls through to a real request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREWARM_TTL_MS, __resetPrewarmForTests, hasPrewarm, startPrewarm, takePrewarm } from '../../src/app-runtime/prewarm';
import { createSession } from '../../src/app-runtime/session';
import { defineApp, html } from '../../src/app-runtime/client';
import type { AppConfig, RuntimeHost } from '../../src/app-runtime/types';

interface State extends Record< string, unknown > {
	page: number;
}
interface Data {
	rows: string[];
}

const APP = 'prewarm-demo';

const app = defineApp< State, Data >( APP, {
	placeholder: () => ( { rows: [] } ),
	view: ( { data, loading } ) => html`<p data-loading=${ loading ? 'true' : 'false' }>${ data.rows.join( ',' ) }</p>`,
} );

function config( over: Partial< AppConfig > = {} ): AppConfig {
	return {
		osApp: true,
		id: APP,
		title: 'Prewarm',
		endpoint: '/dispatch',
		restNonce: 'nonce-1',
		state: { page: 2 },
		titleBarButtons: [],
		windowActions: [],
		appearance: {},
		extra: {},
		actions: [],
		client: true,
		...over,
	};
}

function answer( rows: string[], ok = true ): Response {
	return {
		ok,
		status: ok ? 200 : 500,
		json: async () => ( { ok: true, state: { page: 1 }, html: '', data: { rows }, effects: [] } ),
	} as unknown as Response;
}

let root: HTMLElement;
let fetchSpy: ReturnType< typeof vi.fn >;
let host: RuntimeHost;

beforeEach( () => {
	vi.useFakeTimers();
	__resetPrewarmForTests();
	root = document.createElement( 'div' );
	document.body.appendChild( root );
	fetchSpy = vi.fn( async () => answer( [ 'warm' ] ) );
	host = { fetch: fetchSpy as unknown as RuntimeHost[ 'fetch' ] };
} );

afterEach( () => {
	vi.useRealTimers();
	document.body.innerHTML = '';
} );

describe( 'startPrewarm', () => {
	it( 'sends the default first mount — declared state, no params — silently, once per window', () => {
		expect( startPrewarm( config(), host.fetch ) ).toBe( true );
		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
		const [ url, init, opts ] = fetchSpy.mock.calls[ 0 ] as [ string, RequestInit, { source: string; silent: boolean } ];
		expect( url ).toBe( '/dispatch' );
		expect( init.method ).toBe( 'POST' );
		expect( ( init.headers as Record< string, string > )[ 'X-WP-Nonce' ] ).toBe( 'nonce-1' );
		expect( JSON.parse( String( init.body ) ) ).toEqual( {
			action: 'mount',
			view: 'main',
			state: { page: 2 },
			args: {},
			params: {},
			client: { width: 0, height: 0 },
		} );
		expect( opts ).toEqual( { source: `openstation/app/${ APP }/prewarm`, silent: true } );

		// A hover that lingers never costs a second request.
		expect( startPrewarm( config(), host.fetch ) ).toBe( false );
		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
		expect( hasPrewarm( APP ) ).toBe( true );
	} );

	it( 'is taken once, and goes stale after the TTL', async () => {
		startPrewarm( config(), host.fetch );
		const held = takePrewarm( APP );
		expect( held ).toBeDefined();
		await expect( held ).resolves.toMatchObject( { data: { rows: [ 'warm' ] } } );
		expect( takePrewarm( APP ) ).toBeUndefined();
		expect( hasPrewarm( APP ) ).toBe( false );

		startPrewarm( config(), host.fetch );
		vi.advanceTimersByTime( PREWARM_TTL_MS + 1 );
		expect( hasPrewarm( APP ) ).toBe( false );
		expect( takePrewarm( APP ) ).toBeUndefined();
		// …and a new hover warms again.
		expect( startPrewarm( config(), host.fetch ) ).toBe( true );
	} );

	it( 'a failed warm resolves to nothing rather than throwing', async () => {
		fetchSpy.mockResolvedValueOnce( answer( [], false ) );
		startPrewarm( config(), host.fetch );
		await expect( takePrewarm( APP ) ).resolves.toBeNull();

		fetchSpy.mockRejectedValueOnce( new Error( 'offline' ) );
		startPrewarm( config(), host.fetch );
		await expect( takePrewarm( APP ) ).resolves.toBeNull();
	} );
} );

describe( 'a session opening on a warm', () => {
	it( 'takes the warmed answer for its first mount instead of fetching', async () => {
		startPrewarm( config(), host.fetch );
		const session = createSession( { root, config: config(), windowId: APP, host, client: app } );
		session.paintEagerly();
		expect( root.querySelector( 'p' )?.getAttribute( 'data-loading' ) ).toBe( 'true' );

		await expect( session.dispatch( 'mount' ) ).resolves.toBe( true );
		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
		expect( root.querySelector( 'p' )?.textContent ).toBe( 'warm' );
		expect( root.querySelector( 'p' )?.getAttribute( 'data-loading' ) ).toBe( 'false' );
		expect( session.state ).toEqual( { page: 1 } );
		expect( session.data ).toEqual( { rows: [ 'warm' ] } );
		// The next mount of another open fetches: the warm was taken.
		expect( hasPrewarm( APP ) ).toBe( false );
	} );

	it( 'a window opened with params — a deep link — fetches, and leaves the warm alone', async () => {
		startPrewarm( config(), host.fetch );
		fetchSpy.mockResolvedValueOnce( answer( [ 'deep' ] ) );
		const session = createSession( { root, config: config(), windowId: APP, host, params: { userId: 4 }, client: app } );
		await session.dispatch( 'mount' );
		expect( fetchSpy ).toHaveBeenCalledTimes( 2 );
		expect( session.data ).toEqual( { rows: [ 'deep' ] } );
		expect( hasPrewarm( APP ) ).toBe( true );
	} );

	it( 'a warm that failed falls through to the request it stood in for', async () => {
		fetchSpy.mockResolvedValueOnce( answer( [], false ) );
		startPrewarm( config(), host.fetch );
		fetchSpy.mockResolvedValueOnce( answer( [ 'fresh' ] ) );
		const session = createSession( { root, config: config(), windowId: APP, host, client: app } );
		await expect( session.dispatch( 'mount' ) ).resolves.toBe( true );
		expect( fetchSpy ).toHaveBeenCalledTimes( 2 );
		expect( session.data ).toEqual( { rows: [ 'fresh' ] } );
	} );

	it( 'only the first mount is warmable: a later action of the same session fetches', async () => {
		startPrewarm( config(), host.fetch );
		const session = createSession( { root, config: config(), windowId: APP, host, client: app } );
		await session.dispatch( 'mount' );
		fetchSpy.mockResolvedValueOnce( answer( [ 'refreshed' ] ) );
		await session.dispatch( 'refresh' );
		expect( fetchSpy ).toHaveBeenCalledTimes( 2 );
		expect( session.data ).toEqual( { rows: [ 'refreshed' ] } );
	} );
} );
