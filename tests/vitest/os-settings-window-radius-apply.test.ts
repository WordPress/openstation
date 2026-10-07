import { beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { OsSettings } from '../../src/settings';
import { STORAGE_KEY } from '../../src/settings/constants';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { WallpaperLayer } from '../../src/wallpapers/layer';

const RADIUS_VAR = '--os-window-radius';

function shellEl(): HTMLElement {
	return document.getElementById( 'os-shell' )!;
}

function makeSettings(): OsSettings {

	const layer = { apply: vi.fn() } as unknown as WallpaperLayer;
	return new OsSettings( layer );
}

beforeEach( () => {
	_resetAllSharedStoresForTests();
	installHooksStub();
	window.localStorage.clear();
	delete ( window as unknown as { openStationConfig?: unknown } )
		.openStationConfig;
	document.body.innerHTML = '';
	document.documentElement.removeAttribute( 'style' );
	document.body.removeAttribute( 'style' );

	const shell = document.createElement( 'div' );
	shell.id = 'os-shell';
	document.body.appendChild( shell );

	return () => clearHooksStub();
} );

describe( 'apply() — window radius', () => {
	test.each( [
		[ 'sharp', '0px' ],
		[ 'default', '8px' ],
		[ 'round', '16px' ],
	] )( '%s writes %s to both :root and the shell', ( id, expected ) => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { windowRadius: id } ),
		);
		const settings = makeSettings();
		settings.apply();

		expect(
			document.body.style.getPropertyValue( RADIUS_VAR ),
		).toBe( expected );

		expect( shellEl().style.getPropertyValue( RADIUS_VAR ) ).toBe(
			expected,
		);
	} );

	test( 'a later pick overwrites the shell value', () => {
		const settings = makeSettings();
		settings.apply();

		expect( shellEl().style.getPropertyValue( RADIUS_VAR ) ).toBe( '16px' );

		settings.state.windowRadius = 'sharp';
		settings.apply();
		expect( shellEl().style.getPropertyValue( RADIUS_VAR ) ).toBe( '0px' );
	} );

	test( 'an unknown persisted value falls back to the default preset', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { windowRadius: 'squircle' } ),
		);
		const settings = makeSettings();
		settings.apply();
		expect( shellEl().style.getPropertyValue( RADIUS_VAR ) ).toBe( '16px' );
	} );

	test( 'the shell write is an inline style, which outranks any theme rule', () => {

		const settings = makeSettings();
		settings.state.windowRadius = 'sharp';
		settings.apply();

		expect( shellEl().getAttribute( 'style' ) ).toContain( RADIUS_VAR );
		expect( shellEl().getAttribute( 'style' ) ).toContain( '0px' );
	} );
} );
