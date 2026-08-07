/**
 * Tests for `src/auth-recovery/index.ts` — session-expiry detection
 * and in-place recovery for the parent shell (DESKMOD-49).
 *
 * The regression targets: recovery must key off the authoritative
 * Heartbeat `wp-auth-check` flag only (a permission 403 or a
 * dismissed login modal must never trigger it), the racing
 * detection signals must collapse into one recovery run, and the
 * sweep must never reload core's mid-handshake login iframe.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	bootHeartbeatBus,
	_resetHeartbeatBusForTests,
} from '../../src/heartbeat';
import {
	bootAuthRecovery,
	noteAuthFailure,
	_reloadableIframes,
	_resetAuthRecoveryForTests,
} from '../../src/auth-recovery';
import { HOOKS } from '../../src/hooks';
import {
	installHooksStub,
	clearHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

interface JQueryHandlers {
	'heartbeat-tick'?: ( e: unknown, response: Record< string, unknown > ) => void;
}

function installFakeJQuery(): JQueryHandlers {
	const handlers: JQueryHandlers = {};
	( window as unknown as { jQuery: unknown } ).jQuery = (
		_: Document,
	): {
		on: ( ev: string, cb: ( ...args: unknown[] ) => void ) => void;
	} => ( {
		on( ev, cb ) {
			( handlers as Record< string, unknown > )[ ev ] = cb as unknown;
		},
	} );
	return handlers;
}

function installHeartbeatApi(): ReturnType< typeof vi.fn > {
	const connectNow = vi.fn();
	( window.wp as unknown as Record< string, unknown > ).heartbeat = {
		connectNow,
	};
	return connectNow;
}

function tick(
	handlers: JQueryHandlers,
	response: Record< string, unknown >,
): void {
	handlers[ 'heartbeat-tick' ]?.( {}, response );
}

function postReauthMessage(): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			data: { type: 'os-reauth-detected' },
			origin: window.location.origin,
		} ),
	);
}

function domEventSpy( name: string ): ReturnType< typeof vi.fn > {
	const spy = vi.fn();
	document.addEventListener( name, spy );
	return spy;
}

describe( 'auth-recovery', () => {
	let hooks: FakeWpHooks;
	let handlers: JQueryHandlers;
	let connectNow: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2026-01-01T00:00:00Z' ) );
		_resetHeartbeatBusForTests();
		_resetAuthRecoveryForTests();
		hooks = installHooksStub();
		handlers = installFakeJQuery();
		connectNow = installHeartbeatApi();
		bootHeartbeatBus();
	} );

	afterEach( () => {
		_resetAuthRecoveryForTests();
		_resetHeartbeatBusForTests();
		clearHooksStub();
		delete ( window as unknown as { jQuery?: unknown } ).jQuery;
		document.body.innerHTML = '';
		vi.useRealTimers();
	} );

	test( 'announces AUTH_LOST once when the flag reports the session gone', () => {
		const lost = domEventSpy( 'os-auth-lost' );
		const log = recordActions( hooks, [ HOOKS.AUTH_LOST ] );
		bootAuthRecovery();

		tick( handlers, { 'wp-auth-check': false } );
		tick( handlers, { 'wp-auth-check': false } );

		expect( lost ).toHaveBeenCalledTimes( 1 );
		expect( log ).toHaveLength( 1 );
	} );

	test( 'a healthy tick without a prior outage does nothing', () => {
		const restored = domEventSpy( 'os-auth-restored' );
		bootAuthRecovery();

		tick( handlers, { 'wp-auth-check': true } );

		expect( restored ).not.toHaveBeenCalled();
		expect( connectNow ).not.toHaveBeenCalled();
	} );

	test( 'flag flip false → true runs recovery: events + forced tick', () => {
		const restored = domEventSpy( 'os-auth-restored' );
		const log = recordActions( hooks, [
			HOOKS.AUTH_LOST,
			HOOKS.AUTH_RESTORED,
		] );
		bootAuthRecovery();

		tick( handlers, { 'wp-auth-check': false } );
		tick( handlers, { 'wp-auth-check': true } );

		expect( restored ).toHaveBeenCalledTimes( 1 );
		expect( log.map( ( e ) => e.name ) ).toEqual( [
			HOOKS.AUTH_LOST,
			HOOKS.AUTH_RESTORED,
		] );
		expect( connectNow ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a second outage after recovery announces AUTH_LOST again', () => {
		const lost = domEventSpy( 'os-auth-lost' );
		bootAuthRecovery();

		tick( handlers, { 'wp-auth-check': false } );
		tick( handlers, { 'wp-auth-check': true } );
		tick( handlers, { 'wp-auth-check': false } );

		expect( lost ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'iframe reauth message triggers recovery even without a seen outage', () => {
		const restored = domEventSpy( 'os-auth-restored' );
		bootAuthRecovery();

		postReauthMessage();

		expect( restored ).toHaveBeenCalledTimes( 1 );
		expect( connectNow ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'racing recovery triggers inside the cooldown collapse into one run', () => {
		const restored = domEventSpy( 'os-auth-restored' );
		bootAuthRecovery();

		tick( handlers, { 'wp-auth-check': false } );
		tick( handlers, { 'wp-auth-check': true } );
		// One message per open window arrives right behind the tick.
		postReauthMessage();
		postReauthMessage();

		expect( restored ).toHaveBeenCalledTimes( 1 );

		// A genuinely new outage after the cooldown recovers again.
		vi.setSystemTime( Date.now() + 11_000 );
		tick( handlers, { 'wp-auth-check': false } );
		tick( handlers, { 'wp-auth-check': true } );
		expect( restored ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'messages from foreign origins are ignored', () => {
		const restored = domEventSpy( 'os-auth-restored' );
		bootAuthRecovery();

		window.dispatchEvent(
			new MessageEvent( 'message', {
				data: { type: 'os-reauth-detected' },
				origin: 'https://evil.example',
			} ),
		);

		expect( restored ).not.toHaveBeenCalled();
	} );

	test( 'nonces_expired outside an outage forces an accelerated tick, debounced', () => {
		const restored = domEventSpy( 'os-auth-restored' );
		bootAuthRecovery();

		tick( handlers, { nonces_expired: true } );
		expect( connectNow ).toHaveBeenCalledTimes( 1 );
		expect( restored ).not.toHaveBeenCalled();

		// Inside the cooldown the second request is DEFERRED, not
		// dropped — it fires when the cooldown lapses.
		tick( handlers, { nonces_expired: true } );
		expect( connectNow ).toHaveBeenCalledTimes( 1 );
		vi.advanceTimersByTime( 1100 );
		expect( connectNow ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'nonces_expired during a known outage IS the re-auth signal', () => {
		const restored = domEventSpy( 'os-auth-restored' );
		bootAuthRecovery();

		tick( handlers, { 'wp-auth-check': false } );
		// First tick after the re-login: core short-circuits with
		// nonces_expired — only ever sent to an authenticated
		// session, so recovery starts here, one round-trip before
		// the wp-auth-check flag flips back.
		tick( handlers, { nonces_expired: true } );

		expect( restored ).toHaveBeenCalledTimes( 1 );

		// The follow-up flag flip is an echo, absorbed by the
		// recovery cooldown.
		tick( handlers, { 'wp-auth-check': true } );
		expect( restored ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'the sweep excludes the wp-auth-check login iframe', () => {
		document.body.innerHTML = `
			<iframe id="window-a"></iframe>
			<iframe id="window-b"></iframe>
			<div id="wp-auth-check-wrap">
				<iframe id="wp-auth-check-frame"></iframe>
			</div>
		`;

		const targets = _reloadableIframes().map( ( f ) => f.id );
		expect( targets ).toEqual( [ 'window-a', 'window-b' ] );
	} );

	test( 'user switch on the auth field reloads the shell', () => {
		const reloadShell = vi.fn();
		bootAuthRecovery( { currentUserId: 7, reloadShell } );

		tick( handlers, { desktop_mode_auth: { uid: 7 } } );
		expect( reloadShell ).not.toHaveBeenCalled();

		tick( handlers, { desktop_mode_auth: { uid: 9 } } );
		expect( reloadShell ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'without a boot uid the first authenticated tick becomes the baseline', () => {
		const reloadShell = vi.fn();
		bootAuthRecovery( { reloadShell } );

		tick( handlers, { desktop_mode_auth: { uid: 4 } } );
		tick( handlers, { desktop_mode_auth: { uid: 4 } } );
		expect( reloadShell ).not.toHaveBeenCalled();

		tick( handlers, { desktop_mode_auth: { uid: 5 } } );
		expect( reloadShell ).toHaveBeenCalledTimes( 1 );
	} );

	describe( 'noteAuthFailure fast path', () => {
		test( 'same-origin 401/403 forces a tick, debounced', () => {
			noteAuthFailure( 403, '/wp-json/wp/v2/posts' );
			expect( connectNow ).toHaveBeenCalledTimes( 1 );

			// Burst inside the cooldown — no storm.
			noteAuthFailure( 401, '/wp-json/wp/v2/pages' );
			expect( connectNow ).toHaveBeenCalledTimes( 1 );

			vi.setSystemTime( Date.now() + 6000 );
			noteAuthFailure( 401, '/wp-json/wp/v2/pages' );
			expect( connectNow ).toHaveBeenCalledTimes( 2 );
		} );

		test( 'ignores non-auth statuses, foreign origins, heartbeat and wp-login', () => {
			noteAuthFailure( 500, '/wp-json/wp/v2/posts' );
			noteAuthFailure( 404, '/wp-json/wp/v2/posts' );
			noteAuthFailure( 403, 'https://elsewhere.example/wp-json/x' );
			noteAuthFailure(
				403,
				'/wp-admin/admin-ajax.php?action=heartbeat',
			);
			noteAuthFailure( 401, '/wp-login.php?interim-login=1' );

			expect( connectNow ).not.toHaveBeenCalled();
		} );
	} );

	test( 'the modal hiding forces a tick but never recovers by itself', () => {
		document.body.innerHTML =
			'<div id="wp-auth-check-wrap" class=""></div>';
		const restored = domEventSpy( 'os-auth-restored' );
		bootAuthRecovery();

		const wrap = document.getElementById( 'wp-auth-check-wrap' )!;
		wrap.classList.add( 'hidden' );
		// MutationObserver callbacks are microtask-scheduled.
		return Promise.resolve().then( () => {
			expect( connectNow ).toHaveBeenCalledTimes( 1 );
			expect( restored ).not.toHaveBeenCalled();
		} );
	} );
} );
