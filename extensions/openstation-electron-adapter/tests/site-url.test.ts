/**
 * Site-address parsing.
 *
 * This is the code that reads whatever a person typed into a first-run
 * text box, and people type a lot of things. Most of these cases are
 * real pastes: someone copies the address bar while sitting in
 * wp-admin, or types a bare hostname, or leaves a trailing slash.
 */

import { describe, expect, test } from 'vitest';

import {
	isSameSiteUrl,
	normalizeSiteUrl,
	shellEntryUrl,
} from '../app/src/lib/site-url';

describe( 'normalizeSiteUrl', () => {
	test( 'keeps an explicit scheme', () => {
		expect( normalizeSiteUrl( 'http://localhost:8889' ) ).toBe(
			'http://localhost:8889',
		);
	} );

	test( 'assumes https for a bare hostname', () => {
		// Typing the scheme is a cheaper price than silently
		// downgrading someone's production site to plain HTTP.
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
		// `/openstation/` signs the user in, turns OpenStation on for
		// their account on first visit, and forwards into whichever
		// window they last had focused. `/wp-admin/` would skip all three.
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
		// Freed windows load URLs chosen by the page, and the page is
		// exactly the thing an attacker might have a foothold in.
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
