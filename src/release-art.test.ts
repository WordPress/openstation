/**
 * Tests for the client-side release-art resolver.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { parseReleaseArt, resolveReleaseArt } from './release-art';
import { trackedFetch } from './tracked-fetch';

vi.mock( './tracked-fetch', () => ( { trackedFetch: vi.fn() } ) );
const fetchMock = trackedFetch as unknown as ReturnType< typeof vi.fn >;

function post( title: string, art: string ): unknown {
	const media = art
		? [ { source_url: art, media_details: { sizes: { medium_large: { source_url: art } } } } ]
		: [];
	return {
		title: { rendered: title },
		_embedded: { 'wp:featuredmedia': media },
	};
}

beforeEach( () => {
	localStorage.clear();
	fetchMock.mockReset();
} );
afterEach( () => localStorage.clear() );

describe( 'parseReleaseArt', () => {
	test( 'matches the major announcement (entity-encoded curly quotes) and takes the art', () => {
		const posts = [
			post( 'WordPress 7.0.1 Maintenance Release', 'https://x/maint.png' ),
			post( 'WordPress 7.0 &#8220;Armstrong&#8221;', 'https://i0.wp.com/7.0.png' ),
		];
		const art = parseReleaseArt( posts, '7.0' );
		expect( art ).toEqual( { name: 'Armstrong', artUrl: 'https://i0.wp.com/7.0.png' } );
	} );

	test( 'ignores a maintenance release for the same version prefix', () => {
		const posts = [ post( 'WordPress 7.0.1 Maintenance Release', 'https://x/m.png' ) ];
		expect( parseReleaseArt( posts, '7.0' ) ).toBeNull();
	} );

	test( 'returns null for a non-array / empty result', () => {
		expect( parseReleaseArt( null, '7.0' ) ).toBeNull();
		expect( parseReleaseArt( [], '7.0' ) ).toBeNull();
	} );
} );

describe( 'resolveReleaseArt', () => {
	test( 'fetches, resolves, and caches (second call skips the fetch)', async () => {
		fetchMock.mockResolvedValue( {
			ok: true,
			json: async () => [ post( 'WordPress 7.0 &#8220;Armstrong&#8221;', 'https://i0.wp.com/7.0.png' ) ],
		} );

		const first = await resolveReleaseArt( '7.0' );
		expect( first ).toEqual( { name: 'Armstrong', artUrl: 'https://i0.wp.com/7.0.png' } );
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );

		const second = await resolveReleaseArt( '7.0' );
		expect( second ).toEqual( first );
		expect( fetchMock ).toHaveBeenCalledTimes( 1 ); // served from cache
	} );

	test( 'caches a miss when there is no matching announcement', async () => {
		fetchMock.mockResolvedValue( { ok: true, json: async () => [ post( 'Unrelated', '' ) ] } );

		expect( await resolveReleaseArt( '9.9' ) ).toBeNull();
		// Cached miss → no second fetch.
		expect( await resolveReleaseArt( '9.9' ) ).toBeNull();
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'returns null on a non-ok response', async () => {
		fetchMock.mockResolvedValue( { ok: false, json: async () => [] } );
		expect( await resolveReleaseArt( '7.0' ) ).toBeNull();
	} );
} );
