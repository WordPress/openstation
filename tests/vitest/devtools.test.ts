/**
 * Tests for the devtools instrumentation surface.
 *
 * Covers:
 *   - Header contributions are merged + ref-counted across multiple
 *     devtools targeting the same window.
 *   - Removal cleans the contribution; duplicate names join with `, `.
 *   - `onRequest` dispatches to per-window subscribers and ignores
 *     payloads for other windows.
 *   - `observe: true` flips the iframe-bound message flag.
 *   - Debug bus echoes `publish()` to local subscribers immediately.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

// The devtools module attaches a top-level `addAction` listener at
// import time, so the hooks stub must be mounted first. We lazy-load
// the module inside each test after `installHooksStub()` runs.
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
		wp?: { hooks?: unknown; desktop?: { windowManager?: { getById: ( id: string ) => unknown } } };
	} ).wp = {
		...( window as unknown as { wp?: object } ).wp,
		desktop: {
			windowManager: {
				getById: ( queryId: string ) => ( queryId === id ? { iframe } : null ),
			},
		},
	} as unknown as { hooks: unknown };

	return { captures };
}

function clearWindowManagerStub(): void {
	const w = ( window as unknown as { wp?: { desktop?: unknown } } ).wp;
	if ( w ) {
		delete w.desktop;
	}
}

async function freshDevtools(): Promise< { dt: DevtoolsModule; hk: HooksModule } > {
	// Bust the module cache so the top-level addAction re-runs against
	// the freshly-installed hooks stub. Vitest's `vi.resetModules` is
	// the canonical way to do this.
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

	test( 'pushes a wp-desktop-instrument-set message with the header', async () => {
		const { dt } = await freshDevtools();
		const ctx = mountFakeWindow( 'win-a' );
		dt.devtools.addRequestHeader( 'win-a', 'X-Token', 'abc' );
		expect( ctx.captures ).toHaveLength( 1 );
		expect( ctx.captures[ 0 ].type ).toBe( 'wp-desktop-instrument-set' );
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
} );
