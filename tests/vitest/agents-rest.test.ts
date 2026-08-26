/**
 * Unit tests for `src/my-wordpress/agents-rest.ts` — URL building,
 * headers, payload shapes, and error normalization for the agents
 * REST client.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createAgent,
	deleteAgent,
	fetchAbilitiesCatalogue,
	invokeAgent,
	listAgents,
	uploadAgentProfilePicture,
	updateAgent,
} from '../../src/my-wordpress/agents-rest';

const WINDOW_ID = 'desktop-mode-my-wordpress';

type FetchMock = ReturnType< typeof vi.fn >;

function mockFetch(
	response: unknown,
	init: { ok?: boolean; status?: number } = {},
): FetchMock {
	const fn = vi.fn( async () => ( {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		json: async () => response,
	} ) as unknown as Response );
	( globalThis as unknown as { fetch: FetchMock } ).fetch = fn;
	return fn;
}

beforeEach( () => {
	( window as unknown as Record< string, unknown > ).openStationWindowConfig = {
		[ WINDOW_ID ]: {
			restRoot: 'https://example.test/wp-json/',
			restNonce: 'test-nonce',
			entities: [],
			perPage: 24,
			editPostUrlBase: '',
		},
	};
} );

afterEach( () => {
	vi.restoreAllMocks();
	delete ( window as unknown as Record< string, unknown > )
		.openStationWindowConfig;
} );

describe( 'agents REST client', () => {
	test( 'listAgents hits the collection route with the nonce', async () => {
		const fetchMock = mockFetch( [ { id: 7, name: 'A' } ] );

		const agents = await listAgents();

		expect( agents ).toHaveLength( 1 );
		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents',
		);
		expect(
			( init.headers as Record< string, string > )[ 'X-WP-Nonce' ],
		).toBe( 'test-nonce' );
	} );

	test( 'createAgent POSTs the payload', async () => {
		const fetchMock = mockFetch( { id: 9, name: 'New' } );

		await createAgent( { name: 'New', role: 'author' } );

		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents',
		);
		expect( init.method ).toBe( 'POST' );
		expect( JSON.parse( String( init.body ) ) ).toEqual( {
			name: 'New',
			role: 'author',
		} );
	} );

	test( 'updateAgent PATCHes via POST on the item route', async () => {
		const fetchMock = mockFetch( { id: 9 } );

		await updateAgent( 9, { instructions: 'Be nice.' } );

		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents/9',
		);
		expect( init.method ).toBe( 'POST' );
		expect( JSON.parse( String( init.body ) ) ).toEqual( {
			instructions: 'Be nice.',
		} );
	} );

	test( 'uploads a profile picture to the Media Library', async () => {
		const fetchMock = mockFetch( {
			id: 81,
			source_url: 'https://example.test/uploads/avatar.jpg',
		} );
		const file = new File( [ 'image bytes' ], 'Agent Portrait.jpg', {
			type: 'image/jpeg',
		} );

		const uploaded = await uploadAgentProfilePicture( file );

		expect( uploaded ).toEqual( {
			id: 81,
			url: 'https://example.test/uploads/avatar.jpg',
		} );
		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toBe( 'https://example.test/wp-json/wp/v2/media' );
		expect( init.method ).toBe( 'POST' );
		expect( init.body ).toBe( file );
		expect( ( init.headers as Record< string, string > )[ 'Content-Type' ] ).toBe(
			'image/jpeg',
		);
		expect(
			( init.headers as Record< string, string > )[ 'Content-Disposition' ],
		).toBe( 'attachment; filename="Agent-Portrait.jpg"' );
	} );

	test( 'deleteAgent uses the DELETE verb', async () => {
		const fetchMock = mockFetch( { deleted: true, id: 9 } );

		const result = await deleteAgent( 9 );

		expect( result.deleted ).toBe( true );
		const [ , init ] = fetchMock.mock.calls[ 0 ] as [ string, RequestInit ];
		expect( init.method ).toBe( 'DELETE' );
	} );

	test( 'invokeAgent posts the message to the invoke route', async () => {
		const fetchMock = mockFetch( {
			text: 'done',
			toolCalls: [],
			turns: 1,
		} );

		const result = await invokeAgent( 4, 'do it' );

		expect( result.text ).toBe( 'done' );
		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents/4/invoke',
		);
		expect( JSON.parse( String( init.body ) ) ).toEqual( {
			message: 'do it',
		} );
	} );

	test( 'fetchAbilitiesCatalogue hits the catalogue route', async () => {
		const fetchMock = mockFetch( [
			{ slug: 'x/y', label: 'Y', readonly: true },
		] );

		const catalogue = await fetchAbilitiesCatalogue();

		expect( catalogue[ 0 ].slug ).toBe( 'x/y' );
		const [ url ] = fetchMock.mock.calls[ 0 ] as [ string, RequestInit ];
		expect( url ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents/abilities',
		);
	} );

	test( 'server errors surface their message', async () => {
		mockFetch(
			{ code: 'x', message: 'Agent not found.' },
			{ ok: false, status: 404 },
		);

		await expect( invokeAgent( 999, 'hi' ) ).rejects.toThrow(
			'Agent not found.',
		);
	} );

	test( 'non-JSON errors fall back to the HTTP status', async () => {
		const fn = vi.fn( async () => ( {
			ok: false,
			status: 500,
			json: async () => {
				throw new Error( 'not json' );
			},
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fn;

		await expect( listAgents() ).rejects.toThrow( 'HTTP 500' );
	} );
} );
