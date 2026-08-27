/**
 * OpenStation Preferences → Appearance → Desktop layout → Dock
 * behavior / Sidebar behavior, at the apply pass and on the way in.
 *
 * Each pick reaches CSS as a `data-os-dock-behavior` attribute on
 * its own rail — the dock (`#os-dock`) from `dockBehavior`, the Split
 * sidebar (`#os-side-dock`) from `sideDockBehavior` — because the two
 * answer independently. PHP stamps the dock for the first paint;
 * these tests cover the half that makes a change take effect without
 * a reload, plus the parse that keeps an unknown value from ever
 * reaching a rail.
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
const ATTR = 'data-os-dock-behavior';

function makeSettings(): OsSettings {
	const layer = { apply: vi.fn() } as unknown as WallpaperLayer;
	return new OsSettings( {} as OsSettingsConfig, layer );
}

let dock: HTMLElement;
let sideDock: HTMLElement;

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
	const body = document.createElement( 'div' );
	body.className = 'os-shell__body';
	sideDock = document.createElement( 'nav' );
	sideDock.id = 'os-side-dock';
	sideDock.className = 'os-dock';
	dock = document.createElement( 'nav' );
	dock.id = 'os-dock';
	dock.className = 'os-dock';
	body.append( sideDock, dock );
	shell.appendChild( body );
	document.body.appendChild( shell );

	return () => clearHooksStub();
} );

describe( 'dockBehavior / sideDockBehavior — parse', () => {
	test( 'both default to static', () => {
		expect( DEFAULTS.dockBehavior ).toBe( 'static' );
		expect( DEFAULTS.sideDockBehavior ).toBe( 'static' );
		expect( loadState().dockBehavior ).toBe( 'static' );
		expect( loadState().sideDockBehavior ).toBe( 'static' );
	} );

	test.each( BEHAVIORS )( 'round-trips %s on both keys', ( behavior ) => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: behavior, sideDockBehavior: behavior } ),
		);
		expect( loadState().dockBehavior ).toBe( behavior );
		expect( loadState().sideDockBehavior ).toBe( behavior );
	} );

	test( 'the two keys are independent', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: 'static', sideDockBehavior: 'dynamic' } ),
		);
		expect( loadState().dockBehavior ).toBe( 'static' );
		expect( loadState().sideDockBehavior ).toBe( 'dynamic' );
	} );

	test( 'an unknown value falls back to the default', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: 'peekaboo', sideDockBehavior: 42 } ),
		);
		expect( loadState().dockBehavior ).toBe( 'static' );
		expect( loadState().sideDockBehavior ).toBe( 'static' );
	} );
} );

describe( 'apply() — dock behavior', () => {
	test.each( BEHAVIORS )( '%s stamps the dock', ( behavior ) => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: behavior } ),
		);
		makeSettings().apply();
		expect( dock.getAttribute( ATTR ) ).toBe( behavior );
		expect( sideDock.getAttribute( ATTR ) ).toBe( 'static' );
	} );

	test( 'each rail wears its own answer', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: 'static', sideDockBehavior: 'dynamic' } ),
		);
		makeSettings().apply();
		expect( dock.getAttribute( ATTR ) ).toBe( 'static' );
		expect( sideDock.getAttribute( ATTR ) ).toBe( 'dynamic' );
	} );

	test( 'switching replaces the attribute', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: 'dynamic' } ),
		);
		const settings = makeSettings();
		settings.apply();
		expect( dock.getAttribute( ATTR ) ).toBe( 'dynamic' );

		settings.state.dockBehavior = 'static';
		settings.apply();
		expect( dock.getAttribute( ATTR ) ).toBe( 'static' );
	} );

	test( 'the snapshot carries both picks', () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( { dockBehavior: 'dynamic', sideDockBehavior: 'static' } ),
		);
		const snap = makeSettings().getOsSettingsSnapshot();
		expect( snap.dockBehavior ).toBe( 'dynamic' );
		expect( snap.sideDockBehavior ).toBe( 'static' );
	} );
} );
