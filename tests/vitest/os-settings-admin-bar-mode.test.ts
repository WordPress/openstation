import { beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { OsSettings } from '../../src/settings';
import { STORAGE_KEY } from '../../src/settings/constants';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { WallpaperLayer } from '../../src/wallpapers/layer';

const MODES = [ 'static', 'dynamic', 'hidden' ] as const;

function makeSettings(): OsSettings {
	const layer = { apply: vi.fn() } as unknown as WallpaperLayer;
	return new OsSettings( layer );
}

function modeClasses(): string[] {
	return MODES.filter( ( m ) =>
		document.body.classList.contains( `os-admin-bar-${ m }` ),
	);
}

beforeEach( () => {
	_resetAllSharedStoresForTests();
	installHooksStub();
	window.localStorage.clear();
	delete ( window as unknown as { openStationConfig?: unknown } )
		.openStationConfig;
	document.body.innerHTML = '';
	document.body.className = '';

	const shell = document.createElement( 'div' );
	shell.id = 'os-shell';
	document.body.appendChild( shell );

	return () => clearHooksStub();
} );

describe( 'apply() — admin bar mode', () => {
	test.each( MODES )( '%s writes exactly its own body class', ( mode ) => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { adminBarMode: mode } ),
		);
		makeSettings().apply();

		expect( modeClasses() ).toEqual( [ mode ] );
	} );

	test( 'switching modes clears the previous class', () => {
		const settings = makeSettings();

		settings.state.adminBarMode = 'hidden';
		settings.apply();
		expect( modeClasses() ).toEqual( [ 'hidden' ] );

		settings.state.adminBarMode = 'dynamic';
		settings.apply();
		expect( modeClasses() ).toEqual( [ 'dynamic' ] );

		settings.state.adminBarMode = 'static';
		settings.apply();
		expect( modeClasses() ).toEqual( [ 'static' ] );
	} );

	test( 'defaults to hidden with nothing persisted', () => {

		makeSettings().apply();

		expect( modeClasses() ).toEqual( [ 'hidden' ] );
	} );

	test( 'an unknown persisted mode falls back to the default', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { adminBarMode: 'peekaboo' } ),
		);
		const settings = makeSettings();

		expect( settings.state.adminBarMode ).toBe( 'hidden' );

		settings.apply();
		expect( modeClasses() ).toEqual( [ 'hidden' ] );
	} );

	test( 'the mode is exposed on the public settings snapshot', () => {
		const settings = makeSettings();
		settings.state.adminBarMode = 'dynamic';

		expect( settings.getOsSettingsSnapshot().adminBarMode ).toBe( 'dynamic' );
	} );
} );
