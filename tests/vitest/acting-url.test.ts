/**
 * Speculation must never act — and there are two ways to fetch a page
 * ahead of a click.
 *
 * The service worker's speculative documents always refused URLs that
 * do something. The dock's hover prewarming builds a real hidden
 * window and did not: it checked origin and native-URL remapping, then
 * loaded whatever the tile pointed at. A plugin is free to put
 * `admin.php?action=…&_wpnonce=…` behind a menu entry, so hovering it
 * would have performed it. Both paths now share this predicate.
 */

import { describe, expect, it } from 'vitest';
import { actsOnLoad, urlActs } from '../../src/pwa/acting-url';

const at = ( path: string ) => new URL( `https://site.test${ path }` );

describe( 'urlActs', () => {
	it( 'flags every acting query key', () => {
		for ( const query of [
			'action=activate&plugin=foo/foo.php',
			'action2=delete',
			'_wpnonce=abc123',
			'nonce=abc123',
			'delete_all=1',
		] ) {
			expect(
				urlActs( at( `/wp-admin/plugins.php?${ query }` ) ),
				`${ query } acts`,
			).toBe( true );
		}
	} );

	it( 'flags screens that act merely by rendering', () => {
		// `post-new.php` creates an auto-draft the moment it renders.
		expect( urlActs( at( '/wp-admin/post-new.php' ) ) ).toBe( true );
		expect( urlActs( at( '/wp-admin/user-new.php' ) ) ).toBe( true );
		expect( urlActs( at( '/wp-admin/media-new.php' ) ) ).toBe( true );
	} );

	it( 'leaves ordinary screens alone', () => {
		expect( urlActs( at( '/wp-admin/options-general.php' ) ) ).toBe( false );
		expect( urlActs( at( '/wp-admin/edit.php?post_type=page' ) ) ).toBe(
			false,
		);
		expect( urlActs( at( '/wp-admin/upload.php' ) ) ).toBe( false );
	} );

	it( 'reads the filename, not the whole path', () => {
		// A subdirectory install must behave the same…
		expect( urlActs( at( '/blog/wp-admin/post-new.php' ) ) ).toBe( true );
		// …and a directory that merely ends that way must not swallow
		// the page inside it.
		expect( actsOnLoad( '/wp-admin/post-new.php/inner.php' ) ).toBe( false );
	} );
} );
