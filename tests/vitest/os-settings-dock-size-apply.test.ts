/**
 * OS Settings → Appearance → Dock size, at the apply pass.
 *
 * The same precedence trap as the window radius: a desktop theme can
 * declare `--os-dock-width` and `--os-dock-icon-size` in its tokens
 * (Legacy does — `56px` and `20px`), and the compiled stylesheet
 * writes them on the shell root, an ANCESTOR of the dock. A write on
 * <body> reaches the dock by inheritance only, so with a theme worn
 * the pick moved the admin bar's logo slot and nothing else.
 *
 * Hence the inline write on the shell element, alongside the body one
 * the admin bar (a sibling of the shell) still needs. Deleting either
 * makes these fail; the user-visible symptom of losing the shell one is
 * "Dock size is not doing anything".
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { OsSettings } from '../../src/settings';
import { STORAGE_KEY } from '../../src/settings/constants';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { WallpaperLayer } from '../../src/wallpapers/layer';

const WIDTH_VAR = '--os-dock-width';
const ICON_VAR = '--os-dock-icon-size';

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

describe( 'apply() — dock size', () => {
	test.each( [
		[ 'compact', '48px', '18px' ],
		[ 'default', '56px', '20px' ],
		[ 'large', '72px', '26px' ],
	] )( '%s writes %s / %s to both <body> and the shell', ( id, width, icon ) => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockSize: id } ),
		);
		const settings = makeSettings();
		settings.apply();

		// The admin bar's logo slot reads these off <body>.
		expect( document.body.style.getPropertyValue( WIDTH_VAR ) ).toBe( width );
		expect( document.body.style.getPropertyValue( ICON_VAR ) ).toBe( icon );
		// The dock reads them off the nearest declaring ancestor, and
		// with a theme worn that is the shell — so the shell it is.
		expect( shellEl().style.getPropertyValue( WIDTH_VAR ) ).toBe( width );
		expect( shellEl().style.getPropertyValue( ICON_VAR ) ).toBe( icon );
	} );

	test( 'a later pick overwrites the shell value', () => {
		const settings = makeSettings();
		settings.apply();
		expect( shellEl().style.getPropertyValue( ICON_VAR ) ).toBe( '20px' );

		settings.state.dockSize = 'large';
		settings.apply();
		expect( shellEl().style.getPropertyValue( WIDTH_VAR ) ).toBe( '72px' );
		expect( shellEl().style.getPropertyValue( ICON_VAR ) ).toBe( '26px' );
	} );

	test( 'an unknown persisted value falls back to the default preset', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockSize: 'gigantic' } ),
		);
		const settings = makeSettings();
		settings.apply();
		expect( shellEl().style.getPropertyValue( WIDTH_VAR ) ).toBe( '56px' );
	} );
} );
