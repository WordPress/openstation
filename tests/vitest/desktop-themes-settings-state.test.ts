/**
 * `desktopTheme` in the OS-settings state parser.
 *
 * `_parseRaw` is private, so these go through `loadState()` and the
 * localStorage cache — which is also the path that actually runs on
 * boot, so it is the more honest thing to test.
 *
 * The pattern here MUST mirror the PHP sanitizer
 * (`desktop_mode_sanitize_os_settings`). A value one side accepts and
 * the other rewrites makes the setting flip on every reload.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadState } from '../../src/settings/state';
import { DEFAULTS, STORAGE_KEY } from '../../src/settings/constants';

function seedCache( desktopTheme: unknown ): void {
	window.localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify( { ...DEFAULTS, desktopTheme } ),
	);
}

beforeEach( () => {
	window.localStorage.clear();
	delete ( window as unknown as { desktopModeConfig?: unknown } ).desktopModeConfig;
} );

afterEach( () => {
	window.localStorage.clear();
} );

describe( 'OsSettingsState.desktopTheme', () => {
	test( 'defaults to the system theme', () => {
		expect( DEFAULTS.desktopTheme ).toBe( '' );
		expect( loadState().desktopTheme ).toBe( '' );
	} );

	test( 'a valid slug round-trips', () => {
		seedCache( 'acme-neon' );
		expect( loadState().desktopTheme ).toBe( 'acme-neon' );
	} );

	test( 'the empty string is a REAL value, not a missing one', () => {
		// The parser uses `*`, not `+`, for exactly this reason: a `+`
		// would silently rewrite "System default" on every load.
		seedCache( '' );
		expect( loadState().desktopTheme ).toBe( '' );
	} );

	test.each( [
		[ 'uppercase', 'Acme-Neon' ],
		[ 'slash', 'acme/neon' ],
		[ 'traversal', '../../etc' ],
		[ 'markup', '<script>' ],
		[ 'number', 42 ],
		[ 'object', { slug: 'x' } ],
		[ 'null', null ],
	] )( 'falls back to the default for %s', ( _label, value ) => {
		seedCache( value );
		expect( loadState().desktopTheme ).toBe( DEFAULTS.desktopTheme );
	} );

	test( 'an unknown slug is kept — the registry resolves at apply time', () => {
		seedCache( 'not-installed' );
		expect( loadState().desktopTheme ).toBe( 'not-installed' );
	} );

	test( 'the server snapshot wins over the localStorage cache', () => {
		seedCache( 'from-cache' );
		( window as unknown as { desktopModeConfig: unknown } ).desktopModeConfig = {
			osSettings: { ...DEFAULTS, desktopTheme: 'from-server' },
		};
		expect( loadState().desktopTheme ).toBe( 'from-server' );
	} );
} );
