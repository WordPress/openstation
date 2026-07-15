/**
 * Tests for `maybeShowCoreNotices()` — the shell surfacing of the server's
 * `coreNotices`. `showToast` is mocked so we assert what gets rendered without
 * touching the DOM.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { maybeShowCoreNotices, type CoreNotice } from './core-notices';
import { showToast, type ToastOptions } from './toast';
import {
	markNoticeDismissed,
	isNoticeDismissed,
} from './ui/components/wpd-notice/storage';

vi.mock( './toast', () => ( { showToast: vi.fn() } ) );

const toastMock = showToast as unknown as ReturnType< typeof vi.fn >;
const openUrl = vi.fn();

function toastAt( i: number ): ToastOptions {
	return toastMock.mock.calls[ i ][ 0 ] as ToastOptions;
}
function lastToast(): ToastOptions {
	return toastAt( toastMock.mock.calls.length - 1 );
}

beforeEach( () => {
	localStorage.clear();
	toastMock.mockClear();
	openUrl.mockClear();
} );
afterEach( () => localStorage.clear() );

const NOTICE: CoreNotice = {
	id: 'maintenance',
	message: 'An automated WordPress update failed to complete.',
	actionLabel: 'Retry update',
	actionUrl: '/wp-admin/update-core.php',
	dismissible: false,
};

describe( 'maybeShowCoreNotices', () => {
	test( 'no-op when notices is absent or not an array', () => {
		maybeShowCoreNotices( { notices: undefined, openUrl } );
		expect( toastMock ).not.toHaveBeenCalled();
	} );

	test( 'shows one persistent toast per notice', () => {
		maybeShowCoreNotices( {
			notices: [
				NOTICE,
				{ id: 'recovery-mode', message: 'You are in recovery mode.' },
			],
			openUrl,
		} );
		expect( toastMock ).toHaveBeenCalledTimes( 2 );
		expect( toastAt( 0 ).message ).toBe( NOTICE.message );
		expect( toastAt( 0 ).persistent ).toBe( true );
	} );

	test( 'wires the action to openUrl', () => {
		maybeShowCoreNotices( { notices: [ NOTICE ], openUrl } );
		lastToast().action!.onClick();
		expect( openUrl ).toHaveBeenCalledWith( {
			url: '/wp-admin/update-core.php',
			title: 'Retry update',
		} );
	} );

	test( 'a notice without a full action has no action button', () => {
		maybeShowCoreNotices( {
			notices: [ { id: 'x', message: 'msg', actionLabel: 'Go' } ],
			openUrl,
		} );
		expect( lastToast().action ).toBeUndefined();
	} );

	test( 'dismissible notice: toast is dismissible and onDismiss persists', () => {
		maybeShowCoreNotices( {
			notices: [ { ...NOTICE, id: 'default-password', dismissible: true } ],
			openUrl,
		} );
		expect( lastToast().dismissible ).toBe( true );
		expect(
			isNoticeDismissed( 'desktop-mode/core-notice:default-password' ),
		).toBe( false );
		lastToast().onDismiss!();
		expect(
			isNoticeDismissed( 'desktop-mode/core-notice:default-password' ),
		).toBe( true );
	} );

	test( 'skips a dismissible notice that was already dismissed', () => {
		markNoticeDismissed( 'desktop-mode/core-notice:default-password' );
		maybeShowCoreNotices( {
			notices: [ { ...NOTICE, id: 'default-password', dismissible: true } ],
			openUrl,
		} );
		expect( toastMock ).not.toHaveBeenCalled();
	} );

	test( 'a non-dismissible notice always shows, even if its key was marked', () => {
		markNoticeDismissed( 'desktop-mode/core-notice:maintenance' );
		maybeShowCoreNotices( { notices: [ NOTICE ], openUrl } );
		expect( toastMock ).toHaveBeenCalledTimes( 1 );
		expect( lastToast().dismissible ).toBe( false );
	} );

	test( 'skips malformed entries (missing id or message)', () => {
		maybeShowCoreNotices( {
			notices: [
				{ id: '', message: 'no id' } as CoreNotice,
				{ id: 'y', message: '' } as CoreNotice,
				NOTICE,
			],
			openUrl,
		} );
		expect( toastMock ).toHaveBeenCalledTimes( 1 );
		expect( lastToast().message ).toBe( NOTICE.message );
	} );
} );
