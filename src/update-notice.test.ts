/**
 * Tests for `maybeShowUpdate()` — the core-update notification picker.
 * `showToast` and `showReleaseCard` are mocked so we assert which
 * surface is chosen and drive the action callbacks directly.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { maybeShowUpdate } from './update-notice';
import { showToast, type ToastOptions } from './toast';
import { showReleaseCard, type ReleaseCardOptions } from './release-card';

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

const RELEASE = {
	name: 'Armstrong',
	artUrl: '/wp-content/plugins/desktop-mode/assets/releases/7.0.jpg',
	accent: '#ef5a3c',
	accentInk: '#171717',
};

beforeEach( () => {
	toastMock.mockClear();
	cardMock.mockClear();
	openUrl.mockClear();
} );

describe( 'maybeShowUpdate', () => {
	test( 'no-op when there is no pending update', () => {
		maybeShowUpdate( { update: null, openUrl } );
		maybeShowUpdate( { update: undefined, openUrl } );
		maybeShowUpdate( { update: { version: '', url: '/x' }, openUrl } );
		maybeShowUpdate( { update: { version: '7.0.2', url: '' }, openUrl } );
		expect( toastMock ).not.toHaveBeenCalled();
		expect( cardMock ).not.toHaveBeenCalled();
	} );

	test( 'minor release → plain persistent toast, not the vinyl', () => {
		maybeShowUpdate( {
			update: { version: '7.0.2', url: '/u', major: false },
			openUrl,
		} );
		expect( cardMock ).not.toHaveBeenCalled();
		expect( toastMock ).toHaveBeenCalledTimes( 1 );
		const opts = lastToast();
		expect( opts.persistent ).toBe( true );
		expect( opts.message ).toContain( '7.0.2' );
	} );

	test( 'major release with art → the vinyl release card', () => {
		maybeShowUpdate( {
			update: { version: '7.0', url: '/u', major: true, release: RELEASE },
			openUrl,
		} );
		expect( toastMock ).not.toHaveBeenCalled();
		expect( cardMock ).toHaveBeenCalledTimes( 1 );
		const opts = lastCard();
		expect( opts.version ).toBe( '7.0' );
		expect( opts.name ).toBe( 'Armstrong' );
		expect( opts.artUrl ).toBe( RELEASE.artUrl );
		expect( opts.accent ).toBe( '#ef5a3c' );
		expect( opts.accentInk ).toBe( '#171717' );
	} );

	test( 'major release WITHOUT art → falls back to the toast', () => {
		maybeShowUpdate( {
			update: { version: '7.0', url: '/u', major: true, release: null },
			openUrl,
		} );
		expect( cardMock ).not.toHaveBeenCalled();
		expect( toastMock ).toHaveBeenCalledTimes( 1 );
	} );

	test( "the release card's Update action opens the update screen", () => {
		maybeShowUpdate( {
			update: { version: '7.0', url: '/wp-admin/update-core.php', major: true, release: RELEASE },
			openUrl,
		} );
		lastCard().onUpdate();
		expect( openUrl ).toHaveBeenCalledTimes( 1 );
		expect( openUrl.mock.calls[ 0 ][ 0 ].url ).toBe( '/wp-admin/update-core.php' );
		expect( typeof openUrl.mock.calls[ 0 ][ 0 ].title ).toBe( 'string' );
	} );

	test( "the toast's Update action opens the update screen", () => {
		maybeShowUpdate( { update: { version: '7.0.2', url: '/wp-admin/update-core.php' }, openUrl } );
		lastToast().action!.onClick();
		expect( openUrl ).toHaveBeenCalledTimes( 1 );
		expect( openUrl.mock.calls[ 0 ][ 0 ].url ).toBe( '/wp-admin/update-core.php' );
	} );
} );
