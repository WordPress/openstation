/**
 * The question asked once after a switch from another install arrived
 * with a token while this user was logged in: link your account there?
 */

import { describe, expect, test, vi } from 'vitest';
import { offerAccountLink } from '../../src/multisite/link-offer';

const offer = {
	site: 'The Network',
	url: 'https://here.test/wp-json/desktop-mode/v1/network/link',
};

describe( 'offerAccountLink', () => {
	test( 'names only the install, and a yes goes there to confirm', async () => {
		const confirm = vi.fn().mockResolvedValue( true );
		const issuer = 'https://there.test/wp-admin/admin.php?page=openstation&openstation_hop_link=abc';
		const post = vi.fn().mockResolvedValue( { linked: false, url: issuer } );
		const navigate = vi.fn();
		expect( await offerAccountLink( offer, { confirm, post, navigate } ) ).toBe( true );
		const asked = confirm.mock.calls[ 0 ][ 0 ];
		expect( asked.message ).toContain( 'from The Network' );
		expect( asked.message ).toContain( 'pass through The Network' );
		expect( post ).toHaveBeenCalledWith( offer.url, true );
		expect( navigate ).toHaveBeenCalledWith( issuer );
	} );

	test( 'a no is recorded and goes nowhere; neither does a URL that is not http(s)', async () => {
		const navigate = vi.fn();
		const post = vi.fn().mockResolvedValue( { linked: false } );
		expect( await offerAccountLink( offer, { confirm: vi.fn().mockResolvedValue( false ), post, navigate } ) ).toBe( false );
		expect( post ).toHaveBeenCalledWith( offer.url, false );

		// eslint-disable-next-line no-script-url -- asserting the guard.
		const hostile = vi.fn().mockResolvedValue( { url: 'javascript:alert(1)' } );
		await offerAccountLink( offer, { confirm: vi.fn().mockResolvedValue( true ), post: hostile, navigate } );
		expect( navigate ).not.toHaveBeenCalled();
	} );
} );
