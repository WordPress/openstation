/**
 * OS Settings → Appearance → Window corners, at the apply pass.
 *
 * The preset has to reach the window elements, and the only thing
 * standing between it and them is CSS precedence. A desktop theme can
 * declare `--os-window-radius` in its tokens, and the
 * compiled stylesheet writes it on a selector matching the shell root
 * — an ANCESTOR of every window. The document-level write only reaches
 * windows by inheritance, so the theme would win and the preset would
 * silently do nothing.
 *
 * Hence the inline write on the shell element: inline outranks any
 * selector, so the user's pick is authoritative. These tests are the
 * guard on that — deleting the shell write makes them fail, and the
 * user-visible symptom is "clicking Sharp does nothing".
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { OsSettings } from '../../src/settings';
import { STORAGE_KEY } from '../../src/settings/constants';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { OsSettingsConfig } from '../../src/settings/types';
import type { WallpaperLayer } from '../../src/wallpapers/layer';

const RADIUS_VAR = '--os-window-radius';

function shellEl(): HTMLElement {
	return document.getElementById( 'os-shell' )!;
}

function makeSettings(): OsSettings {
	// The wallpaper layer is exercised by apply() but has nothing to
	// do with the radius; a no-op stand-in keeps this focused.
	const layer = { apply: vi.fn() } as unknown as WallpaperLayer;
	return new OsSettings( {} as OsSettingsConfig, layer );
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
		// The one that actually beats a desktop theme's token.
		expect( shellEl().style.getPropertyValue( RADIUS_VAR ) ).toBe(
			expected,
		);
	} );

	test( 'a later pick overwrites the shell value', () => {
		const settings = makeSettings();
		settings.apply();
		expect( shellEl().style.getPropertyValue( RADIUS_VAR ) ).toBe( '8px' );

		settings.state.windowRadius = 'round';
		settings.apply();
		expect( shellEl().style.getPropertyValue( RADIUS_VAR ) ).toBe( '16px' );
	} );

	test( 'an unknown persisted value falls back to the default preset', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { windowRadius: 'squircle' } ),
		);
		const settings = makeSettings();
		settings.apply();
		expect( shellEl().style.getPropertyValue( RADIUS_VAR ) ).toBe( '8px' );
	} );

	test( 'the shell write is an inline style, which outranks any theme rule', () => {
		// Not a tautology: `style.getPropertyValue` returning the value
		// is exactly what makes it inline, and inline is the whole
		// mechanism. A refactor that moved this to a stylesheet rule or
		// a `data-` attribute would lose to the theme's selector.
		const settings = makeSettings();
		settings.state.windowRadius = 'sharp';
		settings.apply();

		expect( shellEl().getAttribute( 'style' ) ).toContain( RADIUS_VAR );
		expect( shellEl().getAttribute( 'style' ) ).toContain( '0px' );
	} );
} );
