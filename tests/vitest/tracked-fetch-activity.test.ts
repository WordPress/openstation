import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { trackedFetch } from '../../src/boot/tracked-fetch';
import type { WindowManager } from '../../src/window-manager';
import type { Window as DesktopWindow } from '../../src/window';
import { activity } from '../../src/activity';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

interface Settlement {
	ok: boolean;
	error?: string;
}

function makeTarget() {
	const settled: Settlement[] = [];
	const target = {
		id: 'focused',
		trackActivity< T >( promise: Promise< T > ): Promise< T > {
			return promise.then(
				( value ) => {
					settled.push( { ok: true } );
					return value;
				},
				( err: unknown ) => {
					settled.push( {
						ok: false,
						error: err instanceof Error ? err.message : String( err ),
					} );
					throw err;
				},
			);
		},
	};
	const manager = {
		getById: () => null,
		getFocused: () => target as unknown as DesktopWindow,
	} as unknown as WindowManager;
	return { manager, settled };
}

function response( status: number, statusText: string ): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
	} as Response;
}

async function flush(): Promise< void > {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe( 'trackedFetch — activity outcome', () => {
	beforeEach( () => {
		vi.restoreAllMocks();
	} );

	test( 'an HTTP 500 settles the indicator as failed', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue(
			response( 500, 'Internal Server Error' ),
		);

		await trackedFetch( manager, '/wp-json/desktop-mode/v1/thing' );
		await flush();

		expect( settled ).toHaveLength( 1 );
		expect( settled[ 0 ].ok ).toBe( false );
		expect( settled[ 0 ].error ).toContain( '500' );
		expect( settled[ 0 ].error ).toContain( 'Internal Server Error' );
	} );

	test( 'the caller still gets the error response, not a rejection', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue(
			response( 500, 'Internal Server Error' ),
		);

		const res = await trackedFetch(
			manager,
			'/wp-json/desktop-mode/v1/thing',
		);

		expect( res.status ).toBe( 500 );
		expect( res.ok ).toBe( false );
	} );

	test( 'a 4xx settles as failed too', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue(
			response( 400, 'Bad Request' ),
		);

		await trackedFetch( manager, '/wp-json/desktop-mode/v1/thing' );
		await flush();

		expect( settled[ 0 ].ok ).toBe( false );
	} );

	test( 'a 2xx still settles as saved', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );

		await trackedFetch( manager, '/wp-json/desktop-mode/v1/thing' );
		await flush();

		expect( settled ).toEqual( [ { ok: true } ] );
	} );

	test( 'a network-level rejection keeps its own error message', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockRejectedValue(
			new Error( 'Failed to fetch' ),
		);

		await expect(
			trackedFetch( manager, '/wp-json/desktop-mode/v1/thing' ),
		).rejects.toThrow( 'Failed to fetch' );
		await flush();

		expect( settled[ 0 ] ).toEqual( {
			ok: false,
			error: 'Failed to fetch',
		} );
	} );

	test( 'silent requests are not tracked at all', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue(
			response( 500, 'Internal Server Error' ),
		);

		await trackedFetch(
			manager,
			'/wp-json/desktop-mode/v1/thing',
			undefined,
			{ silent: true },
		);
		await flush();

		expect( settled ).toHaveLength( 0 );
	} );
} );

describe( 'os/request-settled', () => {
	beforeEach( () => {
		vi.restoreAllMocks();
		installHooksStub();
	} );
	afterEach( () => clearHooksStub() );

	test( 'a tagged request reaches the activity bus', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );
		const seen: unknown[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p ),
		);
		await trackedFetch( manager, '/wp-json/x/v1/y', undefined, {
			source: 'probe/x',
		} );
		await flush();
		off();
		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ] ).toMatchObject( {
			source: 'probe/x',
			ok: true,
			status: 200,
			method: 'GET',
			url: '/wp-json/x/v1/y',
			silent: false,
		} );
	} );

	test( 'an untagged request publishes with no source key at all', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );
		const seen: Record< string, unknown >[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p as Record< string, unknown > ),
		);
		await trackedFetch( manager, '/wp-json/x/v1/y' );
		await flush();
		off();

		expect( seen[ 0 ] ).not.toHaveProperty( 'source' );
	} );

	test( 'a refused response publishes ok:false with its status', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue(
			response( 500, 'Internal Server Error' ),
		);
		const seen: unknown[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p ),
		);
		await trackedFetch( manager, '/wp-json/x/v1/y', { method: 'post' } );
		await flush();
		off();

		expect( seen[ 0 ] ).toMatchObject( {
			ok: false,
			status: 500,
			method: 'POST',
		} );
	} );

	test( 'a network rejection publishes the reason and no status', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockRejectedValue( new Error( 'offline' ) );
		const seen: Record< string, unknown >[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p as Record< string, unknown > ),
		);
		await expect(
			trackedFetch( manager, '/wp-json/x/v1/y', undefined, {
				source: 'probe/x',
			} ),
		).rejects.toThrow( 'offline' );
		await flush();
		off();
		expect( seen[ 0 ] ).toMatchObject( { error: 'offline', source: 'probe/x' } );

		expect( seen[ 0 ] ).not.toHaveProperty( 'status' );
		expect( seen[ 0 ] ).not.toHaveProperty( 'ok' );
	} );

	test( 'a silent request still reaches the bus, flagged silent', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );
		const seen: unknown[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p ),
		);
		await trackedFetch( manager, '/wp-json/x/v1/y', undefined, {
			silent: true,
			source: 'probe/x',
		} );
		await flush();
		off();

		expect( settled ).toHaveLength( 0 );
		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ] ).toMatchObject( { silent: true, source: 'probe/x' } );
	} );

	test( 'windowId names the window the request is attributed to', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );
		const seen: { windowId: string | null }[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p ),
		);
		const named = { id: 'notes' } as unknown as DesktopWindow;

		await trackedFetch( manager, '/a' );

		await trackedFetch( manager, '/b', undefined, { silent: true } );

		await trackedFetch( manager, '/c', undefined, { silent: true, window: named } );

		await trackedFetch( manager, '/d', undefined, { silent: true, windowId: 'gone' } );
		await flush();
		off();
		expect( seen.map( ( p ) => p.windowId ) ).toEqual( [
			'focused',
			null,
			'notes',
			null,
		] );
	} );

	test( 'a cancelled request is flagged aborted, a failed one is not', async () => {
		const { manager } = makeTarget();
		const seen: Record< string, unknown >[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p as Record< string, unknown > ),
		);

		const controller = new AbortController();
		controller.abort( 'superseded' );
		vi.spyOn( window, 'fetch' ).mockRejectedValueOnce( 'superseded' );
		await expect(
			trackedFetch( manager, '/a', { signal: controller.signal } ),
		).rejects.toBe( 'superseded' );
		vi.spyOn( window, 'fetch' ).mockRejectedValueOnce( new Error( 'offline' ) );
		await expect( trackedFetch( manager, '/b' ) ).rejects.toThrow( 'offline' );
		await flush();
		off();
		expect( seen[ 0 ] ).toMatchObject( { error: 'superseded', aborted: true } );
		expect( seen[ 1 ] ).toMatchObject( { error: 'offline' } );
		expect( seen[ 1 ] ).not.toHaveProperty( 'aborted' );
	} );

	test( 'a subscriber that throws does not break the request', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );
		const off = activity.subscribe( 'os/request-settled', () => {
			throw new Error( 'bad subscriber' );
		} );

		const rejections: unknown[] = [];
		const onRejection = ( err: unknown ) => rejections.push( err );
		process.on( 'unhandledRejection', onRejection );
		const res = await trackedFetch( manager, '/wp-json/x/v1/y' );

		vi.spyOn( window, 'fetch' ).mockRejectedValueOnce( Object.create( null ) );
		await trackedFetch( manager, '/wp-json/x/v1/z', undefined, {
			silent: true,
		} ).catch( () => {} );
		await flush();

		await new Promise( ( r ) => setTimeout( r, 0 ) );
		process.off( 'unhandledRejection', onRejection );
		off();
		expect( rejections ).toEqual( [] );
		expect( res.status ).toBe( 200 );
		expect( settled ).toEqual( [ { ok: true } ] );
	} );
} );
