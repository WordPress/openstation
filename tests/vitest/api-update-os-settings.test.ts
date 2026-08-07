/**
 * `wp.os.updateOsSettings()` — the public write path into OS
 * Settings.
 *
 * Two things are worth pinning here. First, the whitelist: the patch
 * comes from third-party code, and a key that isn't a public-snapshot
 * field must not reach the persisted state. Second, that a write is
 * actually *applied* and not merely saved — an "update" that persists
 * but changes nothing on screen until the next page load is the bug
 * this suite exists to prevent regressing.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub } from './helpers/hooks-stub';
import { structuredDefaults } from '../../src/settings/state';
import type { OsSettingsState } from '../../src/settings/types';
import type { BuildPublicApiDeps } from '../../src/api/facade';

type BuildPublicApi = typeof import( '../../src/api/facade' )[ 'buildPublicApi' ];

// The facade's import graph registers hooks at module-evaluation time
// (devtools does an `addAction` at the top level), so the bus has to
// exist BEFORE the module is pulled in — hence the dynamic import.
let buildPublicApi: BuildPublicApi;

interface Harness {
	api: ReturnType< BuildPublicApi >;
	state: OsSettingsState;
	save: ReturnType< typeof vi.fn >;
	apply: ReturnType< typeof vi.fn >;
}

function harness(): Harness {
	const state = structuredDefaults();
	const save = vi.fn();
	const apply = vi.fn();

	// Only `osSettings` is exercised here; the rest of the dependency
	// bag is never reached by `updateOsSettings`.
	const api = buildPublicApi( {
		osSettings: {
			state,
			save,
			apply,
			// Read once while the facade object is being built.
			getOsSettingsSnapshot: () => ( { ...state } ),
			subscribeOsSettings: () => () => undefined,
		},
		manager: {},
		dock: null,
		layoutDispatcher: null,
		config: {},
	} as unknown as BuildPublicApiDeps );

	return { api, state, save, apply };
}

let h: Harness;

beforeAll( async () => {
	installHooksStub();
	( { buildPublicApi } = await import( '../../src/api/facade' ) );
} );

beforeEach( () => {
	installHooksStub();
	h = harness();
} );

describe( 'updateOsSettings — writers', () => {
	test( 'writes desktopTheme, and treats "" as a real value', () => {
		h.api.updateOsSettings( { desktopTheme: 'acme-neon' } );
		expect( h.state.desktopTheme ).toBe( 'acme-neon' );

		// `''` is the system default — a value, not a missing field.
		h.api.updateOsSettings( { desktopTheme: '' } );
		expect( h.state.desktopTheme ).toBe( '' );
	} );

	test( 'writes unfocusEffect', () => {
		h.api.updateOsSettings( { unfocusEffect: 'none' } );
		expect( h.state.unfocusEffect ).toBe( 'none' );
	} );

	test( 'writes windowRadius', () => {
		h.api.updateOsSettings( { windowRadius: 'round' } );
		expect( h.state.windowRadius ).toBe( 'round' );
	} );

	test( 'ignores non-string values for the id fields', () => {
		const before = { ...h.state };
		h.api.updateOsSettings( {
			desktopTheme: 42,
			unfocusEffect: null,
			windowRadius: [ 'round' ],
		} as never );

		expect( h.state.desktopTheme ).toBe( before.desktopTheme );
		expect( h.state.unfocusEffect ).toBe( before.unfocusEffect );
		expect( h.state.windowRadius ).toBe( before.windowRadius );
	} );

	test( 'ignores keys outside the public snapshot', () => {
		h.api.updateOsSettings( {
			madeUpKey: 'value',
			appliedThemeRecommendations: [ 'tampered' ],
		} as never );

		expect(
			( h.state as unknown as Record< string, unknown > ).madeUpKey,
		).toBeUndefined();
		// The seeded-theme ledger is shell-owned: writing it from the
		// public API would let a caller re-arm a theme's one-time seed.
		expect( h.state.appliedThemeRecommendations ).toEqual( [] );
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
	] )( 'applies a %s change, not just saves it', ( _label, patch ) => {
		h.api.updateOsSettings( patch as never );
		expect( h.apply ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'skips apply for a patch that touches no presentation key', () => {
		// `unfocusEffect` rides `subscribeOsSettings` (fired by save),
		// and `apply()` knows nothing about it — calling apply here
		// would be noise, not a repaint.
		h.api.updateOsSettings( { unfocusEffect: 'none' } );
		expect( h.save ).toHaveBeenCalledTimes( 1 );
		expect( h.apply ).not.toHaveBeenCalled();
	} );

	test( 'forwards the windowId option to save for activity attribution', () => {
		h.api.updateOsSettings(
			{ desktopTheme: 'acme-neon' },
			{ windowId: 'my-window' },
		);
		expect( h.save ).toHaveBeenCalledWith( { windowId: 'my-window' } );
	} );
} );
