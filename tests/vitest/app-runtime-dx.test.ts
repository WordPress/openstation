/**
 * The App Framework's developer-experience layer: the guards that
 * turn the two silent first-hour failures into console warnings (an
 * os-action nothing implements; a state key the schema doesn't
 * declare), the per-window dispatch trace, the shadow-piercing
 * renderedText() test helper, and the client-API queue that makes
 * client views writable outside this repo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, setSessionDebug } from '../../src/app-runtime/session';
import { renderedText } from '../../src/app-runtime/testing';
import type { AppConfig, RuntimeHost } from '../../src/app-runtime/types';
import '../../src/ui/components/os-stat/os-stat';

function config( over: Partial< AppConfig > = {} ): AppConfig {
	return {
		osApp: true,
		id: `dx-${ Math.random().toString( 36 ).slice( 2, 8 ) }`,
		title: 'DX',
		endpoint: 'https://example.test/wp-json/desktop-mode/v1/apps/dx/dispatch',
		state: { query: '' },
		titleBarButtons: [],
		windowActions: [],
		appearance: {},
		extra: {},
		actions: [ 'save' ],
		...over,
	};
}

function host( html = '' ): RuntimeHost {
	return {
		fetch: async () =>
			( {
				ok: true,
				status: 200,
				json: async () => ( { ok: true, state: {}, html, effects: [] } ),
			} ) as unknown as Response,
	};
}

const flush = () => new Promise( ( r ) => setTimeout( r, 0 ) );

describe( 'the dev guards', () => {
	let warn: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		warn = vi.spyOn( console, 'warn' ).mockImplementation( () => undefined );
	} );

	afterEach( () => {
		warn.mockRestore();
		document.body.replaceChildren();
	} );

	it( 'flags a rendered os-action nothing implements — once', () => {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		const session = createSession( {
			root,
			config: config(),
			windowId: 'w1',
			host: host( '<button os-action="svae">Save</button><button os-action="save">OK</button>' ),
		} );
		// finishRender runs after a local repaint; provoke one via the
		// morph path by dispatching mount.
		return session.dispatch( 'mount' ).then( async () => {
			await flush();
			const typoWarnings = warn.mock.calls.filter( ( c ) =>
				String( c[ 0 ] ).includes( 'os-action="svae"' ),
			);
			expect( typoWarnings ).toHaveLength( 1 );
			// A declared action and the built-ins stay silent.
			expect(
				warn.mock.calls.some( ( c ) => String( c[ 0 ] ).includes( '"save"' ) ),
			).toBe( false );
			session.dispose();
		} );
	} );

	it( 'stays quiet when the config carries no action list (older blob)', async () => {
		const root = document.createElement( 'div' );
		root.innerHTML = '<button os-action="anything">Go</button>';
		document.body.appendChild( root );
		const session = createSession( {
			root,
			config: config( { actions: [] } ),
			windowId: 'w2',
			host: host(),
		} );
		await session.dispatch( 'mount' );
		expect(
			warn.mock.calls.some( ( c ) => String( c[ 0 ] ).includes( 'os-action' ) ),
		).toBe( false );
		session.dispose();
	} );

	it( 'flags an os-bind to a key the state schema does not declare', async () => {
		const root = document.createElement( 'div' );
		root.innerHTML = '<input os-bind="qeury" os-action="save" />';
		document.body.appendChild( root );
		const session = createSession( { root, config: config(), windowId: 'w3', host: host() } );
		root.querySelector( 'input' )!.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await flush();
		expect(
			warn.mock.calls.some( ( c ) => String( c[ 0 ] ).includes( 'os-bind="qeury"' ) ),
		).toBe( true );
		session.dispose();
	} );

	it( 'flags a local reducer writing an undeclared key, pointing at ctx.ui()', async () => {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		const session = createSession( {
			root,
			config: config( { client: true } ),
			windowId: 'w4',
			host: host(),
			client: {
				id: 'dx',
				hasLocal: ( a ) => 'stash' === a,
				runLocal: ( _a, s ) => ( { ...s, remembered: true } ),
				render: () => undefined,
				mounted: () => undefined,
			},
		} );
		await session.dispatch( 'mount' );
		session.local( 'stash' );
		const message = warn.mock.calls.map( ( c ) => String( c[ 0 ] ) ).find( ( m ) => m.includes( 'state.remembered' ) );
		expect( message ).toBeTruthy();
		expect( message ).toContain( 'ctx.ui()' );
		session.dispose();
	} );
} );

describe( 'the dispatch trace', () => {
	it( 'logs a collapsed group per dispatch only while enabled', async () => {
		const group = vi.spyOn( console, 'groupCollapsed' ).mockImplementation( () => undefined );
		const log = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		const groupEnd = vi.spyOn( console, 'groupEnd' ).mockImplementation( () => undefined );
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		const session = createSession( { root, config: config(), windowId: 'traced', host: host() } );
		await session.dispatch( 'mount' );
		expect( group ).not.toHaveBeenCalled();
		setSessionDebug( 'traced' );
		await session.dispatch( 'save' );
		expect( group ).toHaveBeenCalledTimes( 1 );
		expect( String( group.mock.calls[ 0 ][ 0 ] ) ).toContain( 'save' );
		setSessionDebug( 'traced', false );
		await session.dispatch( 'save' );
		expect( group ).toHaveBeenCalledTimes( 1 );
		session.dispose();
		group.mockRestore();
		log.mockRestore();
		groupEnd.mockRestore();
		document.body.replaceChildren();
	} );
} );

describe( 'renderedText', () => {
	it( 'reads through shadow roots and slots', async () => {
		const hostEl = document.createElement( 'div' );
		hostEl.innerHTML = '<os-stat value="1,204" label="Events" caption="today"></os-stat><p>plain</p>';
		document.body.appendChild( hostEl );
		await Promise.resolve();
		const text = renderedText( hostEl );
		expect( text ).toContain( '1,204' );
		expect( text ).toContain( 'Events' );
		expect( text ).toContain( 'today' );
		expect( text ).toContain( 'plain' );
		// The very hole this helper exists for:
		expect( hostEl.textContent ).not.toContain( '1,204' );
		hostEl.remove();
	} );
} );

describe( 'the client-API queue', () => {
	it( 'drains queued client views and serves late pushes immediately', async () => {
		vi.resetModules();
		const early = vi.fn();
		( window as unknown as { openStationAppsPending?: unknown } ).openStationAppsPending = [ early ];
		const { publishClientApi } = await import( '../../src/app-runtime/index' );
		// The module's own load already drained the queue.
		expect( early ).toHaveBeenCalledTimes( 1 );
		const api = early.mock.calls[ 0 ][ 0 ] as Record< string, unknown >;
		expect( typeof api.defineApp ).toBe( 'function' );
		expect( typeof api.html ).toBe( 'function' );
		expect( typeof api.createPagedList ).toBe( 'function' );
		// A push after the runtime loaded runs synchronously.
		const late = vi.fn();
		( window as unknown as { openStationAppsPending: { push: ( fn: unknown ) => void } } )
			.openStationAppsPending.push( late );
		expect( late ).toHaveBeenCalledTimes( 1 );
		// Re-publishing is idempotent.
		publishClientApi();
		expect( early ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'contains a queued view that throws', async () => {
		const error = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		const after = vi.fn();
		( window as unknown as { openStationAppsPending: { push: ( fn: unknown ) => void } } )
			.openStationAppsPending.push( () => {
				throw new Error( 'broken plugin' );
			} );
		( window as unknown as { openStationAppsPending: { push: ( fn: unknown ) => void } } )
			.openStationAppsPending.push( after );
		expect( after ).toHaveBeenCalledTimes( 1 );
		expect( error ).toHaveBeenCalled();
		error.mockRestore();
	} );
} );
