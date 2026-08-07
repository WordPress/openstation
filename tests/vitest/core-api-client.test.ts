import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRestClient, RestError } from '../../src/core/api-client';

let fetchMock: ReturnType< typeof vi.fn >;

beforeEach( () => {
	fetchMock = vi.fn();
	( window as unknown as { wp?: unknown } ).wp = {
		os: { fetch: fetchMock },
	};
} );

afterEach( () => {
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'createRestClient', () => {
	it( 'GET parses JSON response', async () => {
		fetchMock.mockResolvedValue(
			new Response( JSON.stringify( { ok: true } ), { status: 200 } ),
		);
		const c = createRestClient( { baseUrl: '/wp-json/x/v1' } );
		const out = await c.get< { ok: boolean } >( '/items' );
		expect( out.ok ).toBe( true );
		expect( fetchMock.mock.calls[ 0 ][ 0 ] ).toBe( '/wp-json/x/v1/items' );
	} );

	it( 'POST sends JSON body and content-type header', async () => {
		fetchMock.mockResolvedValue( new Response( '{}', { status: 200 } ) );
		const c = createRestClient( { baseUrl: '/wp-json/x/v1', nonce: 'n' } );
		await c.post( '/items', { name: 'A' } );
		const init = fetchMock.mock.calls[ 0 ][ 1 ];
		expect( init.method ).toBe( 'POST' );
		expect( init.headers[ 'Content-Type' ] ).toBe( 'application/json' );
		expect( init.headers[ 'X-WP-Nonce' ] ).toBe( 'n' );
		expect( JSON.parse( init.body ) ).toEqual( { name: 'A' } );
	} );

	it( 'throws RestError with WP error fields on failure', async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify( {
					code: 'rest_invalid',
					message: 'Bad request',
					data: { status: 400 },
				} ),
				{ status: 400 },
			),
		);
		const c = createRestClient( { baseUrl: '/' } );
		await expect( c.get( '/x' ) ).rejects.toMatchObject( {
			name: 'RestError',
			status: 400,
			code: 'rest_invalid',
			message: 'Bad request',
		} );
	} );

	it( 'recover swallows the error and returns a value', async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify( { code: 'term_exists', message: 'exists' } ),
				{ status: 400 },
			),
		);
		const c = createRestClient( { baseUrl: '/' } );
		const out = await c.post(
			'/x',
			{ name: 'A' },
			{
				recover: ( body ) => {
					const wp = body as { code?: string };
					if ( wp.code === 'term_exists' ) {
						return { existed: true };
					}
					throw new RestError( 'unhandled', { status: 400 } );
				},
			},
		);
		expect( out ).toEqual( { existed: true } );
	} );

	it( 'absolute URLs bypass the base', async () => {
		fetchMock.mockResolvedValue( new Response( 'ok', { status: 200 } ) );
		const c = createRestClient( { baseUrl: '/wp-json/x/v1' } );
		await c.get( 'https://example.test/abs' );
		expect( fetchMock.mock.calls[ 0 ][ 0 ] ).toBe( 'https://example.test/abs' );
	} );

	it( 'returns plain text when the response is not JSON', async () => {
		fetchMock.mockResolvedValue( new Response( 'hello', { status: 200 } ) );
		const c = createRestClient( { baseUrl: '/' } );
		const out = await c.get< string >( '/x' );
		expect( out ).toBe( 'hello' );
	} );
} );
