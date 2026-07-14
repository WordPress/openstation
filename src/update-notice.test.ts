/**
 * Tests for `maybeShowUpdate()` — the async core-update notification
 * picker — and `updateMessage()`. `showToast` / `showReleaseCard` are
 * mocked; the art resolver + image preloader are injected as fakes so we
 * assert which surface is chosen without touching the network.
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

const ART = { name: 'Armstrong', artUrl: 'https://example.com/7.0.png' };
const resolveArt = vi.fn(
	async (): Promise< { name: string; artUrl: string } | null > => ART,
);
const loadImage = vi.fn( async () => true );

beforeEach( () => {
	localStorage.clear();
	toastMock.mockClear();
	cardMock.mockClear();
	openUrl.mockClear();
	resolveArt.mockClear().mockResolvedValue( ART );
	loadImage.mockClear().mockResolvedValue( true );
} );
afterEach( () => localStorage.clear() );

describe( 'updateMessage', () => {
	test( 'includes the codename when given one', () => {
		expect( updateMessage( '7.0', 'Armstrong' ) ).toBe(
			'WordPress 7.0 "Armstrong" is available.',
		);
	} );
	test( 'omits the codename when empty', () => {
		expect( updateMessage( '7.0.1', '' ) ).toBe(
			'WordPress 7.0.1 is available.',
		);
	} );
} );

describe( 'maybeShowUpdate', () => {
	test( 'no-op when there is no pending update', async () => {
		await maybeShowUpdate( { update: null, openUrl, resolveArt, loadImage } );
		await maybeShowUpdate( { update: { version: '', url: '/x' }, openUrl, resolveArt, loadImage } );
		expect( toastMock ).not.toHaveBeenCalled();
		expect( cardMock ).not.toHaveBeenCalled();
		expect( resolveArt ).not.toHaveBeenCalled();
	} );

	test( 'art resolves + loads → vinyl, codename shown when crossing', async () => {
		await maybeShowUpdate( {
			update: { version: '7.0', branch: '7.0', url: '/u', crossing: true },
			openUrl, resolveArt, loadImage,
		} );
		expect( toastMock ).not.toHaveBeenCalled();
		expect( resolveArt ).toHaveBeenCalledWith( '7.0' );
		const c = lastCard();
		expect( c.version ).toBe( '7.0' );
		expect( c.name ).toBe( 'Armstrong' );
		expect( c.artUrl ).toBe( ART.artUrl );
		expect( c.dismissKey ).toBe( 'desktop-mode/core-update:7.0' );
	} );

	test( 'same-branch minor → vinyl, exact version, no codename', async () => {
		await maybeShowUpdate( {
			update: { version: '7.0.1', branch: '7.0', url: '/u', crossing: false },
			openUrl, resolveArt, loadImage,
		} );
		const c = lastCard();
		expect( c.version ).toBe( '7.0.1' );
		expect( c.name ).toBe( '' ); // not crossing → no codename
	} );

	test( 'no art → plain toast (no temporary flash: toast only when art is unavailable)', async () => {
		resolveArt.mockResolvedValue( null );
		await maybeShowUpdate( {
			update: { version: '7.0', branch: '7.0', url: '/u', crossing: true },
			openUrl, resolveArt, loadImage,
		} );
		expect( cardMock ).not.toHaveBeenCalled();
		expect( lastToast().message ).toBe( 'WordPress 7.0 is available.' );
		expect( lastToast().persistent ).toBe( true );
	} );

	test( 'art resolves but image fails to load → toast fallback', async () => {
		loadImage.mockResolvedValue( false );
		await maybeShowUpdate( {
			update: { version: '7.0', branch: '7.0', url: '/u', crossing: true },
			openUrl, resolveArt, loadImage,
		} );
		expect( cardMock ).not.toHaveBeenCalled();
		expect( toastMock ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'skips (and never fetches) when the release was already dismissed', async () => {
		markNoticeDismissed( 'desktop-mode/core-update:7.0' );
		await maybeShowUpdate( {
			update: { version: '7.0', branch: '7.0', url: '/u', crossing: true },
			openUrl, resolveArt, loadImage,
		} );
		expect( cardMock ).not.toHaveBeenCalled();
		expect( toastMock ).not.toHaveBeenCalled();
		expect( resolveArt ).not.toHaveBeenCalled();
	} );

	test( 'both surfaces open the update screen', async () => {
		await maybeShowUpdate( {
			update: { version: '7.0', branch: '7.0', url: '/wp-admin/update-core.php', crossing: true },
			openUrl, resolveArt, loadImage,
		} );
		lastCard().onUpdate();
		expect( openUrl.mock.calls[ 0 ][ 0 ].url ).toBe( '/wp-admin/update-core.php' );

		openUrl.mockClear();
		resolveArt.mockResolvedValue( null );
		await maybeShowUpdate( {
			update: { version: '7.0.1', branch: '7.0', url: '/wp-admin/update-core.php', crossing: false },
			openUrl, resolveArt, loadImage,
		} );
		lastToast().action!.onClick();
		expect( openUrl.mock.calls[ 0 ][ 0 ].url ).toBe( '/wp-admin/update-core.php' );
	} );
} );
