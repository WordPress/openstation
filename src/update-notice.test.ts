/**
 * Tests for `maybeShowUpdateToast()` — the shell-side core-update
 * toast. `showToast` is mocked so we assert on the options it receives
 * and drive the action callback directly.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { maybeShowUpdateToast } from './update-notice';
import { showToast, type ToastOptions } from './toast';

vi.mock( './toast', () => ( { showToast: vi.fn() } ) );

const showToastMock = showToast as unknown as ReturnType< typeof vi.fn >;

function lastOptions(): ToastOptions {
	return showToastMock.mock.calls[ showToastMock.mock.calls.length - 1 ][
		0
	] as ToastOptions;
}

const openUrl = vi.fn();

beforeEach( () => {
	showToastMock.mockClear();
	openUrl.mockClear();
} );

describe( 'maybeShowUpdateToast', () => {
	test( 'no-op when there is no pending update', () => {
		maybeShowUpdateToast( { update: null, openUrl } );
		maybeShowUpdateToast( { update: undefined, openUrl } );
		maybeShowUpdateToast( { update: { version: '', url: '/x' }, openUrl } );
		maybeShowUpdateToast( { update: { version: '7.0.2', url: '' }, openUrl } );
		expect( showToastMock ).not.toHaveBeenCalled();
	} );

	test( 'shows a persistent (non-dismissible) toast carrying the version', () => {
		maybeShowUpdateToast( {
			update: { version: '7.0.2', url: '/wp-admin/update-core.php' },
			openUrl,
		} );
		expect( showToastMock ).toHaveBeenCalledTimes( 1 );
		const opts = lastOptions();
		expect( opts.persistent ).toBe( true );
		// Not dismissible — the toast carries no close affordance and no
		// dismissal hook.
		expect(
			( opts as ToastOptions & { dismissible?: unknown } ).dismissible,
		).toBeUndefined();
		expect( opts.message ).toContain( '7.0.2' );
		expect( opts.action?.label ).toBeTruthy();
	} );

	test( 'the action opens the update URL as a window', () => {
		maybeShowUpdateToast( {
			update: { version: '7.0.2', url: '/wp-admin/update-core.php' },
			openUrl,
		} );
		lastOptions().action!.onClick();
		expect( openUrl ).toHaveBeenCalledTimes( 1 );
		expect( openUrl.mock.calls[ 0 ][ 0 ].url ).toBe(
			'/wp-admin/update-core.php',
		);
		expect( typeof openUrl.mock.calls[ 0 ][ 0 ].title ).toBe( 'string' );
	} );

	test( 'shows again on a subsequent call (no dismissal persistence)', () => {
		maybeShowUpdateToast( { update: { version: '7.0.2', url: '/x' }, openUrl } );
		maybeShowUpdateToast( { update: { version: '7.0.2', url: '/x' }, openUrl } );
		expect( showToastMock ).toHaveBeenCalledTimes( 2 );
	} );
} );
