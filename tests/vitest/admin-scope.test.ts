/**
 * The admin-scope rule, pinned against one URL table.
 *
 * Three implementations must agree: `src/admin-scope.ts` (the shell),
 * the inline `adminScope()` in `src/chromeless-bridge.js` (the bridge
 * must stay a self-contained plain script), and PHP's
 * `openstation_admin_scope_of_path()` — whose PHPUnit test
 * (`Tests_OpenStation_Multisite`) asserts THE SAME rows as this
 * table. Change one implementation and this file (or its PHP twin)
 * says which sibling you forgot.
 */

import { describe, expect, test } from 'vitest';
import { adminScopeOf, adminScopeOfUrl } from '../../src/admin-scope';

/**
 * KEEP IN SYNC with `test_admin_scope_of_path_table` in
 * `tests/phpunit/tests/openStationMultisite.php`.
 */
const TABLE: Array< [ string, string ] > = [
	[ '/wp-admin/', '/wp-admin/' ],
	[ '/wp-admin/index.php', '/wp-admin/' ],
	[ '/wp-admin/network/', '/wp-admin/network/' ],
	[ '/wp-admin/network/sites.php', '/wp-admin/network/' ],
	[ '/wp-admin/user/', '/wp-admin/user/' ],
	[ '/wp-admin/user/profile.php', '/wp-admin/user/' ],
	[ '/site2/wp-admin/', '/site2/wp-admin/' ],
	[ '/site2/wp-admin/edit.php', '/site2/wp-admin/' ],
	// `network-tools.php` is a plain file of THIS admin, not the
	// network segment — the segment match requires the slash.
	[ '/wp-admin/network-tools.php', '/wp-admin/' ],
	[ '/site2/wp-admin/network/', '/site2/wp-admin/network/' ],
	[ '/front-page/', '' ],
	[ '/', '' ],
];

describe( 'adminScopeOf', () => {
	test.each( TABLE )( '%s → %s', ( path, scope ) => {
		expect( adminScopeOf( path ) ).toBe( scope );
	} );
} );

describe( 'adminScopeOfUrl', () => {
	const BASE = 'http://example.test/wp-admin/network/';

	test( 'resolves relative and absolute same-origin URLs', () => {
		expect( adminScopeOfUrl( '/site2/wp-admin/index.php', BASE ) ).toBe(
			'/site2/wp-admin/',
		);
		expect(
			adminScopeOfUrl( 'http://example.test/wp-admin/edit.php', BASE ),
		).toBe( '/wp-admin/' );
	} );

	test( 'cross-origin and non-admin URLs have no scope here', () => {
		expect(
			adminScopeOfUrl( 'https://other.test/wp-admin/', BASE ),
		).toBeNull();
		expect( adminScopeOfUrl( '/2026/09/a-post/', BASE ) ).toBeNull();
		expect( adminScopeOfUrl( 'not a url', 'also not one' ) ).toBeNull();
	} );
} );
