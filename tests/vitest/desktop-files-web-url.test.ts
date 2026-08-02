import { describe, expect, test } from 'vitest';
import {
	looksLikeWebUrl,
	normalizeWebUrl,
	urlFromUriList,
} from '../../src/desktop-files/web-url';

describe( 'desktop web URL parsing', () => {
	test.each( [
		[ 'https://example.com/path?q=1', 'https://example.com/path?q=1' ],
		[ 'http://example.com', 'http://example.com/' ],
		[ 'example.com/docs', 'https://example.com/docs' ],
		[ 'localhost:8888/wp-admin', 'https://localhost:8888/wp-admin' ],
	] )( 'normalizes %s', ( input, expected ) => {
		expect( normalizeWebUrl( input ) ).toBe( expected );
	} );

	test.each( [
		'javascript:alert(1)',
		'data:text/html,hello',
		'ftp://example.com',
		'https://user:pass@example.com/',
		'https://user@example.com/',
		'some prose containing https://example.com',
		'https://example.com/\nhttps://example.org/',
	] )( 'rejects unsafe or non-standalone input %s', ( input ) => {
		expect( normalizeWebUrl( input ) ).toBe( '' );
	} );

	test( 'URI lists ignore comments and use only the first entry', () => {
		expect(
			urlFromUriList(
				'# Source: browser\r\n# another comment\r\nhttps://first.example/a\r\nhttps://second.example/',
			),
		).toBe( 'https://first.example/a' );
	} );

	test( 'plain-text intent excludes arbitrary prose', () => {
		expect( looksLikeWebUrl( 'example.com' ) ).toBe( true );
		expect( looksLikeWebUrl( 'https://example.com' ) ).toBe( true );
		expect( looksLikeWebUrl( 'visit example.com tomorrow' ) ).toBe( false );
	} );
} );
