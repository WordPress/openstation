/**
 * OS Settings → Appearance → Admin bar, at the apply pass.
 *
 * The pick reaches CSS as a `os-admin-bar-<mode>` body
 * class, and it has to be the ONLY one of the three on the body —
 * `desktop.css` gives `hidden` a `display: none !important` and
 * `dynamic` a transform, so two classes at once is a bar that is
 * simultaneously gone and sliding.
 *
 * PHP writes the same class on `admin_body_class` for the first
 * paint; these tests cover the half that makes a change take effect
 * without a reload.
 */
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

/** Which of the three mode classes are currently on the body. */
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
		// One dock is the default layout, and it is the only
		// navigation surface a fresh desktop has: the top bar would be
		// a second one. The route back to classic admin is the dock's
		// own Exit tile, not this bar.
		makeSettings().apply();

		expect( modeClasses() ).toEqual( [ 'hidden' ] );
	} );

	test( 'an unknown persisted mode falls back to the default', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { adminBarMode: 'peekaboo' } ),
		);
		const settings = makeSettings();

		// Rejected at deserialization, not just at paint — an
		// unusable value must never survive into the state the next
		// save would push back to the server.
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
