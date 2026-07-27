/**
 * Pins the contract for `joinRestUrl`.
 *
 * Both permalink shapes must round-trip through the helper without
 * dropping or doubling query separators.
 */
import { describe, expect, test } from 'vitest';
import { joinRestUrl } from '../../src/rest-url';

describe( 'joinRestUrl', () => {
	describe( 'pretty permalinks', () => {
		const root = 'https://site.example/wp-json/';

		test( 'appends a plain path', () => {
			expect( joinRestUrl( root, 'wp/v2/posts' ) ).toBe(
				'https://site.example/wp-json/wp/v2/posts',
			);
		} );

		test( 'strips a leading slash on the path', () => {
			expect( joinRestUrl( root, '/wp/v2/posts' ) ).toBe(
				'https://site.example/wp-json/wp/v2/posts',
			);
		} );

		test( 'preserves a query string on the path', () => {
			expect(
				joinRestUrl( root, 'wp/v2/posts?per_page=10&page=2' ),
			).toBe(
				'https://site.example/wp-json/wp/v2/posts?per_page=10&page=2',
			);
		} );

		test( 'tolerates a missing trailing slash on the root', () => {
			expect(
				joinRestUrl( 'https://site.example/wp-json', 'wp/v2/tags' ),
			).toBe( 'https://site.example/wp-json/wp/v2/tags' );
		} );
	} );

	describe( 'plain permalinks', () => {
		const root = 'https://site.example/index.php?rest_route=/';

		test( 'appends the route to the rest_route query parameter', () => {
			expect( joinRestUrl( root, 'wp/v2/posts' ) ).toBe(
				'https://site.example/index.php?rest_route=%2Fwp%2Fv2%2Fposts',
			);
		} );

		test( 'strips a leading slash on the path', () => {
			expect( joinRestUrl( root, '/wp/v2/posts' ) ).toBe(
				'https://site.example/index.php?rest_route=%2Fwp%2Fv2%2Fposts',
			);
		} );

		test( 'merges a path query string with rest_route', () => {
			const result = joinRestUrl( root, 'wp/v2/posts?per_page=10&page=2' );
			const url = new URL( result );
			expect( url.searchParams.get( 'rest_route' ) ).toBe( '/wp/v2/posts' );
			expect( url.searchParams.get( 'per_page' ) ).toBe( '10' );
			expect( url.searchParams.get( 'page' ) ).toBe( '2' );
		} );

		test( 'handles a rest_route prefix without trailing slash', () => {
			const result = joinRestUrl(
				'https://site.example/index.php?rest_route=/wp',
				'v2/users',
			);
			expect( new URL( result ).searchParams.get( 'rest_route' ) ).toBe(
				'/wp/v2/users',
			);
		} );
	} );

	test( 'resolves a same-origin relative root against window.location', () => {
		const result = joinRestUrl( '/wp-json/', 'wp/v2/posts' );
		const url = new URL( result );
		expect( url.pathname ).toBe( '/wp-json/wp/v2/posts' );
	} );
} );
