import { describe, expect, it } from 'vitest';

import { shellUrlWithoutBootArgs } from '../../src/shell-url';

const SHELL = 'https://openstation.blog/wp-admin/admin.php?page=openstation';

describe( 'shellUrlWithoutBootArgs', () => {
	it( 'strips both boot args, keeping the screen itself', () => {
		expect(
			shellUrlWithoutBootArgs(
				`${ SHELL }&target=%2Fwp-admin%2Fadmin.php&intent=1`,
			),
		).toBe( SHELL );
	} );

	it( 'strips a target that arrived without an intent flag', () => {
		expect(
			shellUrlWithoutBootArgs( `${ SHELL }&target=%2Fwp-admin%2Fedit.php` ),
		).toBe( SHELL );
	} );

	it( 'leaves every other arg alone', () => {
		const url = shellUrlWithoutBootArgs(
			`${ SHELL }&target=%2Fwp-admin%2Fedit.php&intent=1&os-debug=1`,
		);
		expect( url ).toBe( `${ SHELL }&os-debug=1` );
	} );

	it( 'returns null when there is nothing to strip', () => {
		expect( shellUrlWithoutBootArgs( SHELL ) ).toBeNull();
	} );

	it( 'returns null off the shell screen, where the names are the page’s own', () => {

		expect(
			shellUrlWithoutBootArgs(
				'https://openstation.blog/wp-admin/edit.php?target=x&intent=1',
			),
		).toBeNull();

		expect(
			shellUrlWithoutBootArgs(
				'https://openstation.blog/wp-admin/admin.php?page=jetpack&intent=1',
			),
		).toBeNull();
	} );

	it( 'returns null for an unparseable URL', () => {
		expect( shellUrlWithoutBootArgs( 'not a url', undefined ) ).toBeNull();
	} );

	it( 'accepts a parsed URL and does not mutate the caller’s copy', () => {
		const parsed = new URL( `${ SHELL }&target=%2Fwp-admin%2Fedit.php` );
		const before = parsed.href;
		expect( shellUrlWithoutBootArgs( parsed ) ).toBe( SHELL );
		expect( parsed.href ).toBe( before );
	} );
} );
