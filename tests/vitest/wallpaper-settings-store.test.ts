/**
 * Per-wallpaper settings — the shared store, the OS Settings config
 * button, and the `<wpd-modal>` config dialog.
 *
 * Covers: store seed/get/publish semantics (including the
 * settings-changed action), the config button rendering only for
 * defs that ship `renderConfig`, and the dialog wiring — the
 * wallpaper's `renderConfig` receives the persisted settings and its
 * `setSettings` merges + saves + publishes.
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
import {
	openWallpaperConfigDialog,
	syncWallpaperConfigButton,
} from '../../src/settings/sections/wallpaper';
import type { SettingsCtx } from '../../src/settings/types';
import type { WallpaperConfigContext } from '../../src/wallpapers/types';

function slotElement(): HTMLElement {
	const slot = document.createElement( 'div' );
	slot.dataset.expanded = 'false';
	slot.appendChild( document.createElement( 'div' ) );
	document.body.appendChild( slot );
	return slot;
}

function ctxFor( wallpaper: string ): SettingsCtx {
	return {
		state: { wallpaper, wallpaperSettings: {} },
		save: vi.fn(),
		apply: vi.fn(),
	} as unknown as SettingsCtx;
}

beforeEach( () => {
	installHooksStub();
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
		window.wp!.hooks!.addAction(
			HOOKS.WALLPAPER_SETTINGS_CHANGED,
			'test/seed',
			( detail ) => heard.push( detail ),
		);
		seedWallpaperSettings( { 'test-a': { wind: 10 } } );
		seedWallpaperSettings( { 'test-b': { size: 5 } } );
		expect( getWallpaperSettings( 'test-a' ) ).toEqual( {} );
		expect( getWallpaperSettings( 'test-b' ) ).toEqual( { size: 5 } );
		expect( heard ).toHaveLength( 0 );
	} );

	test( 'publish stores values and fires the settings-changed action', () => {
		const heard: Array<{ id?: string; settings?: Record<string, unknown> }> = [];
		window.wp!.hooks!.addAction(
			HOOKS.WALLPAPER_SETTINGS_CHANGED,
			'test/publish',
			( ...args: unknown[] ) =>
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
		const slot = slotElement();
		syncWallpaperConfigButton( ctxFor( 'test-configurable' ), slot );
		expect( slot.dataset.expanded ).toBe( 'true' );
		expect( slot.querySelector( 'wpd-button' ) ).not.toBeNull();
	} );

	test( 'collapses for defs without renderConfig', () => {
		registry.register( {
			id: 'test-plain',
			label: 'Plain',
			type: 'css',
			value: '#222222',
			preview: '#222222',
		} );
		const slot = slotElement();
		slot.dataset.expanded = 'true';
		syncWallpaperConfigButton( ctxFor( 'test-plain' ), slot );
		expect( slot.dataset.expanded ).toBe( 'false' );
	} );
} );

describe( 'wallpaper config dialog', () => {
	test( 'renderConfig gets persisted settings; setSettings merges, saves, publishes', () => {
		seedWallpaperSettings( { 'test-configurable': { wind: 10 } } );

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

		const ctx = ctxFor( 'test-configurable' );
		ctx.state.wallpaperSettings[ 'test-configurable' ] = { wind: 10 };

		const heard: Array<{ settings?: Record<string, unknown> }> = [];
		window.wp!.hooks!.addAction(
			HOOKS.WALLPAPER_SETTINGS_CHANGED,
			'test/dialog',
			( ...args: unknown[] ) =>
				heard.push( args[ 0 ] as ( typeof heard )[ number ] ),
		);

		openWallpaperConfigDialog( ctx, def );

		const modal = document.body.querySelector( 'wpd-modal' );
		expect( modal ).not.toBeNull();
		expect( modal!.getAttribute( 'open' ) ).not.toBeNull();
		expect( received ).not.toBeNull();
		expect( received!.settings ).toEqual( { wind: 10 } );

		received!.setSettings( { size: 8 } );
		// Merge (not replace), persisted into state + saved + published.
		expect( ctx.state.wallpaperSettings[ 'test-configurable' ] ).toEqual( {
			wind: 10,
			size: 8,
		} );
		expect( ctx.save ).toHaveBeenCalled();
		expect( getWallpaperSettings( 'test-configurable' ) ).toEqual( {
			wind: 10,
			size: 8,
		} );
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

		openWallpaperConfigDialog( ctxFor( 'test-configurable' ), def );
		const modal = document.body.querySelector( 'wpd-modal' );
		expect( modal ).not.toBeNull();

		modal!.dispatchEvent(
			new CustomEvent( 'wpd-modal-cancel', { bubbles: true } ),
		);
		expect( teardown ).toHaveBeenCalledTimes( 1 );
		expect( document.body.querySelector( 'wpd-modal' ) ).toBeNull();
	} );
} );
