/**
 * Tests for `src/nonce-refresh.ts` — heartbeat-driven refresh of
 * the cached REST/ajax nonces. Regression target is GH#250
 * ("Plugins table sometimes won't load — Cookie check failed"),
 * where a long-running shell session crossed WordPress's 24-hour
 * `nonce_life` boundary and the per-window blob's `restNonce`
 * went stale.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	bootHeartbeatBus,
	_resetHeartbeatBusForTests,
} from '../../src/heartbeat';
import {
	bootNonceRefresh,
	registerNonceTarget,
	_resetNonceRefreshForTests,
} from '../../src/nonce-refresh';

interface JQueryHandlers {
	'heartbeat-send'?: ( e: unknown, data: Record< string, unknown > ) => void;
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

interface ShellWindow extends Window {
	openStationConfig?: { restNonce?: string };
	openStationWindowConfig?: Record< string, unknown >;
	jQuery?: unknown;
}

function shellWindow(): ShellWindow {
	return window as unknown as ShellWindow;
}

describe( 'nonce-refresh', () => {
	beforeEach( () => {
		_resetHeartbeatBusForTests();
		_resetNonceRefreshForTests();
		delete shellWindow().jQuery;
		delete shellWindow().openStationConfig;
		delete shellWindow().openStationWindowConfig;
	} );

	afterEach( () => {
		_resetHeartbeatBusForTests();
		_resetNonceRefreshForTests();
		delete shellWindow().jQuery;
		delete shellWindow().openStationConfig;
		delete shellWindow().openStationWindowConfig;
	} );

	test( 'rewrites the shell-wide restNonce on every tick', () => {
		const handlers = installFakeJQuery();
		shellWindow().openStationConfig = { restNonce: 'stale' };

		bootHeartbeatBus();
		bootNonceRefresh();

		handlers[ 'heartbeat-tick' ]?.(
			{},
			{ desktop_mode_nonces: { wp_rest: 'fresh-1' } },
		);
		expect( shellWindow().openStationConfig?.restNonce ).toBe( 'fresh-1' );

		handlers[ 'heartbeat-tick' ]?.(
			{},
			{ desktop_mode_nonces: { wp_rest: 'fresh-2' } },
		);
		expect( shellWindow().openStationConfig?.restNonce ).toBe( 'fresh-2' );
	} );

	test( 'rewrites the plugins-window restNonce / ajaxNonce / updatesNonce', () => {
		const handlers = installFakeJQuery();
		shellWindow().openStationWindowConfig = {
			'desktop-mode-plugins': {
				restNonce:    'stale-rest',
				ajaxNonce:    'stale-ajax',
				updatesNonce: 'stale-updates',
			},
		};

		bootHeartbeatBus();
		bootNonceRefresh();

		handlers[ 'heartbeat-tick' ]?.(
			{},
			{
				desktop_mode_nonces: {
					wp_rest:                'fresh-rest',
					'desktop-mode-plugins': 'fresh-ajax',
					updates:                'fresh-updates',
				},
			},
		);

		const cfg = shellWindow().openStationWindowConfig?.[
			'desktop-mode-plugins'
		] as Record< string, string >;
		expect( cfg.restNonce ).toBe( 'fresh-rest' );
		expect( cfg.ajaxNonce ).toBe( 'fresh-ajax' );
		expect( cfg.updatesNonce ).toBe( 'fresh-updates' );
	} );

	test( 'rewrites the Plugins APP nonces where App::config() put them — under `extra`', () => {
		const handlers = installFakeJQuery();
		const extra = { ajaxNonce: 'stale-ajax', updatesNonce: 'stale-updates', adminUrl: '/wp-admin/' };
		shellWindow().openStationWindowConfig = {
			'desktop-mode-plugins': {
				osApp:     true,
				restNonce: 'stale-rest',
				extra,
			},
		};

		bootHeartbeatBus();
		bootNonceRefresh();

		handlers[ 'heartbeat-tick' ]?.(
			{},
			{
				desktop_mode_nonces: {
					wp_rest:                'fresh-rest',
					'desktop-mode-plugins': 'fresh-ajax',
					updates:                'fresh-updates',
				},
			},
		);

		const cfg = shellWindow().openStationWindowConfig?.[
			'desktop-mode-plugins'
		] as { restNonce: string; extra: Record< string, string >; ajaxNonce?: string };
		expect( cfg.restNonce ).toBe( 'fresh-rest' );
		// Rewritten IN PLACE on the same object the app reads through
		// `ctx.extra`, and never copied to the top level.
		expect( extra.ajaxNonce ).toBe( 'fresh-ajax' );
		expect( extra.updatesNonce ).toBe( 'fresh-updates' );
		expect( cfg.ajaxNonce ).toBeUndefined();
	} );

	test( 'refreshes restNonce on EVERY native window blob, not just plugins', () => {
		const handlers = installFakeJQuery();
		shellWindow().openStationWindowConfig = {
			'desktop-mode-plugins': { restNonce: 'stale' },
			'desktop-mode-posts':   { restNonce: 'stale' },
			'desktop-mode-users':   { restNonce: 'stale' },
			// A blob without restNonce — should be left alone.
			'os-other':   { something: 'else' },
		};

		bootHeartbeatBus();
		bootNonceRefresh();

		handlers[ 'heartbeat-tick' ]?.(
			{},
			{ desktop_mode_nonces: { wp_rest: 'fresh' } },
		);

		const cfgs = shellWindow().openStationWindowConfig!;
		expect(
			( cfgs[ 'desktop-mode-plugins' ] as { restNonce: string } ).restNonce,
		).toBe( 'fresh' );
		expect(
			( cfgs[ 'desktop-mode-posts' ] as { restNonce: string } ).restNonce,
		).toBe( 'fresh' );
		expect(
			( cfgs[ 'desktop-mode-users' ] as { restNonce: string } ).restNonce,
		).toBe( 'fresh' );
		expect(
			( cfgs[ 'os-other' ] as Record< string, unknown > ).restNonce,
		).toBeUndefined();
	} );

	test( 'ignores ticks without the desktop_mode_nonces field', () => {
		const handlers = installFakeJQuery();
		shellWindow().openStationConfig = { restNonce: 'original' };

		bootHeartbeatBus();
		bootNonceRefresh();

		handlers[ 'heartbeat-tick' ]?.( {}, { something_else: 'ignored' } );
		expect( shellWindow().openStationConfig?.restNonce ).toBe( 'original' );
	} );

	test( 'tolerates a missing openStationConfig and missing window-config blob', () => {
		const handlers = installFakeJQuery();
		// Neither global set — must NOT throw.
		bootHeartbeatBus();
		bootNonceRefresh();

		expect( () =>
			handlers[ 'heartbeat-tick' ]?.(
				{},
				{
					desktop_mode_nonces: {
						wp_rest:                'fresh',
						'desktop-mode-plugins': 'fresh',
						updates:                'fresh',
					},
				},
			),
		).not.toThrow();
	} );

	test( 'skips a stray non-string value in the payload', () => {
		const handlers = installFakeJQuery();
		shellWindow().openStationConfig = { restNonce: 'original' };

		bootHeartbeatBus();
		bootNonceRefresh();

		handlers[ 'heartbeat-tick' ]?.(
			{},
			{ desktop_mode_nonces: { wp_rest: 42 } },
		);
		expect( shellWindow().openStationConfig?.restNonce ).toBe( 'original' );
	} );

	test( 'registerNonceTarget composes with built-in targets', () => {
		const handlers = installFakeJQuery();
		shellWindow().openStationConfig = { restNonce: 'stale' };

		const seen: string[] = [];
		bootHeartbeatBus();
		bootNonceRefresh();
		registerNonceTarget( 'wp_rest', ( v ) => seen.push( v ) );

		handlers[ 'heartbeat-tick' ]?.(
			{},
			{ desktop_mode_nonces: { wp_rest: 'fresh' } },
		);
		expect( seen ).toEqual( [ 'fresh' ] );
		expect( shellWindow().openStationConfig?.restNonce ).toBe( 'fresh' );
	} );

	test( 'bootNonceRefresh is idempotent', () => {
		const handlers = installFakeJQuery();
		shellWindow().openStationConfig = { restNonce: 'stale' };

		bootHeartbeatBus();
		bootNonceRefresh();
		bootNonceRefresh();

		const calls: string[] = [];
		registerNonceTarget( 'wp_rest', ( v ) => calls.push( v ) );

		handlers[ 'heartbeat-tick' ]?.(
			{},
			{ desktop_mode_nonces: { wp_rest: 'fresh' } },
		);
		// Built-in target + custom target = restNonce updated AND
		// our spy called exactly once. A double-boot would either
		// double-fire the spy or re-register the built-in target.
		expect( calls ).toEqual( [ 'fresh' ] );
		expect( shellWindow().openStationConfig?.restNonce ).toBe( 'fresh' );
	} );

	test( 'a throwing updater does not strand peer updaters', () => {
		const handlers = installFakeJQuery();
		shellWindow().openStationConfig = { restNonce: 'stale' };

		const errSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		bootHeartbeatBus();
		bootNonceRefresh();
		registerNonceTarget( 'wp_rest', () => {
			throw new Error( 'boom' );
		} );

		handlers[ 'heartbeat-tick' ]?.(
			{},
			{ desktop_mode_nonces: { wp_rest: 'fresh' } },
		);
		// Built-in target still ran despite the throwing peer.
		expect( shellWindow().openStationConfig?.restNonce ).toBe( 'fresh' );
		errSpy.mockRestore();
	} );
} );
