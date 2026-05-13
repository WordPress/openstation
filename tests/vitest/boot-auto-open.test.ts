/**
 * Boot flow: should-auto-open decision matrix.
 *
 * Regression for the "Edit Post in admin bar opens nothing" bug — the
 * portal-redirect-with-target case used to be indistinguishable from
 * a bare `/desktop-mode/` visit, so users with a saved session lost
 * the URL they clicked. The intent flag splits the two; this test
 * locks the matrix in place.
 */

import { describe, expect, it } from 'vitest';

import { shouldAutoOpenCurrentPage } from '../../src/boot/auto-open';

describe( 'shouldAutoOpenCurrentPage', () => {
	it( 'opens when not from the portal (direct admin URL)', () => {
		expect(
			shouldAutoOpenCurrentPage( {
				fromPortal: false,
				hasSession: true,
				defaultEnabled: true,
				isNativeDefault: false,
			} ),
		).toBe( true );
	} );

	it( 'opens when portal redirect carried user intent, even with a saved session', () => {
		// The bug. Without `fromPortalIntent`, this would suppress.
		expect(
			shouldAutoOpenCurrentPage( {
				fromPortal: true,
				fromPortalIntent: true,
				hasSession: true,
				defaultEnabled: true,
				isNativeDefault: false,
			} ),
		).toBe( true );
	} );

	it( 'opens when portal redirect carried intent and the default is native', () => {
		expect(
			shouldAutoOpenCurrentPage( {
				fromPortal: true,
				fromPortalIntent: true,
				hasSession: false,
				defaultEnabled: true,
				isNativeDefault: true,
			} ),
		).toBe( true );
	} );

	it( 'suppresses on a bare portal visit when a session is already saved', () => {
		expect(
			shouldAutoOpenCurrentPage( {
				fromPortal: true,
				fromPortalIntent: false,
				hasSession: true,
				defaultEnabled: true,
				isNativeDefault: false,
			} ),
		).toBe( false );
	} );

	it( 'suppresses on a bare portal visit when the default window is disabled', () => {
		expect(
			shouldAutoOpenCurrentPage( {
				fromPortal: true,
				fromPortalIntent: false,
				hasSession: false,
				defaultEnabled: false,
				isNativeDefault: false,
			} ),
		).toBe( false );
	} );

	it( 'suppresses on a bare portal visit when the default is a native window', () => {
		// The shell opens the native default through `nativeWindows.openById`
		// after the manager/registry are wired — auto-open would race it
		// to an admin URL that isn't the user's choice.
		expect(
			shouldAutoOpenCurrentPage( {
				fromPortal: true,
				fromPortalIntent: false,
				hasSession: false,
				defaultEnabled: true,
				isNativeDefault: true,
			} ),
		).toBe( false );
	} );

	it( 'opens on a bare portal visit when there is no session and the default is a normal URL', () => {
		expect(
			shouldAutoOpenCurrentPage( {
				fromPortal: true,
				fromPortalIntent: false,
				hasSession: false,
				defaultEnabled: true,
				isNativeDefault: false,
			} ),
		).toBe( true );
	} );

	it( 'treats an undefined intent flag as falsy (older payloads)', () => {
		// Pre-0.8.4 payloads omit `fromPortalIntent` entirely; behaviour
		// must match the previous "suppress on session" rule so an
		// upgrade-in-flight doesn't regress.
		expect(
			shouldAutoOpenCurrentPage( {
				fromPortal: true,
				hasSession: true,
				defaultEnabled: true,
				isNativeDefault: false,
			} ),
		).toBe( false );
	} );
} );
