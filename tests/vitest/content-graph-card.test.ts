/**
 * Content Graph — node card copy contract.
 *
 * The scene measures and paints cards with Pixi; the copy rules live
 * in `card.ts` and are pinned here: the title cap, the entity
 * decoding, the meta line's parts and order, and the status naming.
 */

import { describe, expect, test } from 'vitest';
import {
	CARD_META_SEPARATOR,
	CARD_TITLE_MAX_CHARS,
	cardMetaParts,
	cardTitle,
	formatYearMonth,
	joinMeta,
	statusLabel,
	truncate,
} from '../../src/content-graph/card';

describe( 'cardTitle', () => {
	test( 'decodes entities the REST payload leaves encoded', () => {
		expect( cardTitle( 'Tom &amp; Jerry &#8211; a review', 7 ) ).toBe(
			'Tom & Jerry – a review',
		);
	} );

	test( 'falls back to the post id for an untitled post', () => {
		expect( cardTitle( '', 42 ) ).toBe( '#42' );
	} );

	test( 'caps very long titles with an ellipsis', () => {
		const long = 'word '.repeat( 40 ).trim();
		const out = cardTitle( long, 1 );
		expect( out.length ).toBeLessThanOrEqual( CARD_TITLE_MAX_CHARS );
		expect( out.endsWith( '…' ) ).toBe( true );
	} );

	test( 'leaves a title under the cap alone', () => {
		expect( cardTitle( 'Hello world', 1 ) ).toBe( 'Hello world' );
	} );
} );

describe( 'truncate', () => {
	test( 'trims trailing whitespace before the ellipsis', () => {
		expect( truncate( 'abc def', 5 ) ).toBe( 'abc…' );
	} );
} );

describe( 'cardMetaParts', () => {
	test( 'type, author and month, in that order', () => {
		const parts = cardMetaParts( {
			typeLabel: 'Post',
			author: 'Alice Example',
			yearMonth: '2026-03',
			status: 'publish',
		} );
		expect( parts ).toEqual( [ 'Post', 'Alice Example', formatYearMonth( '2026-03' ) ] );
	} );

	test( 'published posts carry no status word', () => {
		expect(
			cardMetaParts( { typeLabel: 'Page', status: 'publish' } ),
		).toEqual( [ 'Page' ] );
	} );

	test( 'a non-public status leads the line', () => {
		expect(
			cardMetaParts( { typeLabel: 'Post', status: 'private' } ),
		).toEqual( [ 'Private', 'Post' ] );
	} );

	test( 'skips an unknown author and a missing date', () => {
		expect(
			cardMetaParts( { typeLabel: 'Post', yearMonth: '' } ),
		).toEqual( [ 'Post' ] );
	} );

	test( 'joins with the same separator the status line uses', () => {
		expect( joinMeta( [ 'a', 'b' ] ) ).toBe( `a${ CARD_META_SEPARATOR }b` );
		expect( CARD_META_SEPARATOR ).toBe( ' · ' );
	} );
} );

describe( 'statusLabel', () => {
	test( 'names the core non-public statuses and nothing else', () => {
		expect( statusLabel( 'private' ) ).toBe( 'Private' );
		expect( statusLabel( 'draft' ) ).toBe( 'Draft' );
		expect( statusLabel( 'pending' ) ).toBe( 'Pending' );
		expect( statusLabel( 'future' ) ).toBe( 'Scheduled' );
		expect( statusLabel( 'publish' ) ).toBe( '' );
		expect( statusLabel( 'whatever' ) ).toBe( '' );
	} );
} );

describe( 'formatYearMonth', () => {
	test( 'formats a YYYY-MM token as a short month and year', () => {
		const out = formatYearMonth( '2024-03' );
		expect( out ).toMatch( /2024/ );
		expect( out ).not.toBe( '2024-03' );
	} );

	test( 'returns anything else untouched', () => {
		expect( formatYearMonth( '' ) ).toBe( '' );
		expect( formatYearMonth( 'unknown' ) ).toBe( 'unknown' );
		expect( formatYearMonth( '2024-13' ) ).toBe( '2024-13' );
	} );
} );
