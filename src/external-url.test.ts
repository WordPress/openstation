/**
 * Tests for the cross-origin URL opener helper. Covers the dock-click
 * / desktop-icon failure mode that surfaced on WordPress.com — admin
 * menu entries like "Hosting" and "Upgrades" point at
 * `wordpress.com/...` URLs cross-origin to the wp-admin host, and used
 * to land the iframe on `about:blank`.
 *
 * The helper compares against `window.location.origin`, so the tests
 * run with jsdom's default origin (`http://localhost`) and use that
 * value where they need a same-origin URL.
 */

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
		// The bug shipped on every wpcomstaging.com wp-admin: the
		// admin menu items WP.com injects ("Hosting", "Upgrades") point
		// at `https://wordpress.com/...` URLs, which are cross-origin to
		// the wp-admin host. The dock's iframe path's same-origin
		// guard (`withChromelessParam`) returned null, and the iframe
		// fell through to `about:blank`. Helper now intercepts.
		expect(
			tryOpenExternalUrl( 'https://wordpress.com/plans/foo' ),
		).toBe( true );
		expect( spy ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'returns false for unparseable URLs', () => {
		const spy = vi.fn();
		window.open = spy as unknown as typeof window.open;
		// `new URL('://broken', base)` throws — the helper swallows
		// the error and lets the caller fall through to its own
		// error path (the iframe opener) rather than silently
		// short-circuiting.
		expect( tryOpenExternalUrl( '://broken' ) ).toBe( false );
		expect( spy ).not.toHaveBeenCalled();
	} );
} );
