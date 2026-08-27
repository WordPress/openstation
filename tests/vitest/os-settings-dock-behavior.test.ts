/**
 * OpenStation Preferences → Appearance → Desktop layout → Dock behavior, at the apply
 * pass and on the way in.
 *
 * The pick reaches CSS as an `os-dock-<behavior>` body class, and it
 * has to be the ONLY one of the two on the body — `dock.css` parks
 * the rail off `os-dock-dynamic`, so both at once would be a rail
 * that is parked and not. PHP writes the same class on
 * `admin_body_class` for the first paint; these tests cover the half
 * that makes a change take effect without a reload, plus the parse
 * that keeps an unknown value from ever reaching the body.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { OsSettings } from '../../src/settings';
import { DEFAULTS, STORAGE_KEY } from '../../src/settings/constants';
import { loadState } from '../../src/settings/state';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { OsSettingsConfig } from '../../src/settings/types';
import type { WallpaperLayer } from '../../src/wallpapers/layer';

const BEHAVIORS = [ 'static', 'dynamic' ] as const;

function makeSettings(): OsSettings {
	const layer = { apply: vi.fn() } as unknown as WallpaperLayer;
	return new OsSettings( {} as OsSettingsConfig, layer );
}

/** Which of the behavior classes are currently on the body. */
function behaviorClasses(): string[] {
	return BEHAVIORS.filter( ( b ) =>
		document.body.classList.contains( `os-dock-${ b }` ),
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

describe( 'dockBehavior — parse', () => {
	test( 'defaults to static', () => {
		expect( DEFAULTS.dockBehavior ).toBe( 'static' );
		expect( loadState().dockBehavior ).toBe( 'static' );
	} );

	test.each( BEHAVIORS )( 'round-trips %s', ( behavior ) => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: behavior } ),
		);
		expect( loadState().dockBehavior ).toBe( behavior );
	} );

	test( 'an unknown value falls back to the default', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: 'peekaboo' } ),
		);
		expect( loadState().dockBehavior ).toBe( 'static' );
	} );
} );

describe( 'apply() — dock behavior', () => {
	test.each( BEHAVIORS )( '%s writes exactly its own body class', ( behavior ) => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: behavior } ),
		);
		makeSettings().apply();

		expect( behaviorClasses() ).toEqual( [ behavior ] );
	} );

	test( 'switching replaces the class rather than stacking it', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: 'dynamic' } ),
		);
		const settings = makeSettings();
		settings.apply();
		expect( behaviorClasses() ).toEqual( [ 'dynamic' ] );

		settings.state.dockBehavior = 'static';
		settings.apply();
		expect( behaviorClasses() ).toEqual( [ 'static' ] );
	} );

	test( 'the snapshot carries the pick', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: 'dynamic' } ),
		);
		expect( makeSettings().getOsSettingsSnapshot().dockBehavior ).toBe(
			'dynamic',
		);
	} );
} );
