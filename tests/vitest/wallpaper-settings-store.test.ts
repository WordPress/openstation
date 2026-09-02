/**
 * Per-wallpaper settings — the shared store, the Preferences app's
 * config button, and the `<os-modal>` config dialog.
 *
 * Covers: store seed/get/publish semantics (including the
 * settings-changed action), the config button rendering only for
 * defs that ship `renderConfig`, and the dialog wiring — the
 * wallpaper's `renderConfig` receives the persisted settings and its
 * `setSettings` merges, writes the store, and publishes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import * as registry from '../../src/wallpapers/registry';
import {
	getWallpaperSettings,
	publishWallpaperSettings,
	seedWallpaperSettings,
} from '../../src/wallpapers/settings-store';
import { HOOKS } from '../../src/hooks';
import { render } from '../../src/ui/core';
import { mockViewContext } from '../../src/app-runtime/testing';
import {
	openWallpaperConfigDialog,
	wallpaperSection,
} from '../../apps/os-settings/parts/wallpaper';
import type { WallpaperConfigContext } from '../../src/wallpapers/types';
import { installOsSettingsStub, type OsSettingsStub } from './helpers/os-settings-stub';
import { appData, appExtra } from './helpers/os-settings-app';

let stub: OsSettingsStub;

function paint( wallpaper: string ): HTMLElement {
	stub.state.wallpaper = wallpaper;
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx = mockViewContext( {
		state: { tab: 'appearance' },
		data: appData(),
		root,
		extra: appExtra(),
	} );
	render( wallpaperSection( stub.state, ctx ), root );
	return root;
}

beforeEach( () => {
	installHooksStub();
	stub = installOsSettingsStub();
	seedWallpaperSettings( {} );
} );

afterEach( () => {
	for ( const def of registry.all() ) {
		if ( def.id.startsWith( 'test-' ) ) {
			registry.unregister( def.id );
		}
	}
	seedWallpaperSettings( {} );
	document.body.innerHTML = '';
	clearHooksStub();
} );

describe( 'wallpaper settings store', () => {
	test( 'getWallpaperSettings returns an isolated copy', () => {
		seedWallpaperSettings( { 'test-a': { wind: 10 } } );
		const first = getWallpaperSettings( 'test-a' );
		first.wind = 99;
		expect( getWallpaperSettings( 'test-a' ).wind ).toBe( 10 );
		expect( getWallpaperSettings( 'test-unknown' ) ).toEqual( {} );
	} );

	test( 'seed replaces prior content silently', () => {
		const heard: unknown[] = [];
		window.wp!.hooks!.addAction( HOOKS.WALLPAPER_SETTINGS_CHANGED, 'test/seed', ( detail ) =>
			heard.push( detail ),
		);
		seedWallpaperSettings( { 'test-a': { wind: 10 } } );
		seedWallpaperSettings( { 'test-b': { size: 5 } } );
		expect( getWallpaperSettings( 'test-a' ) ).toEqual( {} );
		expect( getWallpaperSettings( 'test-b' ) ).toEqual( { size: 5 } );
		expect( heard ).toHaveLength( 0 );
	} );

	test( 'publish stores values and fires the settings-changed action', () => {
		const heard: Array< { id?: string; settings?: Record< string, unknown > } > = [];
		window.wp!.hooks!.addAction( HOOKS.WALLPAPER_SETTINGS_CHANGED, 'test/publish', ( ...args: unknown[] ) =>
			heard.push( args[ 0 ] as ( typeof heard )[ number ] ),
		);
		publishWallpaperSettings( 'test-a', { wind: 42 } );
		expect( getWallpaperSettings( 'test-a' ) ).toEqual( { wind: 42 } );
		expect( heard ).toHaveLength( 1 );
		expect( heard[ 0 ].id ).toBe( 'test-a' );
		expect( heard[ 0 ].settings ).toEqual( { wind: 42 } );
	} );
} );

describe( 'wallpaper config button', () => {
	test( 'renders for the selected def with renderConfig', () => {
		registry.register( {
			id: 'test-configurable',
			label: 'Configurable',
			type: 'css',
			value: '#111111',
			preview: '#111111',
			renderConfig: () => () => {},
		} );
		const root = paint( 'test-configurable' );
		const slot = root.querySelector< HTMLElement >( '.os-settings__wallpaper-config-slot' )!;
		expect( slot.dataset.expanded ).toBe( 'true' );
		expect( slot.querySelector( 'os-button' ) ).not.toBeNull();
	} );

	test( 'collapses for defs without renderConfig', () => {
		registry.register( {
			id: 'test-plain',
			label: 'Plain',
			type: 'css',
			value: '#222222',
			preview: '#222222',
		} );
		const root = paint( 'test-plain' );
		const slot = root.querySelector< HTMLElement >( '.os-settings__wallpaper-config-slot' )!;
		expect( slot.dataset.expanded ).toBe( 'false' );
		expect( slot.querySelector( 'os-button' ) ).toBeNull();
	} );
} );

describe( 'wallpaper config dialog', () => {
	test( 'renderConfig gets persisted settings; setSettings merges, writes the store, publishes', () => {
		seedWallpaperSettings( { 'test-configurable': { wind: 10 } } );
		stub.state.wallpaperSettings[ 'test-configurable' ] = { wind: 10 };

		let received: WallpaperConfigContext | null = null;
		const def = {
			id: 'test-configurable',
			label: 'Configurable',
			type: 'css' as const,
			value: '#111111',
			preview: '#111111',
			renderConfig: ( _el: HTMLElement, cfg: WallpaperConfigContext ) => {
				received = cfg;
				return () => {};
			},
		};
		registry.register( def );

		const heard: Array< { settings?: Record< string, unknown > } > = [];
		window.wp!.hooks!.addAction( HOOKS.WALLPAPER_SETTINGS_CHANGED, 'test/dialog', ( ...args: unknown[] ) =>
			heard.push( args[ 0 ] as ( typeof heard )[ number ] ),
		);

		openWallpaperConfigDialog( def );

		const modal = document.body.querySelector( 'os-modal' );
		expect( modal ).not.toBeNull();
		expect( modal!.getAttribute( 'open' ) ).not.toBeNull();
		expect( received ).not.toBeNull();
		expect( received!.settings ).toEqual( { wind: 10 } );

		received!.setSettings( { size: 8 } );
		// Merge (not replace), written through the public API, published.
		expect( stub.updateOsSettings ).toHaveBeenCalledWith(
			{ wallpaperSettings: { 'test-configurable': { wind: 10, size: 8 } } },
			expect.anything(),
		);
		expect( getWallpaperSettings( 'test-configurable' ) ).toEqual( { wind: 10, size: 8 } );
		expect( heard ).toHaveLength( 1 );
		expect( heard[ 0 ].settings ).toEqual( { wind: 10, size: 8 } );
	} );

	test( 'teardown runs when the dialog is cancelled', () => {
		const teardown = vi.fn();
		const def = {
			id: 'test-configurable',
			label: 'Configurable',
			type: 'css' as const,
			value: '#111111',
			preview: '#111111',
			renderConfig: () => teardown,
		};
		registry.register( def );

		openWallpaperConfigDialog( def );
		const modal = document.body.querySelector( 'os-modal' );
		expect( modal ).not.toBeNull();

		modal!.dispatchEvent( new CustomEvent( 'os-modal-cancel', { bubbles: true } ) );
		expect( teardown ).toHaveBeenCalledTimes( 1 );
		expect( document.body.querySelector( 'os-modal' ) ).toBeNull();
	} );
} );
