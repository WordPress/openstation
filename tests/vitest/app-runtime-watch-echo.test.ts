/**
 * `App::watch()` and the window's own echo.
 *
 * An app's `announce` effect (or `ctx.host.announce`) broadcasts
 * `os.<type>.changed` tagged with this window; its own `watch()` must
 * not answer that broadcast with a second round trip — the dispatch
 * that announced already returned the fresh `data()`. A change made
 * anywhere else still refreshes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../../src/app-runtime/session';
import { appAnnounceSource, type AppConfig, type RuntimeHost } from '../../src/app-runtime/types';

const APP = 'echo-demo';

function config(): AppConfig {
	return {
		osApp: true,
		id: APP,
		title: 'Echo',
		endpoint: '/dispatch',
		state: {},
		titleBarButtons: [],
		windowActions: [],
		appearance: {},
		extra: {},
		actions: [],
		watch: [ 'post', '*' ],
	};
}

type Listener = ( topic: string, payload?: unknown ) => void;

let root: HTMLElement;
let listeners: Array< { topic: string; cb: Listener } >;
let actions: string[];
let host: RuntimeHost;

beforeEach( () => {
	root = document.createElement( 'div' );
	document.body.appendChild( root );
	listeners = [];
	actions = [];
	host = {
		fetch: vi.fn( async ( _url: string, init?: RequestInit ) => {
			actions.push( String( ( JSON.parse( String( init?.body ?? '{}' ) ) as { action: string } ).action ) );
			return {
				ok: true,
				status: 200,
				json: async () => ( { ok: true, state: {}, html: '', effects: [] } ),
			} as unknown as Response;
		} ),
		onBroadcast: ( topic, cb ) => {
			listeners.push( { topic, cb } );
			return () => undefined;
		},
	};
} );

afterEach( () => {
	document.body.innerHTML = '';
} );

const fire = ( topic: string, payload: unknown ): void => {
	for ( const l of listeners ) {
		if ( l.topic === topic || l.topic === '*' ) {
			l.cb( topic, payload );
		}
	}
};

const settle = (): Promise< void > => new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

describe( 'watch', () => {
	it( 'refreshes on a change made elsewhere, skips the window’s own echo', async () => {
		createSession( { root, config: config(), windowId: 'win-1', host } );
		expect( listeners.map( ( l ) => l.topic ) ).toEqual( [ 'os.post.changed', '*' ] );

		fire( 'os.post.changed', { source: appAnnounceSource( 'win-1' ), action: 'trashed', ids: [ 1 ] } );
		await settle();
		expect( actions ).toEqual( [] );

		fire( 'os.post.changed', { source: appAnnounceSource( 'win-2' ), action: 'trashed', ids: [ 1 ] } );
		await settle();
		expect( actions ).toEqual( [ 'set' ] );

		fire( 'os.comment.changed', { source: 'my-plugin', action: 'approved', ids: [ 3 ] } );
		await settle();
		expect( actions ).toEqual( [ 'set', 'set' ] );
	} );

	it( 'a broadcast without a source is never treated as an echo', async () => {
		createSession( { root, config: config(), windowId: 'win-1', host } );
		fire( 'os.post.changed', { action: 'trashed', ids: [ 1 ] } );
		await settle();
		expect( actions ).toEqual( [ 'set' ] );
	} );
} );
