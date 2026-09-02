/**
 * `wp.os.updateOsSettings()` / `resetOsSettings()` — the public write
 * path, which is the Preferences app's own write path.
 *
 * Every `OsSettingsState` key is accepted and coerced by the same
 * sanitizer that reads user meta, with the CURRENT value as the
 * fallback: an invalid field is ignored, an unknown key never lands,
 * the seeded-theme ledger stays shell-owned. Presentation keys apply
 * as well as save; activating a theme seeds its recommendations once.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub } from './helpers/hooks-stub';
import { OsSettings } from '../../src/settings';
import type { WallpaperLayer } from '../../src/wallpapers/layer';
import type { BuildPublicApiDeps } from '../../src/api/facade';

type BuildPublicApi = typeof import( '../../src/api/facade' )[ 'buildPublicApi' ];

// The facade's import graph registers hooks at module-evaluation
// time, so the hooks stub has to exist BEFORE the module is pulled
// in — hence the dynamic import.
let buildPublicApi: BuildPublicApi;

interface Harness {
	api: ReturnType< BuildPublicApi >;
	store: OsSettings;
	save: ReturnType< typeof vi.fn >;
	apply: ReturnType< typeof vi.fn >;
}

function harness(): Harness {
	const store = new OsSettings( { apply: vi.fn() } as unknown as WallpaperLayer );
	const save = vi.spyOn( store, 'save' ).mockImplementation( () => undefined );
	const apply = vi.spyOn( store, 'apply' ).mockImplementation( () => undefined );
	// Only `osSettings` is exercised here; the rest of the dependency
	// bag is never reached by the settings members.
	const api = buildPublicApi( {
		osSettings: store,
		manager: {},
		dock: null,
		layoutDispatcher: null,
		config: {},
	} as unknown as BuildPublicApiDeps );
	return { api, store, save, apply };
}

let h: Harness;

beforeAll( async () => {
	installHooksStub();
	( { buildPublicApi } = await import( '../../src/api/facade' ) );
} );

beforeEach( () => {
	installHooksStub();
	window.localStorage.clear();
	h = harness();
} );

describe( 'updateOsSettings — writers', () => {
	test( 'writes desktopTheme, and treats "" as a real value', () => {
		h.api.updateOsSettings( { desktopTheme: 'acme-neon' } );
		expect( h.store.state.desktopTheme ).toBe( 'acme-neon' );
		h.api.updateOsSettings( { desktopTheme: '' } );
		expect( h.store.state.desktopTheme ).toBe( '' );
	} );

	test( 'writes unfocusEffect', () => {
		h.api.updateOsSettings( { unfocusEffect: 'none' } );
		expect( h.store.state.unfocusEffect ).toBe( 'none' );
	} );

	test( 'writes windowRadius', () => {
		h.api.updateOsSettings( { windowRadius: 'round' } );
		expect( h.store.state.windowRadius ).toBe( 'round' );
	} );

	test( 'writes the keys only the Preferences window used to reach', () => {
		h.api.updateOsSettings( {
			customAccent: '#123456',
			customGradient: { from: '#000000', to: '#ffffff', angle: 90 },
			customImage: { id: 7, url: 'https://example.test/wall.jpg' },
			wallpaperSettings: { snow: { wind: 3 } },
			libraryHdOnly: false,
			heartbeatRate: 30,
			confirmCloseAllWindows: false,
			mioEnabled: true,
		} );
		expect( h.store.state.customAccent ).toBe( '#123456' );
		expect( h.store.state.customGradient ).toEqual( { from: '#000000', to: '#ffffff', angle: 90 } );
		expect( h.store.state.customImage ).toEqual( { id: 7, url: 'https://example.test/wall.jpg' } );
		expect( h.store.state.wallpaperSettings ).toEqual( { snow: { wind: 3 } } );
		expect( h.store.state.libraryHdOnly ).toBe( false );
		expect( h.store.state.heartbeatRate ).toBe( 30 );
		expect( h.store.state.confirmCloseAllWindows ).toBe( false );
		expect( h.store.state.mioEnabled ).toBe( true );
		// `null` is a real value for the image: "no image".
		h.api.updateOsSettings( { customImage: null } );
		expect( h.store.state.customImage ).toBeNull();
	} );

	test( 'ignores invalid values, keeping the current one', () => {
		h.api.updateOsSettings( { desktopTheme: 'acme-neon', heartbeatRate: 30 } );
		h.api.updateOsSettings( {
			desktopTheme: 42,
			unfocusEffect: null,
			windowRadius: [ 'round' ],
			heartbeatRate: 17,
			customAccent: 'red',
		} as never );
		expect( h.store.state.desktopTheme ).toBe( 'acme-neon' );
		expect( h.store.state.unfocusEffect ).toBe( 'darken' );
		expect( h.store.state.windowRadius ).toBe( 'round' );
		expect( h.store.state.heartbeatRate ).toBe( 30 );
		expect( h.store.state.customAccent ).toBe( '#f252fc' );
	} );

	test( 'ignores unknown keys and the shell-owned ledger', () => {
		h.api.updateOsSettings( {
			madeUpKey: 'value',
			appliedThemeRecommendations: [ 'tampered' ],
		} as never );
		expect( ( h.store.state as unknown as Record< string, unknown > ).madeUpKey ).toBeUndefined();
		// The seeded-theme ledger is shell-owned: writing it from the
		// public API would let a caller re-arm a theme's one-time seed.
		expect( h.store.state.appliedThemeRecommendations ).toEqual( [] );
	} );
} );

describe( 'updateOsSettings — persist and apply', () => {
	test( 'saves on every patch', () => {
		h.api.updateOsSettings( { desktopTheme: 'acme-neon' } );
		expect( h.save ).toHaveBeenCalledTimes( 1 );
	} );

	test.each( [
		[ 'wallpaper', { wallpaper: 'dark' } ],
		[ 'accent', { accent: 'indigo' } ],
		[ 'dockSize', { dockSize: 'large' } ],
		[ 'windowRadius', { windowRadius: 'round' } ],
		[ 'desktopLayout', { desktopLayout: 'unified' } ],
		[ 'dockRailRenderer', { dockRailRenderer: 'default' } ],
		[ 'desktopTheme', { desktopTheme: 'acme-neon' } ],
		[ 'customGradient', { customGradient: { from: '#000000', to: '#ffffff', angle: 1 } } ],
	] )( 'applies a %s change, not just saves it', ( _label, patch ) => {
		h.api.updateOsSettings( patch as never );
		expect( h.apply ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'skips apply for a patch that touches no presentation key', () => {
		// `unfocusEffect` rides `subscribeOsSettings` (fired by save),
		// and `apply()` knows nothing about it.
		h.api.updateOsSettings( { unfocusEffect: 'none' } );
		expect( h.save ).toHaveBeenCalledTimes( 1 );
		expect( h.apply ).not.toHaveBeenCalled();
	} );

	test( 'forwards the windowId option to save for activity attribution', () => {
		h.api.updateOsSettings( { desktopTheme: 'acme-neon' }, { windowId: 'my-window' } );
		expect( h.save ).toHaveBeenCalledWith( { windowId: 'my-window' } );
	} );

	test( 'notifies subscribers with a defensive copy', () => {
		h.save.mockRestore();
		const heard: unknown[] = [];
		h.api.subscribeOsSettings( ( snapshot ) => heard.push( snapshot ) );
		h.api.updateOsSettings( { unfocusEffect: 'none' } );
		expect( heard ).toHaveLength( 1 );
		expect( ( heard[ 0 ] as { unfocusEffect: string } ).unfocusEffect ).toBe( 'none' );
		expect( heard[ 0 ] ).not.toBe( h.store.state );
	} );
} );

describe( 'updateOsSettings — theme activation', () => {
	test( 'activating the system default seeds its recommended accent once', () => {
		h.api.updateOsSettings( { accent: 'teal', desktopTheme: 'acme-neon' } );
		expect( h.store.state.accent ).toBe( 'teal' );
		// Back to the shell's own look: it recommends Pulse, the accent
		// its palette was drawn against, and records the offer.
		h.api.updateOsSettings( { desktopTheme: '' } );
		expect( h.store.state.accent ).toBe( 'pulse' );
		expect( h.store.state.appliedThemeRecommendations ).toEqual( [ 'system-default' ] );
		// A second activation never overwrites a choice made since.
		h.api.updateOsSettings( { accent: 'teal', desktopTheme: 'acme-neon' } );
		h.api.updateOsSettings( { desktopTheme: '' } );
		expect( h.store.state.accent ).toBe( 'teal' );
	} );

	test( 'the deliberate re-apply goes through desktopThemes.applyRecommendedOsSettings', () => {
		h.api.updateOsSettings( { desktopTheme: '' } );
		h.api.updateOsSettings( { accent: 'teal' } );
		const applied = h.api.desktopThemes.applyRecommendedOsSettings( '' );
		// '' is the system default, which the facade reads as "the
		// active theme, if any" — nothing to re-apply for no theme.
		expect( applied ).toEqual( {} );
		expect( h.store.state.accent ).toBe( 'teal' );
	} );
} );

describe( 'resetOsSettings', () => {
	test( 'puts every preference back, keeps the uploaded image, and applies', () => {
		h.api.updateOsSettings( {
			accent: 'teal',
			customImage: { id: 3, url: 'https://example.test/wall.jpg' },
			wallpaper: 'custom-image',
		} );
		h.save.mockClear();
		h.apply.mockClear();
		h.api.resetOsSettings();
		expect( h.store.state.accent ).toBe( 'pulse' );
		expect( h.store.state.wallpaper ).toBe( 'galaxy' );
		expect( h.store.state.customImage ).toEqual( { id: 3, url: 'https://example.test/wall.jpg' } );
		expect( h.save ).toHaveBeenCalledTimes( 1 );
		expect( h.apply ).toHaveBeenCalledTimes( 1 );
	} );
} );
