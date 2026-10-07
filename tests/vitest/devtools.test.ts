import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type DevtoolsModule = typeof import( '../../src/devtools' );
type HooksModule = typeof import( '../../src/hooks' );

interface CapturedMessage {
	type: string;
	headers: Record< string, string >;
	observe: boolean;
}

interface FakeIframeContext {
	captures: CapturedMessage[];
}

function mountFakeWindow( id: string ): FakeIframeContext {
	const captures: CapturedMessage[] = [];
	const contentWindow = {
		postMessage: ( msg: unknown ) => {
			captures.push( msg as CapturedMessage );
		},
	};
	const iframe = { contentWindow } as unknown as HTMLIFrameElement;

	( window as unknown as {
		wp?: { hooks?: unknown; os?: { windowManager?: { getById: ( id: string ) => unknown } } };
	} ).wp = {
		...( window as unknown as { wp?: object } ).wp,
		os: {
			windowManager: {
				getById: ( queryId: string ) => ( queryId === id ? { iframe } : null ),
			},
		},
	} as unknown as { hooks: unknown };

	return { captures };
}

function clearWindowManagerStub(): void {
	const w = ( window as unknown as { wp?: { os?: unknown } } ).wp;
	if ( w ) {
		delete w.os;
	}
}

async function freshDevtools(): Promise< { dt: DevtoolsModule; hk: HooksModule } > {

	vi.resetModules();
	const hk = ( await import( '../../src/hooks' ) ) as HooksModule;
	const dt = ( await import( '../../src/devtools' ) ) as DevtoolsModule;
	return { dt, hk };
}

describe( 'devtools.addRequestHeader', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		clearWindowManagerStub();
	} );

	test( 'pushes a os-instrument-set message with the header', async () => {
		const { dt } = await freshDevtools();
		const ctx = mountFakeWindow( 'win-a' );
		dt.devtools.addRequestHeader( 'win-a', 'X-Token', 'abc' );
		expect( ctx.captures ).toHaveLength( 1 );
		expect( ctx.captures[ 0 ].type ).toBe( 'os-instrument-set' );
		expect( ctx.captures[ 0 ].headers ).toEqual( { 'X-Token': 'abc' } );
		expect( ctx.captures[ 0 ].observe ).toBe( false );
	} );

	test( 'joins duplicate header names with comma-space (RFC 7230)', async () => {
		const { dt } = await freshDevtools();
		const ctx = mountFakeWindow( 'win-b' );
		dt.devtools.addRequestHeader( 'win-b', 'X-Trace', 'one' );
		dt.devtools.addRequestHeader( 'win-b', 'X-Trace', 'two' );
		const last = ctx.captures[ ctx.captures.length - 1 ];
		expect( last.headers ).toEqual( { 'X-Trace': 'one, two' } );
	} );

	test( 'removes the header when the last contributor disposes', async () => {
		const { dt } = await freshDevtools();
		const ctx = mountFakeWindow( 'win-c' );
		const dispose = dt.devtools.addRequestHeader( 'win-c', 'X-One', 'v' );
		dispose();
		const last = ctx.captures[ ctx.captures.length - 1 ];
		expect( last.headers ).toEqual( {} );
	} );

	test( 'thunk values are recomputed on every push', async () => {
		const { dt } = await freshDevtools();
		const ctx = mountFakeWindow( 'win-d' );
		let counter = 0;
		dt.devtools.addRequestHeader( 'win-d', 'X-N', () => `${ ++counter }` );
		dt.devtools.addRequestHeader( 'win-d', 'X-Other', 'x' );
		const headers = ctx.captures.map( ( c ) => c.headers[ 'X-N' ] );
		expect( headers ).toEqual( [ '1', '2' ] );
	} );

	test( 'does not crash when target window is missing', async () => {
		const { dt } = await freshDevtools();
		expect( () => dt.devtools.addRequestHeader( 'absent', 'X', 'y' ) ).not.toThrow();
	} );

	test( 'iframe load event re-pushes instrumentation', async () => {

		const { dt } = await freshDevtools();
		const ctx = mountFakeWindow( 'reload-target' );

		let loadCb: ( () => void ) | null = null;
		const stub = ( window as unknown as {
			wp: { os: { windowManager: { getById: ( id: string ) => unknown } } };
		} ).wp.os.windowManager.getById( 'reload-target' ) as {
			iframe: HTMLIFrameElement;
		};
		( stub.iframe as unknown as {
			addEventListener: ( name: string, cb: () => void ) => void;
			removeEventListener: ( name: string, cb: () => void ) => void;
		} ).addEventListener = ( name, cb ) => {
			if ( name === 'load' ) {
				loadCb = cb;
			}
		};
		( stub.iframe as unknown as {
			removeEventListener: ( name: string, cb: () => void ) => void;
		} ).removeEventListener = () => {
			loadCb = null;
		};

		dt.devtools.addRequestHeader( 'reload-target', 'X-Token', 'first' );
		const beforeLoadCount = ctx.captures.length;
		expect( loadCb ).not.toBeNull();

		( loadCb as unknown as () => void )();
		await Promise.resolve();
		await Promise.resolve();

		expect( ctx.captures.length ).toBeGreaterThan( beforeLoadCount );
		const last = ctx.captures[ ctx.captures.length - 1 ];
		expect( last.headers ).toEqual( { 'X-Token': 'first' } );
	} );

	test( 'reloadWithDebugSession bundles header + query-arg + cleanup', async () => {
		const { dt } = await freshDevtools();
		const ctx = mountFakeWindow( 'with-session' );

		const stub = ( window as unknown as {
			wp: { os: { windowManager: { getById: ( id: string ) => unknown } } };
		} ).wp.os.windowManager.getById( 'with-session' ) as {
			iframe: HTMLIFrameElement & { _src: string };
		};
		stub.iframe._src = 'http://example.test/wp-admin/post.php';
		Object.defineProperty( stub.iframe, 'src', {
			configurable: true,
			get() {
				return ( this as { _src: string } )._src;
			},
			set( v: string ) {
				( this as { _src: string } )._src = v;
			},
		} );
		( stub.iframe as unknown as {
			getAttribute: ( name: string ) => string | null;
		} ).getAttribute = ( name ) =>
			name === 'src' ? stub.iframe._src : null;
		( stub.iframe as unknown as {
			addEventListener: ( n: string, cb: () => void ) => void;
		} ).addEventListener = () => void 0;
		( stub.iframe as unknown as {
			removeEventListener: ( n: string, cb: () => void ) => void;
		} ).removeEventListener = () => void 0;

		const result = dt.devtools.reloadWithDebugSession(
			'with-session',
			'sess-xyz',
		);
		expect( result ).not.toBeNull();

		expect( stub.iframe._src ).toContain( 'wp_debug_session=sess-xyz' );

		const last = ctx.captures[ ctx.captures.length - 1 ];
		expect( last.headers[ 'X-WP-Debug-Session' ] ).toBe( 'sess-xyz' );

		result!.dispose();
		const afterDispose = ctx.captures[ ctx.captures.length - 1 ];
		expect( afterDispose.headers[ 'X-WP-Debug-Session' ] ).toBeUndefined();
	} );

	test( 'reloadWithDebugSession returns null for unknown window', async () => {
		const { dt } = await freshDevtools();
		expect(
			dt.devtools.reloadWithDebugSession( 'absent', 'sess' ),
		).toBeNull();
	} );
} );

describe( 'devtools.onRequest', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		clearWindowManagerStub();
	} );

	test( 'routes IFRAME_NETWORK_COMPLETED events by windowId', async () => {
		const { dt, hk } = await freshDevtools();
		mountFakeWindow( 'a' );
		const seen: dt.RequestObservation[] = [];
		dt.devtools.onRequest( 'a', ( obs ) => seen.push( obs ) );

		hk.doAction( hk.HOOKS.IFRAME_NETWORK_COMPLETED, {
			windowId: 'a',
			method: 'GET',
			url: '/x',
			status: 200,
			duration: 5,
			failed: false,
		} );
		hk.doAction( hk.HOOKS.IFRAME_NETWORK_COMPLETED, {
			windowId: 'b',
			method: 'GET',
			url: '/y',
			status: 200,
			duration: 5,
			failed: false,
		} );

		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ].url ).toBe( '/x' );
	} );

	test( 'observe: true flips the iframe-bound observe flag', async () => {
		const { dt } = await freshDevtools();
		const ctx = mountFakeWindow( 'obs' );
		const dispose = dt.devtools.onRequest( 'obs', () => void 0, { observe: true } );
		const lastBefore = ctx.captures[ ctx.captures.length - 1 ];
		expect( lastBefore.observe ).toBe( true );
		dispose();
		const lastAfter = ctx.captures[ ctx.captures.length - 1 ];
		expect( lastAfter.observe ).toBe( false );
	} );
} );

describe( 'devtools.debug', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'startSession returns a non-empty string', async () => {
		const { dt } = await freshDevtools();
		const id = dt.devtools.debug.startSession();
		expect( typeof id ).toBe( 'string' );
		expect( id.length ).toBeGreaterThan( 0 );
	} );

	test( 'publish dispatches synchronously to local subscribers', async () => {
		const { dt } = await freshDevtools();
		const sid = 'test-session';
		const seen: unknown[] = [];
		dt.devtools.debug.subscribe( sid, 'query', ( ev ) => seen.push( ev.payload ) );
		dt.devtools.debug.publish( sid, 'query', { sql: 'SELECT 1' } );
		expect( seen ).toEqual( [ { sql: 'SELECT 1' } ] );
	} );

	test( 'subscribe returns a disposer that stops further dispatches', async () => {
		const { dt } = await freshDevtools();
		const sid = 'test-disposer';
		const calls = vi.fn();
		const dispose = dt.devtools.debug.subscribe( sid, 'log', calls );
		dt.devtools.debug.publish( sid, 'log', 'a' );
		dispose();
		dt.devtools.debug.publish( sid, 'log', 'b' );
		expect( calls ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'channel filtering: payloads on other channels stay siloed', async () => {
		const { dt } = await freshDevtools();
		const sid = 'siloed';
		const onQuery = vi.fn();
		const onLog = vi.fn();
		dt.devtools.debug.subscribe( sid, 'query', onQuery );
		dt.devtools.debug.subscribe( sid, 'log', onLog );
		dt.devtools.debug.publish( sid, 'query', 1 );
		dt.devtools.debug.publish( sid, 'log', 2 );
		expect( onQuery ).toHaveBeenCalledTimes( 1 );
		expect( onLog ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'poll URL composes correctly under ugly permalinks (?rest_route=/)', async () => {

		( window as unknown as {
			openStationConfig?: { restUrl?: string; restNonce?: string };
		} ).openStationConfig = {
			restUrl: 'http://example.test/?rest_route=/',
			restNonce: 'abc',
		};
		const calls: string[] = [];
		const fetchSpy = vi
			.spyOn( globalThis, 'fetch' )
			.mockImplementation( ( input: RequestInfo | URL ) => {
				calls.push( typeof input === 'string' ? input : input.toString() );
				return Promise.resolve(
					new Response( JSON.stringify( { events: [], cursor: 0 } ), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					} ),
				);
			} );
		try {
			const { dt } = await freshDevtools();
			dt.devtools.debug.subscribe( 'sess-ugly', 'query', () => void 0 );
			await new Promise( ( r ) => setTimeout( r, 0 ) );
			expect( calls.length ).toBeGreaterThan( 0 );
			const url = calls[ 0 ];

			expect( url.match( /\?/g )?.length ).toBe( 1 );
			expect( url ).toContain( 'rest_route=' );
			expect( url ).toContain( 'sessionId=sess-ugly' );

			expect( url ).toContain( 'channels%5B%5D=query' );
		} finally {
			fetchSpy.mockRestore();
			delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
		}
	} );

	test( 'poll URL includes subscribed channels (regression: empty drains)', async () => {

		( window as unknown as {
			openStationConfig?: { restUrl?: string; restNonce?: string };
		} ).openStationConfig = {
			restUrl: 'https://example.test/wp-json/',
			restNonce: 'abc',
		};
		const calls: string[] = [];
		const fetchSpy = vi
			.spyOn( globalThis, 'fetch' )
			.mockImplementation( ( input: RequestInfo | URL ) => {
				calls.push( typeof input === 'string' ? input : input.toString() );
				return Promise.resolve(
					new Response(
						JSON.stringify( { events: [], cursor: 0 } ),
						{ status: 200, headers: { 'Content-Type': 'application/json' } },
					),
				);
			} );
		try {
			const { dt } = await freshDevtools();

			dt.devtools.debug.subscribe( 'sess-1', 'query', () => void 0 );
			await new Promise( ( r ) => setTimeout( r, 0 ) );
			expect( calls.length ).toBeGreaterThan( 0 );
			const url = calls[ 0 ];
			expect( url ).toContain( 'sessionId=sess-1' );
			expect( url ).toContain( 'channels%5B%5D=query' );
		} finally {
			fetchSpy.mockRestore();
			delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
		}
	} );
} );
