/**
 * Tests for the native Posts window's REST glue. The bundle is one
 * thin layer over `fetch()` — the regressions we care about are:
 *   1. Default query args from PHP (`_fields`, `_embed`, `post_type`)
 *      arrive on every request. Forgetting `_embed` collapses the
 *      author/term/featured-media columns into the `Unknown` placeholder.
 *   2. `X-WP-Total` and `X-WP-TotalPages` are parsed off the response
 *      so the footer pager isn't lying about the page count.
 *   3. `WP_Error` JSON is surfaced in the thrown error message — not
 *      the bare HTTP status line — so a "failed to fetch" toast says
 *      what the server actually complained about.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	buildEditPostUrl,
	fetchPosts,
	getConfig,
	trashPost,
} from '../../src/posts-window/rest';
import type { PostsWindowConfig } from '../../src/posts-window/rest';

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	interface Window {
		desktopModeWindowConfig?: Record< string, unknown >;
	}
}

const POSTS_URL = 'http://example.test/wp-json/wp/v2/posts';

function installConfig( over: Partial< PostsWindowConfig > = {} ): void {
	const cfg: PostsWindowConfig = {
		restRoot: 'http://example.test/wp-json/',
		restNonce: 'nonce-1',
		postsUrl: POSTS_URL,
		editPostUrlBase: 'http://example.test/wp-admin/post.php',
		newPostUrl: 'http://example.test/wp-admin/post-new.php',
		usersUrl: 'http://example.test/wp-json/wp/v2/users',
		currentUserId: 1,
		defaultPerPage: 20,
		queryArgs: {
			_embed: 'author,wp:term,wp:featuredmedia',
			_fields: 'id,title,status,date,author,_embedded',
		},
		...over,
	};
	window.desktopModeWindowConfig = window.desktopModeWindowConfig ?? {};
	window.desktopModeWindowConfig[ 'desktop-mode-posts' ] = cfg;
}

function jsonResponse(
	body: unknown,
	headers: Record< string, string > = {},
): Response {
	return new Response( JSON.stringify( body ), {
		status: 200,
		headers: { 'Content-Type': 'application/json', ...headers },
	} );
}

beforeEach( () => {
	installConfig();
} );

afterEach( () => {
	delete window.desktopModeWindowConfig;
	vi.restoreAllMocks();
} );

describe( 'getConfig', () => {
	test( 'throws a useful error when the config blob is missing', () => {
		delete window.desktopModeWindowConfig;
		expect( () => getConfig() ).toThrow( /config blob is missing/ );
	} );

	test( 'returns the config blob for the posts window id', () => {
		const cfg = getConfig();
		expect( cfg.postsUrl ).toBe( POSTS_URL );
		expect( cfg.queryArgs._embed ).toContain( 'author' );
	} );
} );

describe( 'fetchPosts', () => {
	test( 'merges PHP-declared default query args + caller params', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( [], {
				'X-WP-Total': '0',
				'X-WP-TotalPages': '0',
			} ) as never,
		);

		await fetchPosts( {
			page: 2,
			perPage: 50,
			search: 'hello',
			status: 'draft',
			orderby: 'title',
			order: 'asc',
		} );

		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
		const calledUrl = String(
			( fetchMock.mock.calls[ 0 ] as unknown as [ string ] )[ 0 ],
		);
		const url = new URL( calledUrl );
		// Default args (PHP).
		expect( url.searchParams.get( '_embed' ) ).toBe(
			'author,wp:term,wp:featuredmedia',
		);
		expect( url.searchParams.get( '_fields' ) ).toBe(
			'id,title,status,date,author,_embedded',
		);
		// Caller params.
		expect( url.searchParams.get( 'page' ) ).toBe( '2' );
		expect( url.searchParams.get( 'per_page' ) ).toBe( '50' );
		expect( url.searchParams.get( 'search' ) ).toBe( 'hello' );
		expect( url.searchParams.get( 'status' ) ).toBe( 'draft' );
		expect( url.searchParams.get( 'orderby' ) ).toBe( 'title' );
		expect( url.searchParams.get( 'order' ) ).toBe( 'asc' );
	} );

	test( 'sends the WP nonce on every request', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( [], {
				'X-WP-Total': '0',
				'X-WP-TotalPages': '0',
			} ) as never,
		);
		await fetchPosts();
		const init = ( fetchMock.mock.calls[ 0 ] as unknown as [ string, RequestInit ] )[ 1 ];
		const headers = init.headers as Record< string, string >;
		expect( headers[ 'X-WP-Nonce' ] ).toBe( 'nonce-1' );
		expect( init.credentials ).toBe( 'same-origin' );
	} );

	test( 'parses X-WP-Total and X-WP-TotalPages headers', async () => {
		vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( [ { id: 1 } ], {
				'X-WP-Total': '237',
				'X-WP-TotalPages': '12',
			} ) as never,
		);

		const result = await fetchPosts();
		expect( result.items ).toHaveLength( 1 );
		expect( result.total ).toBe( 237 );
		expect( result.totalPages ).toBe( 12 );
	} );

	test( 'falls back to 0 when pagination headers are absent', async () => {
		vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( [] ) as never,
		);
		const result = await fetchPosts();
		expect( result.total ).toBe( 0 );
		expect( result.totalPages ).toBe( 0 );
	} );

	test( 'surfaces WP_Error JSON in the thrown error message', async () => {
		vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			new Response(
				JSON.stringify( {
					code: 'rest_post_invalid_status',
					message: 'Invalid post status.',
				} ),
				{
					status: 400,
					statusText: 'Bad Request',
					headers: { 'Content-Type': 'application/json' },
				},
			) as never,
		);
		await expect( fetchPosts() ).rejects.toThrow( /Invalid post status/ );
	} );

	test( 'falls back to status line on non-JSON error body', async () => {
		vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			new Response( '<html>Something blew up.</html>', {
				status: 500,
				statusText: 'Internal Server Error',
			} ) as never,
		);
		await expect( fetchPosts() ).rejects.toThrow( /500/ );
	} );

	test( 'omits caller params that are falsy (other than status)', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( [] ) as never,
		);
		await fetchPosts( { search: '', status: '' } );
		const calledUrl = String(
			( fetchMock.mock.calls[ 0 ] as unknown as [ string ] )[ 0 ],
		);
		const url = new URL( calledUrl );
		expect( url.searchParams.has( 'search' ) ).toBe( false );
		// `status=any` is the explicit "All" — see the rest.ts comment.
		expect( url.searchParams.get( 'status' ) ).toBe( 'any' );
	} );

	test( 'sends status=any when no status is provided ("All" segment)', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( [] ) as never,
		);
		await fetchPosts();
		const calledUrl = String(
			( fetchMock.mock.calls[ 0 ] as unknown as [ string ] )[ 0 ],
		);
		expect( new URL( calledUrl ).searchParams.get( 'status' ) ).toBe( 'any' );
	} );

	test( 'preserves an explicit status (e.g. trash) over the "any" default', async () => {
		const fetchMock = vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( [] ) as never,
		);
		await fetchPosts( { status: 'trash' } );
		const calledUrl = String(
			( fetchMock.mock.calls[ 0 ] as unknown as [ string ] )[ 0 ],
		);
		expect( new URL( calledUrl ).searchParams.get( 'status' ) ).toBe( 'trash' );
	} );
} );

describe( 'trashPost', () => {
	test( 'returns ok:true on a 200 DELETE', async () => {
		vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			jsonResponse( { id: 42, status: 'trash' } ) as never,
		);
		const result = await trashPost( 42 );
		expect( result.ok ).toBe( true );
		expect( result.id ).toBe( 42 );
	} );

	test( 'returns ok:false with a message on a server error', async () => {
		vi.spyOn( global, 'fetch' as never ).mockResolvedValue(
			new Response(
				JSON.stringify( { message: 'You cannot delete that.' } ),
				{
					status: 403,
					statusText: 'Forbidden',
					headers: { 'Content-Type': 'application/json' },
				},
			) as never,
		);
		const result = await trashPost( 42 );
		expect( result.ok ).toBe( false );
		expect( result.error ).toMatch( /cannot delete/ );
	} );
} );

describe( 'buildEditPostUrl', () => {
	test( 'appends ?post=<id>&action=edit when the base has no query string', () => {
		expect( buildEditPostUrl( 7 ) ).toBe(
			'http://example.test/wp-admin/post.php?post=7&action=edit',
		);
	} );

	test( 'uses & when the base already has a ? in it', () => {
		installConfig( {
			editPostUrlBase: 'http://example.test/wp-admin/post.php?lang=en',
		} );
		expect( buildEditPostUrl( 7 ) ).toBe(
			'http://example.test/wp-admin/post.php?lang=en&post=7&action=edit',
		);
	} );
} );
