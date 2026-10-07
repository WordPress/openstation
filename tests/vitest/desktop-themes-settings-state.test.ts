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
