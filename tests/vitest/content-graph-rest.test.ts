/**
 * Unit tests for the Content Graph REST client (added in 0.9.0): the
 * new edge-kind discriminator on edges, the new `terms` field on
 * nodes, the extended `fetchGraph` signature, and the new
 * `fetchPrefs` / `savePrefs` helpers.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	fetchGraph,
	fetchPrefs,
	savePrefs,
} from '../../src/content-graph/rest';
import type {
	ContentGraphConfig,
	ContentGraphPrefs,
	GraphPayload,
} from '../../src/content-graph/types';

declare global {
	// eslint-disable-next-line no-var
	var wp:
		| {
				desktop?: {
					fetch?: typeof fetch;
				};
		  }
		| undefined;
}

const cfg: ContentGraphConfig = {
	restRoot: 'http://example.test/wp-json/',
	restNonce: 'test-nonce',
	apiBase: 'http://example.test/wp-json/desktop-mode/v1/content-graph',
	editPostUrl: '',
	editTermUrl: '',
	editUserUrl: '',
	editCommentUrl: '',
	mediaUrl: '',
	postTypes: [],
	taxonomies: [],
	edgeKinds: [],
	prefs: {
		lens: 'constellation',
		byLens: {
			constellation: { types: [], edges: [ 'link' ] },
			galaxy: {
				types: [],
				edges: [ 'link', 'co_tag' ],
				taxonomy: 'category',
			},
		},
	},
};

function jsonResponse< T >( body: T, status = 200 ): Response {
	return new Response( JSON.stringify( body ), {
		status,
		headers: { 'Content-Type': 'application/json' },
	} );
}

describe( 'content-graph rest client', () => {
	let originalFetch: typeof fetch;

	beforeEach( () => {
		originalFetch = global.fetch;
	} );

	afterEach( () => {
		global.fetch = originalFetch;
		// Reset wp.desktop in case a test wired it.
		( global as { wp?: unknown } ).wp = undefined;
	} );

	test( 'fetchGraph passes types, edges, and taxonomies as query params', async () => {
		const spy = vi.fn().mockResolvedValue(
			jsonResponse< GraphPayload >( {
				nodes: [],
				edges: [],
				stats: { nodes: 0, edges: 0, generated_at: 0 },
			} ),
		);
		global.fetch = spy as unknown as typeof fetch;

		await fetchGraph(
			cfg,
			[ 'post', 'page' ],
			[ 'link', 'co_tag' ],
			[ 'category', 'post_tag' ],
		);

		const calledWith = spy.mock.calls[ 0 ][ 0 ] as string;
		const url = new URL( calledWith );
		expect( url.searchParams.get( 'types' ) ).toBe( 'post,page' );
		expect( url.searchParams.get( 'edges' ) ).toBe( 'link,co_tag' );
		expect( url.searchParams.get( 'taxonomies' ) ).toBe( 'category,post_tag' );
	} );

	test( 'fetchGraph omits unsupplied query params', async () => {
		const spy = vi.fn().mockResolvedValue(
			jsonResponse< GraphPayload >( {
				nodes: [],
				edges: [],
				stats: { nodes: 0, edges: 0, generated_at: 0 },
			} ),
		);
		global.fetch = spy as unknown as typeof fetch;

		await fetchGraph( cfg, [ 'post' ] );

		const url = new URL( spy.mock.calls[ 0 ][ 0 ] as string );
		expect( url.searchParams.get( 'types' ) ).toBe( 'post' );
		expect( url.searchParams.has( 'edges' ) ).toBe( false );
		expect( url.searchParams.has( 'taxonomies' ) ).toBe( false );
	} );

	test( 'fetchGraph parses node terms and edge kinds into typed shapes', async () => {
		const payload: GraphPayload = {
			nodes: [
				{
					id: 1,
					type: 'post',
					title: 'Hello',
					status: 'publish',
					slug: 'hello',
					edit_url: '',
					terms: { category: [ 7, 9 ], post_tag: [ 12 ] },
				},
				{
					id: 2,
					type: 'post',
					title: 'World',
					status: 'publish',
					slug: 'world',
					edit_url: '',
					terms: {},
				},
			],
			edges: [
				{ from: 1, to: 2, kind: 'link' },
				{ from: 1, to: 2, kind: 'co_tag' },
			],
			stats: { nodes: 2, edges: 2, generated_at: 0 },
		};
		global.fetch = vi
			.fn()
			.mockResolvedValue( jsonResponse( payload ) ) as unknown as typeof fetch;

		const got = await fetchGraph( cfg, [ 'post' ], [ 'link', 'co_tag' ], [ 'category', 'post_tag' ] );

		// Per-node terms parses cleanly into the typed Record.
		expect( got.nodes[ 0 ].terms.category ).toEqual( [ 7, 9 ] );
		expect( got.nodes[ 0 ].terms.post_tag ).toEqual( [ 12 ] );
		// Empty `terms: {}` parses without ceremony — consumers don't have
		// to null-check.
		expect( got.nodes[ 1 ].terms ).toEqual( {} );
		// Edge kinds round-trip through the discriminated union.
		expect( got.edges[ 0 ].kind ).toBe( 'link' );
		expect( got.edges[ 1 ].kind ).toBe( 'co_tag' );
	} );

	test( 'fetchPrefs returns the typed prefs shape', async () => {
		const prefs: ContentGraphPrefs = {
			lens: 'galaxy',
			byLens: {
				constellation: { types: [], edges: [ 'link' ] },
				galaxy: {
					types: [ 'post' ],
					edges: [ 'link', 'co_tag', 'co_author' ],
					taxonomy: 'post_tag',
				},
			},
		};
		global.fetch = vi
			.fn()
			.mockResolvedValue( jsonResponse( prefs ) ) as unknown as typeof fetch;

		const got = await fetchPrefs( cfg );
		expect( got ).toEqual( prefs );
	} );

	test( 'savePrefs POSTs the patch wrapped in a `preferences` envelope', async () => {
		const merged: ContentGraphPrefs = {
			lens: 'galaxy',
			byLens: {
				constellation: { types: [], edges: [ 'link' ] },
				galaxy: {
					types: [],
					edges: [ 'link', 'co_tag' ],
					taxonomy: 'post_tag',
				},
			},
		};
		const spy = vi.fn().mockResolvedValue( jsonResponse( merged ) );
		global.fetch = spy as unknown as typeof fetch;

		const got = await savePrefs( cfg, {
			byLens: {
				...merged.byLens,
				galaxy: { ...merged.byLens.galaxy, taxonomy: 'post_tag' },
			},
		} );

		expect( got ).toEqual( merged );
		const init = spy.mock.calls[ 0 ][ 1 ] as RequestInit;
		expect( init.method ).toBe( 'POST' );
		const body = JSON.parse( init.body as string );
		expect( body ).toHaveProperty( 'preferences' );
		expect( body.preferences.byLens.galaxy.taxonomy ).toBe( 'post_tag' );
	} );

	test( 'fetchPrefs surfaces non-2xx responses as errors', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValue( new Response( 'no', { status: 401 } ) ) as unknown as typeof fetch;
		await expect( fetchPrefs( cfg ) ).rejects.toThrow( /preferences:.*401/ );
	} );

	test( 'savePrefs surfaces non-2xx responses as errors', async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValue( new Response( 'nope', { status: 403 } ) ) as unknown as typeof fetch;
		await expect( savePrefs( cfg, { lens: 'galaxy' } ) ).rejects.toThrow(
			/preferences POST:.*403/,
		);
	} );
} );
