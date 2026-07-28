/**
 * Tests for `maybeShowNotices()` — the shell surfacing of the server's
 * `coreNotices` / `pluginNotices`. `showToast` is mocked so we assert what
 * gets rendered without touching the DOM.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { maybeShowNotices, type ShellNotice } from './core-notices';
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

const NOTICE: ShellNotice = {
	id: 'maintenance',
	message: 'An automated WordPress update failed to complete.',
	actionLabel: 'Retry update',
	actionUrl: '/wp-admin/update-core.php',
};

describe( 'maybeShowNotices', () => {
	test( 'no-op when notices is absent or not an array', () => {
		maybeShowNotices( { notices: undefined, openUrl } );
		expect( toastMock ).not.toHaveBeenCalled();
	} );

	test( 'shows one persistent, dismissible toast per notice', () => {
		maybeShowNotices( {
			notices: [
				NOTICE,
				{ id: 'recovery-mode', message: 'You are in recovery mode.' },
			],
			openUrl,
		} );
		expect( toastMock ).toHaveBeenCalledTimes( 2 );
		expect( toastAt( 0 ).message ).toBe( NOTICE.message );
		// Every shell notice is persistent + dismissible — never permanent.
		expect( toastAt( 0 ).persistent ).toBe( true );
		expect( toastAt( 0 ).dismissible ).toBe( true );
		expect( toastAt( 1 ).persistent ).toBe( true );
		expect( toastAt( 1 ).dismissible ).toBe( true );
	} );

	test( 'wires the action to openUrl, using the notice title for the window', () => {
		maybeShowNotices( {
			notices: [ { ...NOTICE, title: 'WordPress Updates' } ],
			openUrl,
		} );
		lastToast().action!.onClick();
		expect( openUrl ).toHaveBeenCalledWith( {
			url: '/wp-admin/update-core.php',
			title: 'WordPress Updates', // window title, not the button label
		} );
	} );

	test( 'window title falls back to the action label when no title is given', () => {
		maybeShowNotices( { notices: [ NOTICE ], openUrl } );
		lastToast().action!.onClick();
		expect( openUrl ).toHaveBeenCalledWith( {
			url: '/wp-admin/update-core.php',
			title: 'Retry update',
		} );
	} );

	test( 'a notice without a full action has no action button', () => {
		maybeShowNotices( {
			notices: [ { id: 'x', message: 'msg', actionLabel: 'Go' } ],
			openUrl,
		} );
		expect( lastToast().action ).toBeUndefined();
	} );

	test( 'onDismiss persists the dismissal', () => {
		maybeShowNotices( { notices: [ NOTICE ], openUrl } );
		expect(
			isNoticeDismissed( 'desktop-mode/core-notice:maintenance' ),
		).toBe( false );
		lastToast().onDismiss!();
		expect(
			isNoticeDismissed( 'desktop-mode/core-notice:maintenance' ),
		).toBe( true );
	} );

	test( 'skips a notice that was already dismissed', () => {
		markNoticeDismissed( 'desktop-mode/core-notice:maintenance' );
		maybeShowNotices( { notices: [ NOTICE ], openUrl } );
		expect( toastMock ).not.toHaveBeenCalled();
	} );

	test( 'keyPrefix namespaces the dismissal key (core vs plugin)', () => {
		// A plugin notice dismissed under `plugin-notice:` must not be hidden
		// by a same-id `core-notice:` dismissal, and vice-versa.
		markNoticeDismissed( 'desktop-mode/core-notice:shared' );
		maybeShowNotices( {
			notices: [ { id: 'shared', message: 'plugin' } ],
			openUrl,
			keyPrefix: 'plugin-notice',
		} );
		expect( toastMock ).toHaveBeenCalledTimes( 1 );

		lastToast().onDismiss!();
		expect(
			isNoticeDismissed( 'desktop-mode/plugin-notice:shared' ),
		).toBe( true );
	} );

	test( 'skips malformed entries (missing id or message)', () => {
		maybeShowNotices( {
			notices: [
				{ id: '', message: 'no id' } as ShellNotice,
				{ id: 'y', message: '' } as ShellNotice,
				NOTICE,
			],
			openUrl,
		} );
		expect( toastMock ).toHaveBeenCalledTimes( 1 );
		expect( lastToast().message ).toBe( NOTICE.message );
	} );
} );
