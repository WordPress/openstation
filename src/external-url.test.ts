import { afterEach, describe, expect, test, vi } from 'vitest';

import { tryOpenExternalUrl } from './external-url';

const originalOpen = window.open;
const SAME_ORIGIN = window.location.origin;

afterEach( () => {
	window.open = originalOpen;
	vi.restoreAllMocks();
} );

describe( 'tryOpenExternalUrl', () => {
	test( 'returns false for same-origin absolute URLs', () => {
		const spy = vi.fn();
		window.open = spy as unknown as typeof window.open;
		expect(
			tryOpenExternalUrl( `${ SAME_ORIGIN }/wp-admin/edit.php` ),
		).toBe( false );
		expect( spy ).not.toHaveBeenCalled();
	} );

	test( 'returns false for relative URLs', () => {
		const spy = vi.fn();
		window.open = spy as unknown as typeof window.open;
		expect( tryOpenExternalUrl( 'edit.php' ) ).toBe( false );
		expect( tryOpenExternalUrl( '/wp-admin/upload.php' ) ).toBe(
			false,
		);
		expect( spy ).not.toHaveBeenCalled();
	} );

	test( 'opens cross-origin URLs in a new tab and returns true', () => {
		const spy = vi.fn();
		window.open = spy as unknown as typeof window.open;
		expect(
			tryOpenExternalUrl( 'https://wordpress.com/hosting/foo' ),
		).toBe( true );
		expect( spy ).toHaveBeenCalledWith(
			'https://wordpress.com/hosting/foo',
			'_blank',
			'noopener,noreferrer',
		);
	} );

	test( 'opens different-host URLs in a new tab (regression for WP.com)', () => {
		const spy = vi.fn();
		window.open = spy as unknown as typeof window.open;

		expect(
			tryOpenExternalUrl( 'https://wordpress.com/plans/foo' ),
		).toBe( true );
		expect( spy ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'returns false for unparseable URLs', () => {
		const spy = vi.fn();
		window.open = spy as unknown as typeof window.open;

		expect( tryOpenExternalUrl( '://broken' ) ).toBe( false );
		expect( spy ).not.toHaveBeenCalled();
	} );
} );
