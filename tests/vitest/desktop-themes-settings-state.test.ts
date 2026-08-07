/**
 * `desktopTheme` in the OS-settings state parser.
 *
 * `_parseRaw` is private, so these go through `loadState()` and the
 * localStorage cache — which is also the path that actually runs on
 * boot, so it is the more honest thing to test.
 *
 * The pattern here MUST mirror the PHP sanitizer
 * (`openstation_sanitize_os_settings`). A value one side accepts and
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

function seedLedger( appliedThemeRecommendations: unknown ): void {
	window.localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify( { ...DEFAULTS, appliedThemeRecommendations } ),
	);
}

beforeEach( () => {
	window.localStorage.clear();
	delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
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
		( window as unknown as { openStationConfig: unknown } ).openStationConfig = {
			osSettings: { ...DEFAULTS, desktopTheme: 'from-server' },
		};
		expect( loadState().desktopTheme ).toBe( 'from-server' );
	} );
} );

describe( 'OsSettingsState.appliedThemeRecommendations', () => {
	test( 'defaults to an empty ledger', () => {
		expect( DEFAULTS.appliedThemeRecommendations ).toEqual( [] );
		expect( loadState().appliedThemeRecommendations ).toEqual( [] );
	} );

	test( 'valid slugs round-trip and duplicates collapse', () => {
		seedLedger( [ 'acme-neon', 'acme-neon', 'other-theme' ] );
		expect( loadState().appliedThemeRecommendations ).toEqual( [
			'acme-neon',
			'other-theme',
		] );
	} );

	test( 'entries outside the slug charset are dropped, the rest survive', () => {
		// The PHP sanitizer runs `sanitize_key()` over the same list;
		// a value one side keeps and the other rewrites would make the
		// ledger drift and re-arm a seed on some future load.
		seedLedger( [ 'Acme-Neon', 'acme/neon', '', 42, null, 'kept-theme' ] );
		expect( loadState().appliedThemeRecommendations ).toEqual( [
			'kept-theme',
		] );
	} );

	test( 'a non-array falls back to the default', () => {
		seedLedger( 'acme-neon' );
		expect( loadState().appliedThemeRecommendations ).toEqual( [] );
	} );

	test( 'the cap keeps the most recent 64 entries', () => {
		// Same end PHP trims from. The writer appends, so keeping the
		// head would drop the slug just written and let that theme
		// re-seed on the next activation.
		seedLedger( Array.from( { length: 90 }, ( _v, i ) => `theme-${ i }` ) );
		const ledger = loadState().appliedThemeRecommendations;
		expect( ledger ).toHaveLength( 64 );
		expect( ledger.at( -1 ) ).toBe( 'theme-89' );
		expect( ledger ).not.toContain( 'theme-0' );
	} );

	test( 'an unknown slug is kept — a reinstall must not re-seed', () => {
		seedLedger( [ 'deleted-theme' ] );
		expect( loadState().appliedThemeRecommendations ).toEqual( [
			'deleted-theme',
		] );
	} );
} );
