import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { createReactiveRegistry } from '../../src/core/reactive-registry';
import { createRegistrySync } from '../../src/core/server-sync';

interface Item {
	id: string;
	value: number;
}

let fetchMock: ReturnType< typeof vi.fn >;

beforeEach( () => {
	vi.useFakeTimers();
	fetchMock = vi.fn().mockResolvedValue( new Response( '{}', { status: 200 } ) );
	( window as unknown as { wp?: unknown } ).wp = {
		os: { fetch: fetchMock },
	};
} );

afterEach( () => {
	vi.useRealTimers();
	_resetAllSharedStoresForTests();
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'createRegistrySync', () => {
	it( 'POSTs the snapshot when the registry mutates', async () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/sync-basic',
			idOf: ( e ) => e.id,
		} );
		createRegistrySync( r, { endpoint: '/wp-json/test/v1/sync', debounceMs: 10 } );
		r.register( { id: 'a', value: 1 } );
		await vi.advanceTimersByTimeAsync( 20 );
		expect( fetchMock ).toHaveBeenCalledOnce();
		const [ url, init ] = fetchMock.mock.calls[ 0 ];
		expect( url ).toBe( '/wp-json/test/v1/sync' );
		expect( init.method ).toBe( 'POST' );
		expect( JSON.parse( init.body ) ).toEqual( {
			entries: [ { id: 'a', value: 1 } ],
		} );
	} );

	it( 'debounces consecutive mutations into one POST', async () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/sync-debounce',
			idOf: ( e ) => e.id,
		} );
		createRegistrySync( r, { endpoint: '/x', debounceMs: 50 } );
		r.register( { id: 'a', value: 1 } );
		r.register( { id: 'b', value: 2 } );
		r.register( { id: 'c', value: 3 } );
		await vi.advanceTimersByTimeAsync( 60 );
		expect( fetchMock ).toHaveBeenCalledOnce();
		const body = JSON.parse( fetchMock.mock.calls[ 0 ][ 1 ].body );
		expect( body.entries ).toHaveLength( 3 );
	} );

	it( 'applies a transform when provided', async () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/sync-transform',
			idOf: ( e ) => e.id,
		} );
		createRegistrySync< Item, { ids: string[] } >( r, {
			endpoint: '/x',
			debounceMs: 5,
			transform: ( snap ) => ( { ids: snap.map( ( e ) => e.id ) } ),
		} );
		r.register( { id: 'a', value: 1 } );
		r.register( { id: 'b', value: 2 } );
		await vi.advanceTimersByTimeAsync( 20 );
		const body = JSON.parse( fetchMock.mock.calls[ 0 ][ 1 ].body );
		expect( body ).toEqual( { ids: [ 'a', 'b' ] } );
	} );

	it( 'sends X-WP-Nonce when configured', async () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/sync-nonce',
			idOf: ( e ) => e.id,
		} );
		createRegistrySync( r, {
			endpoint: '/x',
			nonce: 'abc123',
			debounceMs: 5,
		} );
		r.register( { id: 'a', value: 1 } );
		await vi.advanceTimersByTimeAsync( 20 );
		expect( fetchMock.mock.calls[ 0 ][ 1 ].headers[ 'X-WP-Nonce' ] ).toBe(
			'abc123',
		);
	} );

	it( 'teardown stops further syncs', async () => {
		const r = createReactiveRegistry< Item >( {
			key: 'test/sync-teardown',
			idOf: ( e ) => e.id,
		} );
		const dispose = createRegistrySync( r, { endpoint: '/x', debounceMs: 5 } );
		dispose();
		r.register( { id: 'a', value: 1 } );
		await vi.advanceTimersByTimeAsync( 20 );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );
} );
