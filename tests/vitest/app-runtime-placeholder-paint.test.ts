/**
 * App Framework runtime — the placeholder paint.
 *
 * `App::prefetch()` paints a client view before `mount` answers by
 * shipping the real `data()` with the window config — right for a
 * `data()` that is capability checks and options, wrong for one that
 * runs queries, since every shell boot would pay them. A client
 * `placeholder` is the other way out: the app's own stand-in (an empty
 * list, zero counts), painted the moment the window opens with
 * `ctx.loading` set, and replaced by the `mount` answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../../src/app-runtime/session';
import { defineApp, html } from '../../src/app-runtime/client';
import type { AppConfig, RuntimeHost } from '../../src/app-runtime/types';

interface State extends Record< string, unknown > {
	page: number;
}
interface Data {
	rows: string[];
}

const APP = 'placeholder-demo';

const seen: Array< { loading: boolean; rows: string[]; page: number } > = [];
const mountedSpy = vi.fn( ( ctx: { loading: boolean } ) => {
	seen.push( { loading: ctx.loading, rows: [], page: 0 } );
} );
const app = defineApp< State, Data >( APP, {
	placeholder: ( state ) => ( { rows: [ `placeholder-for-page-${ state.page }` ] } ),
	view: ( { state, data, loading } ) => {
		seen.push( { loading, rows: data.rows, page: state.page } );
		return html`<p data-loading=${ loading ? 'true' : 'false' }>${ data.rows.join( ',' ) }</p>`;
	},
	mounted: mountedSpy,
} );

const bare = defineApp< State, Data >( 'bare-demo', {
	view: ( { data } ) => html`<p>${ data.rows.join( ',' ) }</p>`,
} );

function config( over: Partial< AppConfig > = {} ): AppConfig {
	return {
		osApp: true,
		id: APP,
		title: 'Placeholder',
		endpoint: '/dispatch',
		state: { page: 3 },
		titleBarButtons: [],
		windowActions: [],
		appearance: {},
		extra: {},
		actions: [],
		client: true,
		...over,
	};
}

let root: HTMLElement;
let host: RuntimeHost;
let resolveMount: ( value: Response ) => void;

beforeEach( () => {
	root = document.createElement( 'div' );
	document.body.appendChild( root );
	host = {
		fetch: vi.fn(
			() =>
				new Promise< Response >( ( resolve ) => {
					resolveMount = resolve;
				} ),
		),
	};
	seen.length = 0;
	mountedSpy.mockClear();
} );

afterEach( () => {
	document.body.innerHTML = '';
} );

describe( 'the placeholder paint', () => {
	it( 'paints from the declared state and the placeholder, with loading set, before mount answers', () => {
		const session = createSession( { root, config: config(), windowId: APP, host, client: app } );
		void session.dispatch( 'mount' );
		expect( root.textContent ).toBe( '' );
		expect( session.paintEagerly() ).toBe( true );
		expect( root.querySelector( 'p' )?.textContent ).toBe( 'placeholder-for-page-3' );
		expect( root.querySelector( 'p' )?.getAttribute( 'data-loading' ) ).toBe( 'true' );
		// The placeholder is the first render: mounted() runs now, and
		// reads the same loading flag the view did.
		expect( mountedSpy ).toHaveBeenCalledTimes( 1 );
		expect( seen.every( ( s ) => s.loading ) ).toBe( true );
	} );

	it( 'the mount answer replaces the placeholder and clears loading, without a second mounted()', async () => {
		const session = createSession( { root, config: config(), windowId: APP, host, client: app } );
		const mount = session.dispatch( 'mount' );
		session.paintEagerly();
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		resolveMount( {
			ok: true,
			status: 200,
			json: async () => ( { ok: true, state: { page: 1 }, html: '', data: { rows: [ 'real' ] }, effects: [] } ),
		} as unknown as Response );
		await mount;
		expect( root.querySelector( 'p' )?.textContent ).toBe( 'real' );
		expect( root.querySelector( 'p' )?.getAttribute( 'data-loading' ) ).toBe( 'false' );
		expect( mountedSpy ).toHaveBeenCalledTimes( 1 );
		expect( seen.at( -1 )?.loading ).toBe( false );
	} );

	it( 'prefetched data wins over the placeholder, and is never "loading"', () => {
		const session = createSession( {
			root,
			config: config( { data: { rows: [ 'prefetched' ] } } ),
			windowId: APP,
			host,
			client: app,
		} );
		expect( session.paintEagerly() ).toBe( true );
		expect( root.querySelector( 'p' )?.textContent ).toBe( 'prefetched' );
		expect( root.querySelector( 'p' )?.getAttribute( 'data-loading' ) ).toBe( 'false' );
	} );

	it( 'is a no-op for a client view with neither a placeholder nor prefetched data', () => {
		const session = createSession( {
			root,
			config: config( { id: 'bare-demo' } ),
			windowId: 'bare-demo',
			host,
			client: bare,
		} );
		expect( session.paintEagerly() ).toBe( false );
		expect( root.textContent ).toBe( '' );
	} );

	it( 'a local action after the placeholder paint keeps loading until the server has answered', () => {
		const withLocal = defineApp< State, Data >( 'local-demo', {
			placeholder: () => ( { rows: [] } ),
			local: { next: ( state ) => ( { ...state, page: state.page + 1 } ) },
			view: ( { loading, state } ) => html`<p data-loading=${ loading ? 'true' : 'false' }>${ String( state.page ) }</p>`,
		} );
		const session = createSession( {
			root,
			config: config( { id: 'local-demo' } ),
			windowId: 'local-demo',
			host,
			client: withLocal,
		} );
		session.paintEagerly();
		session.local( 'next' );
		expect( root.querySelector( 'p' )?.textContent ).toBe( '4' );
		expect( root.querySelector( 'p' )?.getAttribute( 'data-loading' ) ).toBe( 'true' );
	} );
} );
