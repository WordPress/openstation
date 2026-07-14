/**
 * Tests for `maybeShowUpdate()` — the core-update notification picker —
 * and `updateMessage()`. `showToast` / `showReleaseCard` are mocked so
 * we assert which surface is chosen and with what wording.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { maybeShowUpdate, updateMessage } from './update-notice';
import { showToast, type ToastOptions } from './toast';
import { showReleaseCard, type ReleaseCardOptions } from './release-card';
import { markNoticeDismissed } from './ui/components/wpd-notice/storage';

vi.mock( './toast', () => ( { showToast: vi.fn() } ) );
vi.mock( './release-card', () => ( { showReleaseCard: vi.fn() } ) );

const toastMock = showToast as unknown as ReturnType< typeof vi.fn >;
const cardMock = showReleaseCard as unknown as ReturnType< typeof vi.fn >;
const openUrl = vi.fn();

function lastToast(): ToastOptions {
	return toastMock.mock.calls[ toastMock.mock.calls.length - 1 ][ 0 ] as ToastOptions;
}
function lastCard(): ReleaseCardOptions {
	return cardMock.mock.calls[ cardMock.mock.calls.length - 1 ][ 0 ] as ReleaseCardOptions;
}

const ART = { artUrl: 'https://example.com/7.0.png' };

beforeEach( () => {
	localStorage.clear();
	toastMock.mockClear();
	cardMock.mockClear();
	openUrl.mockClear();
} );
afterEach( () => localStorage.clear() );

describe( 'updateMessage', () => {
	test( 'includes the codename when crossing a major', () => {
		expect( updateMessage( '7.0', 'Armstrong' ) ).toBe(
			'WordPress 7.0 "Armstrong" is available.',
		);
	} );
	test( 'omits the codename for a same-branch minor', () => {
		expect( updateMessage( '7.0.1', '' ) ).toBe(
			'WordPress 7.0.1 is available.',
		);
	} );
} );

describe( 'maybeShowUpdate', () => {
	test( 'no-op when there is no pending update', () => {
		maybeShowUpdate( { update: null, openUrl } );
		maybeShowUpdate( { update: undefined, openUrl } );
		maybeShowUpdate( { update: { version: '', url: '/x' }, openUrl } );
		expect( toastMock ).not.toHaveBeenCalled();
		expect( cardMock ).not.toHaveBeenCalled();
	} );

	// 6.9 → 7.0 (or 7.0.1): crossing a major → vinyl, message shows the
	// major branch + codename.
	test( 'crossing a major with art → vinyl showing branch + codename', () => {
		maybeShowUpdate( {
			update: { version: '7.0', name: 'Armstrong', branch: '7.0', url: '/u', release: ART },
			openUrl,
		} );
		expect( toastMock ).not.toHaveBeenCalled();
		const c = lastCard();
		expect( c.version ).toBe( '7.0' );
		expect( c.name ).toBe( 'Armstrong' );
		expect( c.dismissKey ).toBe( 'desktop-mode/core-update:7.0' );
		expect( c.artUrl ).toBe( ART.artUrl );
		expect( c.accent ).toBeUndefined(); // derived from art
	} );

	// 6.9 → 7.0.1: still crossing 7.0 → message shows "7.0 Armstrong",
	// art is the 7.0 branch art (server sets version=branch, name=codename).
	test( 'crossing to a minor of a new major → shows the major + codename', () => {
		maybeShowUpdate( {
			update: { version: '7.0', name: 'Armstrong', branch: '7.0', url: '/u', release: ART },
			openUrl,
		} );
		expect( lastCard().version ).toBe( '7.0' );
		expect( lastCard().name ).toBe( 'Armstrong' );
	} );

	// 7.0 → 7.0.1: same branch → vinyl still shows (branch art), message
	// is the exact version with no codename.
	test( 'same-branch minor with art → vinyl, exact version, no codename', () => {
		maybeShowUpdate( {
			update: { version: '7.0.1', name: '', branch: '7.0', url: '/u', release: ART },
			openUrl,
		} );
		expect( toastMock ).not.toHaveBeenCalled();
		const c = lastCard();
		expect( c.version ).toBe( '7.0.1' );
		expect( c.name ).toBe( '' );
		expect( c.dismissKey ).toBe( 'desktop-mode/core-update:7.0' );
	} );

	test( 'skips the vinyl when the release was already dismissed', () => {
		markNoticeDismissed( 'desktop-mode/core-update:7.0' );
		maybeShowUpdate( {
			update: { version: '7.0', name: 'Armstrong', branch: '7.0', url: '/u', release: ART },
			openUrl,
		} );
		expect( cardMock ).not.toHaveBeenCalled();
		expect( toastMock ).not.toHaveBeenCalled();
	} );

	test( 'no art → plain toast with the same wording rules', () => {
		maybeShowUpdate( {
			update: { version: '7.0', name: 'Armstrong', branch: '7.0', url: '/u', release: null },
			openUrl,
		} );
		expect( cardMock ).not.toHaveBeenCalled();
		expect( lastToast().message ).toBe( 'WordPress 7.0 "Armstrong" is available.' );

		toastMock.mockClear();
		maybeShowUpdate( { update: { version: '7.0.1', name: '', branch: '7.0', url: '/u' }, openUrl } );
		expect( lastToast().message ).toBe( 'WordPress 7.0.1 is available.' );
	} );

	test( 'an explicit accent override is passed through to the card', () => {
		maybeShowUpdate( {
			update: {
				version: '7.0', name: 'Armstrong', branch: '7.0', url: '/u',
				release: { artUrl: ART.artUrl, accent: '#123456', accentInk: '#fff' },
			},
			openUrl,
		} );
		expect( lastCard().accent ).toBe( '#123456' );
	} );

	test( 'both surfaces open the update screen', () => {
		maybeShowUpdate( { update: { version: '7.0', name: 'Armstrong', branch: '7.0', url: '/wp-admin/update-core.php', release: ART }, openUrl } );
		lastCard().onUpdate();
		expect( openUrl.mock.calls[ 0 ][ 0 ].url ).toBe( '/wp-admin/update-core.php' );

		openUrl.mockClear();
		maybeShowUpdate( { update: { version: '7.0.1', name: '', branch: '7.0', url: '/wp-admin/update-core.php' }, openUrl } );
		lastToast().action!.onClick();
		expect( openUrl.mock.calls[ 0 ][ 0 ].url ).toBe( '/wp-admin/update-core.php' );
	} );
} );
