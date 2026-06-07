/**
 * Unit tests for the cross-bundle "open this user's activity
 * footprint" hand-off (`src/my-wordpress/footprint-target.ts`) and the
 * parent-shell bridge handler that drives it
 * (`desktop-mode-open-user-footprint` in `src/window/iframe-bridge.ts`).
 *
 * The footprint launcher's whole reason for existing is robustness:
 * the click originates in the chromeless `users.php` iframe (no shell
 * API), the target is threaded through a shared store so it survives
 * the lazy My WordPress bundle load, and the source window must NOT be
 * closed (it's an auxiliary peek, not a navigation away). Each of
 * those properties is asserted below.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	_resetAllSharedStoresForTests,
	createSharedStore,
} from '../../src/shared-store';
import {
	clearFootprintTarget,
	openUserFootprintWindow,
	readFootprintTarget,
	setFootprintTarget,
	subscribeFootprintTarget,
} from '../../src/my-wordpress/footprint-target';
import { handleWindowMessage } from '../../src/window/iframe-bridge';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const WINDOW_ID = 'desktop-mode-my-wordpress';

let openWindow: ReturnType< typeof vi.fn >;

beforeEach( () => {
	installHooksStub();
	openWindow = vi.fn( () => true );
	( window as unknown as { wp?: unknown } ).wp = {
		desktop: { createSharedStore, openWindow },
	};
	_resetAllSharedStoresForTests();
} );

afterEach( () => {
	clearHooksStub();
	_resetAllSharedStoresForTests();
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'footprint-target — shared store', () => {
	test( 'set / read round-trips userId + userName', () => {
		setFootprintTarget( 42, 'Jane Doe' );
		const got = readFootprintTarget();
		expect( got.userId ).toBe( 42 );
		expect( got.userName ).toBe( 'Jane Doe' );
		expect( got.requestedAt ).toBeGreaterThan( 0 );
	} );

	test( 'clear zeroes the target', () => {
		setFootprintTarget( 7, 'Bob' );
		clearFootprintTarget();
		const got = readFootprintTarget();
		expect( got.userId ).toBeNull();
		expect( got.userName ).toBe( '' );
	} );

	test( 'subscribe fires on set and reports the new target', () => {
		const seen: Array< number | null > = [];
		subscribeFootprintTarget( ( t ) => seen.push( t.userId ) );
		setFootprintTarget( 99, 'Eve' );
		expect( seen ).toEqual( [ 99 ] );
	} );

	test( 'subscribe sees null after clear (no stale userId)', () => {
		const seen: Array< number | null > = [];
		setFootprintTarget( 5, 'A' );
		subscribeFootprintTarget( ( t ) => seen.push( t.userId ) );
		clearFootprintTarget();
		expect( seen ).toEqual( [ null ] );
	} );
} );

describe( 'footprint-target — openUserFootprintWindow', () => {
	test( 'stashes the target then opens the My WordPress window', () => {
		openUserFootprintWindow( { userId: 12, userName: 'Carol' } );
		const got = readFootprintTarget();
		expect( got.userId ).toBe( 12 );
		expect( got.userName ).toBe( 'Carol' );
		expect( openWindow ).toHaveBeenCalledTimes( 1 );
		expect( openWindow ).toHaveBeenCalledWith( WINDOW_ID, {
			source: 'my-wordpress/open-user-footprint',
		} );
	} );

	test( 'defaults userName to empty string when omitted', () => {
		openUserFootprintWindow( { userId: 3 } );
		expect( readFootprintTarget().userName ).toBe( '' );
	} );

	test.each( [ 0, -1, NaN ] )(
		'ignores a non-positive / non-finite userId (%s)',
		( bad ) => {
			openUserFootprintWindow( { userId: bad } );
			expect( openWindow ).not.toHaveBeenCalled();
			expect( readFootprintTarget().userId ).toBeNull();
		},
	);
} );

/**
 * Build a Window-shaped fake exposing the fields the bridge inspects
 * for this message: the iframe contentWindow (source gate) and a
 * `close` spy so we can assert the source window is left open.
 */
function buildFakeWindow() {
	const close = vi.fn();
	const fakeContentWindow = {} as Window;
	return {
		win: {
			id: 'users',
			iframe: {
				contentWindow: fakeContentWindow,
			} as unknown as HTMLIFrameElement,
			close,
			setTitle: vi.fn(),
		},
		fakeContentWindow,
		close,
	};
}

function postFrom( source: Window, data: unknown ): MessageEvent {
	return new MessageEvent( 'message', {
		origin: window.location.origin,
		source,
		data,
	} );
}

describe( 'iframe-bridge — desktop-mode-open-user-footprint', () => {
	test( 'opens the footprint window and leaves the source window open', () => {
		const { win, fakeContentWindow, close } = buildFakeWindow();
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			postFrom( fakeContentWindow, {
				type: 'desktop-mode-open-user-footprint',
				userId: 42,
				userName: 'Jane Doe',
			} ),
		);
		expect( openWindow ).toHaveBeenCalledWith( WINDOW_ID, {
			source: 'my-wordpress/open-user-footprint',
		} );
		expect( readFootprintTarget().userId ).toBe( 42 );
		// The defining property: a row-action peek must NOT close the
		// users list it was launched from.
		expect( close ).not.toHaveBeenCalled();
	} );

	test( 'ignores a message with a non-positive userId', () => {
		const { win, fakeContentWindow } = buildFakeWindow();
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			postFrom( fakeContentWindow, {
				type: 'desktop-mode-open-user-footprint',
				userId: 0,
				userName: '',
			} ),
		);
		expect( openWindow ).not.toHaveBeenCalled();
		expect( readFootprintTarget().userId ).toBeNull();
	} );

	test( 'ignores a message whose userId is not a number', () => {
		const { win, fakeContentWindow } = buildFakeWindow();
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			postFrom( fakeContentWindow, {
				type: 'desktop-mode-open-user-footprint',
				userId: '42',
				userName: '',
			} ),
		);
		expect( openWindow ).not.toHaveBeenCalled();
	} );
} );

describe( 'footprint-target — window-stash fallback (no shared store yet)', () => {
	test( 'set / read round-trip via window._wpdFootprintTarget before the store exists', async () => {
		// A fresh module instance so its memoized `_store` starts null,
		// plus a facade with no `createSharedStore`, so `getStore()`
		// returns null and the `window._wpdFootprintTarget` stash path
		// runs end to end (the env always has the real store otherwise).
		vi.resetModules();
		( window as unknown as { wp?: unknown } ).wp = {};
		delete ( window as unknown as { _wpdFootprintTarget?: unknown } )
			._wpdFootprintTarget;

		const mod = await import( '../../src/my-wordpress/footprint-target' );
		mod.setFootprintTarget( 77, 'Stash User' );

		// The stash actually held the value...
		expect(
			(
				window as unknown as {
					_wpdFootprintTarget?: { userId: number };
				}
			)._wpdFootprintTarget?.userId,
		).toBe( 77 );

		// ...and read returns it while the store is still unavailable.
		const got = mod.readFootprintTarget();
		expect( got.userId ).toBe( 77 );
		expect( got.userName ).toBe( 'Stash User' );

		// clear zeroes the stash too.
		mod.clearFootprintTarget();
		expect( mod.readFootprintTarget().userId ).toBeNull();
	} );
} );
