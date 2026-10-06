/**
 * The Share button hands out a window's URL to someone else. What it
 * must never hand out is the sender's session: `desktop_mode_classic`
 * would open the recipient in classic wp-admin, `openstation_chromeless`
 * would strip the page's admin chrome, and a nonce belongs to the
 * sender's login.
 */

import { describe, expect, it } from 'vitest';

import { shareableUrl } from '../../src/share-url';

const ORIGIN = 'https://example.test';

describe( 'shareableUrl', () => {
	it( 'drops the shell flags and nonces, keeping the page and its hash', () => {
		expect(
			shareableUrl(
				`${ ORIGIN }/wp-admin/post.php?post=12&openstation_chromeless=1&action=edit&desktop_mode_classic=1&_wpnonce=abc#comments`,
				ORIGIN,
			),
		).toBe( `${ ORIGIN }/wp-admin/post.php?post=12&action=edit#comments` );
	} );

	it( 'has nothing to share for another origin or the shell screen itself', () => {
		expect( shareableUrl( 'https://elsewhere.test/page', ORIGIN ) ).toBeNull();
		expect(
			shareableUrl( `${ ORIGIN }/wp-admin/admin.php?page=openstation`, ORIGIN ),
		).toBeNull();
	} );
} );
