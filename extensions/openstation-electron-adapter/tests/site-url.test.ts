import { describe, expect, test } from 'vitest';

import {
	isLoopbackUrl,
	isSameSiteUrl,
	navigationVerdict,
	normalizeSiteUrl,
	settledSiteUrl,
	shellEntryUrl,
} from '../app/src/lib/site-url';

describe( 'normalizeSiteUrl', () => {
	test( 'keeps an explicit scheme', () => {
		expect( normalizeSiteUrl( 'http://localhost:8889' ) ).toBe(
			'http://localhost:8889',
		);
	} );

	test( 'assumes https for a bare hostname', () => {

		expect( normalizeSiteUrl( 'example.com' ) ).toBe( 'https://example.com' );
	} );

	test( 'trims trailing slashes', () => {
		expect( normalizeSiteUrl( 'https://example.com/' ) ).toBe(
			'https://example.com',
		);
		expect( normalizeSiteUrl( 'https://example.com///' ) ).toBe(
			'https://example.com',
		);
	} );

	test( 'trims a pasted admin URL back to the site root', () => {
		expect(
			normalizeSiteUrl( 'https://example.com/wp-admin/edit.php?post_type=page' ),
		).toBe( 'https://example.com' );
		expect( normalizeSiteUrl( 'https://example.com/wp-login.php' ) ).toBe(
			'https://example.com',
		);
		expect( normalizeSiteUrl( 'https://example.com/openstation/' ) ).toBe(
			'https://example.com',
		);
	} );

	test( 'preserves a subdirectory install', () => {
		expect( normalizeSiteUrl( 'https://example.com/blog/wp-admin/' ) ).toBe(
			'https://example.com/blog',
		);
	} );

	test( 'drops a query string and a fragment', () => {
		expect( normalizeSiteUrl( 'https://example.com/?utm=x#top' ) ).toBe(
			'https://example.com',
		);
	} );

	test( 'ignores surrounding whitespace', () => {
		expect( normalizeSiteUrl( '  https://example.com  ' ) ).toBe(
			'https://example.com',
		);
	} );

	test( 'rejects what cannot be a site', () => {
		expect( normalizeSiteUrl( '' ) ).toBe( '' );
		expect( normalizeSiteUrl( '   ' ) ).toBe( '' );
		expect( normalizeSiteUrl( 'not a url' ) ).toBe( '' );
	} );
} );

describe( 'shellEntryUrl', () => {
	test( 'points at the portal, not wp-admin', () => {

		expect( shellEntryUrl( 'https://example.com' ) ).toBe(
			'https://example.com/openstation/',
		);
	} );

	test( 'tolerates a trailing slash on the stored site', () => {
		expect( shellEntryUrl( 'https://example.com/' ) ).toBe(
			'https://example.com/openstation/',
		);
	} );

	test( 'is empty when no site is configured', () => {
		expect( shellEntryUrl( '' ) ).toBe( '' );
	} );
} );

describe( 'isSameSiteUrl', () => {
	const site = 'https://example.com';

	test( 'accepts a URL on the connected site', () => {
		expect(
			isSameSiteUrl( 'https://example.com/wp-admin/edit.php', site ),
		).toBe( true );
	} );

	test( 'rejects another host', () => {

		expect( isSameSiteUrl( 'https://evil.test/', site ) ).toBe( false );
	} );

	test( 'rejects a scheme downgrade', () => {
		expect( isSameSiteUrl( 'http://example.com/', site ) ).toBe( false );
	} );

	test( 'rejects non-http schemes outright', () => {
		expect( isSameSiteUrl( 'file:///etc/passwd', site ) ).toBe( false );
		expect( isSameSiteUrl( 'javascript:alert(1)', site ) ).toBe( false );
	} );

	test( 'rejects everything when no site is configured', () => {
		expect( isSameSiteUrl( 'https://example.com/', '' ) ).toBe( false );
	} );

	test( 'distinguishes a look-alike host', () => {
		expect( isSameSiteUrl( 'https://example.com.evil.test/', site ) ).toBe(
			false,
		);
	} );
} );

describe( 'navigationVerdict', () => {
	const site = 'https://example.com';

	test( 'lets the window move around its own site', () => {
		expect(
			navigationVerdict( 'https://example.com/wp-admin/edit.php', site ),
		).toBe( 'allow' );
	} );

	test( 'sends an off-site link to the browser', () => {

		expect( navigationVerdict( 'https://wordpress.org/', site ) ).toBe(
			'external',
		);
	} );

	test( 'refuses to follow a scheme that is not the web', () => {

		for ( const url of [
			'file:///etc/passwd',
			'data:text/html,<script>1</script>',
			'javascript:alert(1)',
			'about:blank',
			'',
		] ) {
			expect( navigationVerdict( url, site ) ).toBe( 'block' );
		}
	} );

	test( 'holds the line before a site is configured', () => {

		expect( navigationVerdict( 'https://example.com/', '' ) ).toBe(
			'external',
		);
	} );

	test( 'treats a look-alike host and a scheme downgrade as off-site', () => {
		expect(
			navigationVerdict( 'https://example.com.evil.test/', site ),
		).toBe( 'external' );
		expect( navigationVerdict( 'http://example.com/', site ) ).toBe(
			'external',
		);
	} );
} );

describe( 'settledSiteUrl', () => {

	test( 'adopts the www form of the host that was typed', () => {
		expect(
			settledSiteUrl( 'https://www.example.com/openstation/', 'https://example.com' ),
		).toBe( 'https://www.example.com' );
	} );

	test( 'adopts the apex when a www address redirects down to it', () => {
		expect(
			settledSiteUrl( 'https://example.com/openstation/', 'https://www.example.com' ),
		).toBe( 'https://example.com' );
	} );

	test( 'adopts an HTTPS upgrade — scheme and port may move, the name may not', () => {
		expect(
			settledSiteUrl( 'https://example.com/openstation/', 'http://example.com' ),
		).toBe( 'https://example.com' );
		expect(
			settledSiteUrl( 'https://example.com:8443/openstation/', 'http://example.com:8889' ),
		).toBe( 'https://example.com:8443' );
	} );

	test( 'holds a multi-label host together', () => {
		expect(
			settledSiteUrl( 'https://www.example.co.uk/', 'https://example.co.uk' ),
		).toBe( 'https://www.example.co.uk' );
	} );

	test( 'refuses a chain that walked somewhere else', () => {

		for ( const landed of [
			'https://attacker.example/openstation/',
			'https://example.com.attacker.example/',
			'https://notexample.com/',
			'file:///etc/passwd',
			'',
		] ) {
			expect( settledSiteUrl( landed, 'https://example.com' ) ).toBe( '' );
		}
	} );

	test( 'refuses everything when there was no configured site', () => {
		expect( settledSiteUrl( 'https://example.com/', '' ) ).toBe( '' );
	} );
} );

describe( 'isLoopbackUrl', () => {
	test( 'recognises this machine by any of its names', () => {
		for ( const url of [
			'http://localhost:8889/',
			'https://127.0.0.1/',
			'http://[::1]:8080/',
			'http://openstation.localhost/',
		] ) {
			expect( isLoopbackUrl( url ) ).toBe( true );
		}
	} );

	test( 'is not fooled by a host that merely mentions it', () => {
		for ( const url of [
			'https://localhost.attacker.example/',
			'https://notlocalhost/',
			'https://example.com/localhost',
			'',
		] ) {
			expect( isLoopbackUrl( url ) ).toBe( false );
		}
	} );
} );
