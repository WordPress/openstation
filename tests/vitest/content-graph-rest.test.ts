/**
 * Content Graph REST filter contract.
 *
 * The server deliberately distinguishes an omitted `types` query
 * (all registered types) from an explicitly empty one (no types).
 * The client must therefore serialize the parameter even after the
 * final toolbar chip is switched off.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchGraph } from '../../src/content-graph/rest';
import type {
	ContentGraphConfig,
	GraphPayload,
} from '../../src/content-graph/types';

const CFG: ContentGraphConfig = {
	restRoot: 'https://example.test/wp-json/',
	restNonce: 'nonce',
	apiBase: 'https://example.test/wp-json/desktop-mode/v1/content-graph',
	editPostUrl: '',
	editTermUrl: '',
	editUserUrl: '',
	editCommentUrl: '',
	mediaUrl: '',
	postTypes: [],
};

const EMPTY_PAYLOAD: GraphPayload = {
	nodes: [],
	edges: [],
	groups: { authors: {}, categories: {}, tags: {} },
	stats: { nodes: 0, edges: 0, generated_at: 0 },
};

let fetchMock: ReturnType< typeof vi.fn >;

beforeEach( () => {
	fetchMock = vi.fn().mockResolvedValue(
		new Response( JSON.stringify( EMPTY_PAYLOAD ), { status: 200 } ),
	);
	( window as unknown as { wp?: unknown } ).wp = {
		os: { fetch: fetchMock },
	};
} );

afterEach( () => {
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'fetchGraph post-type filtering', () => {
	test( 'sends an explicit empty types parameter when every chip is off', async () => {
		await expect( fetchGraph( CFG, [] ) ).resolves.toEqual( EMPTY_PAYLOAD );

		const url = new URL( fetchMock.mock.calls[ 0 ][ 0 ] as string );
		expect( url.searchParams.has( 'types' ) ).toBe( true );
		expect( url.searchParams.get( 'types' ) ).toBe( '' );
	} );

	test( 'serializes the active type slugs as a comma-separated value', async () => {
		await fetchGraph( CFG, [ 'post', 'page' ] );

		const url = new URL( fetchMock.mock.calls[ 0 ][ 0 ] as string );
		expect( url.searchParams.get( 'types' ) ).toBe( 'post,page' );
	} );
} );
