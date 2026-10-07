import { describe, expect, test, vi } from 'vitest';
import { offerAccountLink } from '../../src/multisite/link-offer';

const offer = {
	site: 'The Network',
	name: 'Visitor',
	email: 'visitor@example.org',
	url: 'https://here.test/wp-json/desktop-mode/v1/network/link',
};

describe( 'offerAccountLink', () => {
	test( 'asks with who and from where, and records a yes', async () => {
		const confirm = vi.fn().mockResolvedValue( true );
		const post = vi.fn().mockResolvedValue( undefined );
		expect( await offerAccountLink( offer, { confirm, post } ) ).toBe( true );
		const asked = confirm.mock.calls[ 0 ][ 0 ];
		expect( asked.message ).toContain( 'Visitor (visitor@example.org)' );
		expect( asked.message ).toContain( 'The Network' );
		expect( asked.confirmLabel ).toBe( 'Link accounts' );
		expect( post ).toHaveBeenCalledWith( offer.url, true );
	} );

	test( 'records a no too, so the same account is not asked about again', async () => {
		const confirm = vi.fn().mockResolvedValue( false );
		const post = vi.fn().mockResolvedValue( undefined );
		expect( await offerAccountLink( offer, { confirm, post } ) ).toBe( false );
		expect( post ).toHaveBeenCalledWith( offer.url, false );
	} );

	test( 'a failed request is not an error: the offer expires on its own', async () => {
		const confirm = vi.fn().mockResolvedValue( true );
		const post = vi.fn().mockRejectedValue( new Error( 'down' ) );
		await expect( offerAccountLink( { ...offer, email: '' }, { confirm, post } ) ).resolves.toBe( true );
		expect( confirm.mock.calls[ 0 ][ 0 ].message ).toContain( 'Visitor just switched' );
	} );
} );
