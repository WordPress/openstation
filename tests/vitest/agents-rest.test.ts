/**
 * Vitest — REST adapter for the Agents section.
 *
 * Stubs `window.fetch` and the My WordPress window config so the
 * adapter's URL/header/body shape can be asserted without spinning up
 * a real WP REST server.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

interface WindowConfigSlot {
	'desktop-mode-my-wordpress'?: {
		restRoot: string;
		restNonce: string;
		entities: unknown[];
		perPage: number;
	};
}

function installWindowConfig(): void {
	(
		window as unknown as { desktopModeWindowConfig?: WindowConfigSlot }
	).desktopModeWindowConfig = {
		'desktop-mode-my-wordpress': {
			restRoot: 'https://example.test/wp-json/',
			restNonce: 'test-nonce',
			entities: [],
			perPage: 24,
		},
	};
}

function clearWindowConfig(): void {
	delete (
		window as unknown as { desktopModeWindowConfig?: unknown }
	).desktopModeWindowConfig;
}

function jsonResponse( body: unknown, init: ResponseInit = { status: 200 } ): Response {
	return new Response( JSON.stringify( body ), {
		...init,
		headers: { 'Content-Type': 'application/json', ...init.headers },
	} );
}

describe( 'agents-rest', () => {
	let fetchSpy: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		installWindowConfig();
		fetchSpy = vi.fn();
		( window as unknown as { fetch: typeof fetch } ).fetch =
			fetchSpy as unknown as typeof fetch;
		( globalThis as unknown as { fetch: typeof fetch } ).fetch =
			fetchSpy as unknown as typeof fetch;
	} );

	afterEach( () => {
		clearWindowConfig();
		vi.restoreAllMocks();
	} );

	test( 'listAgents() targets /desktop-mode/v1/agents with a GET', async () => {
		const { listAgents } = await import( '../../src/my-wordpress/agents-rest' );
		fetchSpy.mockResolvedValue( jsonResponse( [] ) );

		await listAgents();

		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
		const [ url, init ] = fetchSpy.mock.calls[ 0 ];
		expect( String( url ) ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents',
		);
		expect( ( init as RequestInit ).method ).toBe( 'GET' );
		expect(
			( ( init as RequestInit ).headers as Record< string, string > )[
				'X-WP-Nonce'
			],
		).toBe( 'test-nonce' );
	} );

	test( 'createAgent() POSTs JSON body', async () => {
		const { createAgent } = await import( '../../src/my-wordpress/agents-rest' );
		fetchSpy.mockResolvedValue(
			jsonResponse(
				{
					id: 7,
					slug: 'foo',
					name: 'Foo',
					description: '',
					instructions: '',
					role: 'editor',
					guidelineId: 14,
					guidelineLink: '',
					abilities: [],
					triggers: [],
					model: '',
					rateLimit: 0,
					avatarUrl: '',
				},
				{ status: 201 },
			),
		);

		const result = await createAgent( {
			name: 'Foo',
			role: 'editor',
		} );

		const [ , init ] = fetchSpy.mock.calls[ 0 ];
		const body = JSON.parse(
			String( ( init as RequestInit ).body ),
		) as Record< string, unknown >;
		expect( body.name ).toBe( 'Foo' );
		expect( body.role ).toBe( 'editor' );
		expect( ( init as RequestInit ).method ).toBe( 'POST' );
		expect(
			( ( init as RequestInit ).headers as Record< string, string > )[
				'Content-Type'
			],
		).toBe( 'application/json' );
		expect( result.id ).toBe( 7 );
	} );

	test( 'setAbilities() patches the /agents/<id> URL', async () => {
		const { setAbilities } = await import( '../../src/my-wordpress/agents-rest' );
		fetchSpy.mockResolvedValue(
			jsonResponse( {
				id: 9,
				slug: 'a',
				name: 'A',
				description: '',
				instructions: '',
				role: 'editor',
				guidelineId: 1,
				guidelineLink: '',
				abilities: [ 'media/upload' ],
				triggers: [],
				model: '',
				rateLimit: 0,
				avatarUrl: '',
			} ),
		);

		await setAbilities( 9, [ 'media/upload' ] );

		const [ url, init ] = fetchSpy.mock.calls[ 0 ];
		expect( String( url ) ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents/9',
		);
		expect( ( init as RequestInit ).method ).toBe( 'POST' );
		const body = JSON.parse(
			String( ( init as RequestInit ).body ),
		) as { abilities: string[] };
		expect( body.abilities ).toEqual( [ 'media/upload' ] );
	} );

	test( 'deleteAgent() uses the DELETE verb', async () => {
		const { deleteAgent } = await import( '../../src/my-wordpress/agents-rest' );
		fetchSpy.mockResolvedValue(
			jsonResponse( { deleted: true, id: 5 } ),
		);

		await deleteAgent( 5 );

		const [ , init ] = fetchSpy.mock.calls[ 0 ];
		expect( ( init as RequestInit ).method ).toBe( 'DELETE' );
	} );

	test( 'fetchAbilitiesCatalogue() hits /agents/abilities', async () => {
		const { fetchAbilitiesCatalogue } = await import(
			'../../src/my-wordpress/agents-rest'
		);
		fetchSpy.mockResolvedValue(
			jsonResponse( [
				{
					slug: 'media/upload',
					label: 'Upload',
					description: 'desc',
				},
			] ),
		);

		await fetchAbilitiesCatalogue();

		const [ url ] = fetchSpy.mock.calls[ 0 ];
		expect( String( url ) ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/agents/abilities',
		);
	} );

	test( 'failing response is surfaced as an Error with the server message', async () => {
		const { createAgent } = await import( '../../src/my-wordpress/agents-rest' );
		fetchSpy.mockResolvedValue(
			jsonResponse(
				{ message: 'Pick a valid WordPress role for the agent.' },
				{ status: 400 },
			),
		);

		await expect(
			createAgent( { name: 'Bad', role: 'nope' } ),
		).rejects.toThrow( 'Pick a valid WordPress role' );
	} );
} );
