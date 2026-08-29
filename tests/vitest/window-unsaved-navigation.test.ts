/**
 * A window that cannot leave, and the paint it must not make.
 *
 * Re-pointing a window's iframe is optimistic — the spinner goes up
 * and the destination tab lights before the frame has moved. When the
 * page inside is holding unsaved changes the browser raises its own
 * "Leave site?" prompt over the top, and a user who answers **Cancel**
 * produces no `load`, no `os-ready`, and no other event: the optimism
 * is never corrected and the window keeps a spinner nothing will ever
 * clear.
 *
 * So the shell asks first, and on a guarded page withholds the paint
 * until the frame reports a real unload. These tests pin that
 * withholding on the live `Window` class — the timer that expires an
 * unclaimed paint included, because without it a "Stay" leaves a
 * callback armed to fire on some unrelated navigation later.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Window } from '../../src/window';
import type { WindowConfig } from '../../src/types';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetWindowChannelsForTests } from '../../src/window-channels';
import {
	_resetWindowLoadingTransitionsForTests,
	installWindowLoadingTransitions,
} from '../../src/window/loading';

/**
 * Same-origin on purpose: `withChromelessParam()` is the shell's
 * same-origin gate, and a foreign host would have `navigateTo()`
 * refuse before the guard ever ran.
 */
const ADMIN = window.location.origin + '/wp-admin/';

function baseConfig( overrides: Partial< WindowConfig > = {} ): WindowConfig {
	return {
		id: 'unsaved-probe',
		url: ADMIN + 'user-new.php',
		title: 'Add User',
		icon: 'dashicons-admin-users',
		x: 40,
		y: 40,
		width: 800,
		height: 600,
		...overrides,
	};
}

let win: Window;
let parent: HTMLElement;
/** Everything the shell posted into the frame. */
let asked: { type?: string; requestId?: string }[];

/**
 * Replace the frame's content window with a recorder, so the guard's
 * query is observable and answerable. jsdom gives the iframe a real
 * `about:blank` window otherwise, which would swallow the message.
 */
function stubContentWindow(): void {
	asked = [];
	Object.defineProperty( win.iframe as HTMLIFrameElement, 'contentWindow', {
		value: {
			postMessage: ( m: unknown ) => {
				asked.push( m as { type?: string; requestId?: string } );
			},
		},
		configurable: true,
	} );
}

/** Answer the guard's most recent query as the bridge would. */
function answerGuard( prevent: boolean ): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			data: {
				type: 'os-bridge-beforeunload-response',
				prevent,
				requestId: asked[ asked.length - 1 ]?.requestId,
			},
			origin: window.location.origin,
		} ),
	);
}

describe( 'a navigation the page inside can refuse', () => {
	beforeEach( () => {
		installHooksStub();
		_resetWindowChannelsForTests();
		// The loading modifier is written straight onto the body at
		// construction; without the transitions subscribed to the
		// fresh hook stub nothing ever takes it off, and `reload()`
		// stops at its own re-entrancy guard.
		_resetWindowLoadingTransitionsForTests();
		installWindowLoadingTransitions();
		parent = document.createElement( 'div' );
		document.body.appendChild( parent );
		win = new Window( baseConfig() );
		parent.appendChild( win.element );
		stubContentWindow();
		// The guard only asks a frame whose bridge has announced
		// itself; everything else keeps the pre-guard behaviour.
		win._iframeBridgeReady = true;
		// Settle the construction-time load. The loading modifier is
		// `reload()`'s own re-entrancy guard, so a window still wearing
		// it never reaches the code under test.
		win.markContentLoaded();
	} );

	afterEach( () => {
		vi.useRealTimers();
		parent.remove();
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'a withheld paint runs once, when the frame reports it left', () => {
		const commit = vi.fn();

		win._deferNavigationCommit( commit, 15000 );
		expect( commit ).not.toHaveBeenCalled();

		win._commitDeferredNavigation();
		expect( commit ).toHaveBeenCalledTimes( 1 );

		// A second unload — the user navigating again minutes later —
		// finds nothing left to claim.
		win._commitDeferredNavigation();
		expect( commit ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a paint nobody claimed expires', () => {
		vi.useFakeTimers();
		const commit = vi.fn();

		win._deferNavigationCommit( commit, 15000 );
		vi.advanceTimersByTime( 15001 );
		win._commitDeferredNavigation();

		// The user answered "Stay". The next unload belongs to
		// whatever they did after that, not to this navigation.
		expect( commit ).not.toHaveBeenCalled();
	} );

	test( 'a newer withheld paint replaces the older one', () => {
		const first = vi.fn();
		const second = vi.fn();

		win._deferNavigationCommit( first, 15000 );
		win._deferNavigationCommit( second, 15000 );
		win._commitDeferredNavigation();

		expect( first ).not.toHaveBeenCalled();
		expect( second ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'reload asks before it paints, and withholds on a guarded page', async () => {
		const loading = vi.spyOn( win, 'markContentLoading' );

		win.reload();

		await vi.waitFor( () => expect( asked ).toHaveLength( 1 ) );
		expect( asked[ 0 ].type ).toBe( 'os-bridge-beforeunload-query' );
		expect( loading ).not.toHaveBeenCalled();

		answerGuard( true );
		await vi.waitFor( () =>
			expect( win._deferredNavigationCommit ).not.toBeNull(),
		);

		// The prompt is up. Cancelling it leaves the window as it was —
		// which matters twice for reload, because the overlay it would
		// otherwise have armed is also its own re-entrancy guard.
		expect( loading ).not.toHaveBeenCalled();

		win._commitDeferredNavigation();
		expect( loading ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'reload paints straight away when nothing is holding on', async () => {
		const loading = vi.spyOn( win, 'markContentLoading' );

		win.reload();
		await vi.waitFor( () => expect( asked ).toHaveLength( 1 ) );
		answerGuard( false );

		await vi.waitFor( () => expect( loading ).toHaveBeenCalledTimes( 1 ) );
		expect( win._deferredNavigationCommit ).toBeNull();
	} );

	test( 'a second reload click cannot slip past the in-flight query', async () => {
		win.reload();
		await vi.waitFor( () => expect( asked ).toHaveLength( 1 ) );

		// The loading class is the usual re-entrancy guard, and the
		// query now arms it a task later than the click.
		win.reload();
		expect( asked ).toHaveLength( 1 );
	} );

	test( 'navigateTo withholds its overlay and its tab highlight', async () => {
		const loading = vi.spyOn( win, 'markContentLoading' );

		expect( win.navigateTo( ADMIN + 'profile.php' ) ).toBe( true );
		await vi.waitFor( () => expect( asked ).toHaveLength( 1 ) );
		answerGuard( true );
		await vi.waitFor( () =>
			expect( win._deferredNavigationCommit ).not.toBeNull(),
		);

		expect( loading ).not.toHaveBeenCalled();
	} );

	test( 'destroying the window drops a withheld paint', () => {
		const commit = vi.fn();

		win._deferNavigationCommit( commit, 15000 );
		win.destroy();
		win._commitDeferredNavigation();

		expect( commit ).not.toHaveBeenCalled();
	} );
} );
