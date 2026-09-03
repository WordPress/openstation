/**
 * App Framework runtime — a singleton reopened on another subject.
 *
 * `wp.os.openWindow( id, { params } )` on a live window writes the new
 * params onto it and fires `os-window-reopened`; the runtime adopts
 * them on the session (every later dispatch carries them, so
 * `$os->params` answers with the new subject) and dispatches the
 * `reopen` lifecycle action when the app declared one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../../src/app-runtime/session';
import type { AppConfig, RuntimeHost } from '../../src/app-runtime/types';

const APP = 'reopen-demo';

function config(): AppConfig {
	return {
		osApp: true,
		id: APP,
		title: 'Reopen',
		endpoint: '/dispatch',
		state: { userId: 0 },
		titleBarButtons: [],
		windowActions: [],
		appearance: {},
		extra: {},
		actions: [ 'reopen' ],
		lifecycle: [ 'reopen' ],
	};
}

let root: HTMLElement;
let host: RuntimeHost;
let bodies: Array< Record< string, unknown > >;

beforeEach( () => {
	root = document.createElement( 'div' );
	document.body.appendChild( root );
	bodies = [];
	host = {
		fetch: vi.fn( async ( _url: string, init?: RequestInit ) => {
			bodies.push( JSON.parse( String( init?.body ?? '{}' ) ) as Record< string, unknown > );
			return {
				ok: true,
				status: 200,
				json: async () => ( { ok: true, state: { userId: 0 }, html: '<p>ok</p>', effects: [] } ),
			} as unknown as Response;
		} ),
	};
} );

afterEach( () => {
	document.body.innerHTML = '';
} );

describe( 'session.setParams', () => {
	it( 'the next dispatch carries the adopted params', async () => {
		const session = createSession( {
			root,
			config: config(),
			windowId: APP,
			host,
			params: { userId: 7 },
		} );
		await session.dispatch( 'mount' );
		expect( bodies[ 0 ].params ).toEqual( { userId: 7 } );

		session.setParams( { userId: 12 } );
		await session.dispatch( 'reopen', { params: { userId: 12 } } );
		expect( bodies[ 1 ].action ).toBe( 'reopen' );
		expect( bodies[ 1 ].params ).toEqual( { userId: 12 } );
		expect( bodies[ 1 ].args ).toEqual( { params: { userId: 12 } } );
	} );

	it( 'copies the params, so a later mutation of the caller’s object never leaks in', async () => {
		const session = createSession( { root, config: config(), windowId: APP, host } );
		const next: Record< string, string | number | boolean > = { userId: 3 };
		session.setParams( next );
		next.userId = 99;
		await session.dispatch( 'mount' );
		expect( bodies[ 0 ].params ).toEqual( { userId: 3 } );
	} );
} );
