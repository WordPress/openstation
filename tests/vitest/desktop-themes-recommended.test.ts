/**
 * Recommended OS settings — the payload sanitizer, the runtime
 * resolver, and the once-only apply.
 *
 * The invariant these tests exist to defend is the promise made to
 * users, not to theme authors: **a theme arranges your desktop once,
 * the first time you pick it, and never touches it again.** Every
 * "already seeded" and "user changed it afterwards" case below is a
 * guard on that sentence.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import {
	RECOMMENDED_OS_SETTINGS_KEYS,
	resolveRecommendedOsSettings,
	sanitizeRecommendedOsSettings,
} from '../../src/desktop-themes/recommended';
import { normalizeEntry, setDesktopThemes } from '../../src/desktop-themes/registry';
import {
	applyThemeRecommendations,
	hasApplicableThemeRecommendations,
} from '../../src/settings/theme-recommendations';
import { structuredDefaults } from '../../src/settings/state';
import {
	register as registerDockRailRenderer,
	_resetForTests as resetDockRailRenderers,
} from '../../src/dock-rail/registry';
import type { DockRailRenderer } from '../../src/dock-rail/types';

/** Minimal renderer stub — the registry only validates the shape. */
function railRenderer( id: string ): DockRailRenderer {
	return {
		id,
		label: id,
		mount: () => ( { destroy: () => undefined } ),
	} as unknown as DockRailRenderer;
}

function seedLibrary( recommendedOsSettings: unknown, slug = 'acme-neon' ): void {
	setDesktopThemes( [
		{
			id: `acme/${ slug }`,
			slug,
			name: 'Neon',
			version: '1.0.0',
			author: '',
			description: '',
			previewUrl: '',
			cssUrl: '',
			cssText: '',
			tokens: {},
			fonts: [],
			icons: {},
			iconColors: {},
			recommendedOsSettings,
			installedAt: 1,
			source: 'upload',
		},
	] );
}

beforeEach( () => {
	_resetAllSharedStoresForTests();
	resetDockRailRenderers();
	registerDockRailRenderer( railRenderer( 'default' ) );
} );

describe( 'sanitizeRecommendedOsSettings', () => {
	test( 'every core key round-trips', () => {
		expect(
			sanitizeRecommendedOsSettings( {
				dockSize: 'large',
				desktopLayout: 'unified',
				windowRadius: 'round',
				adminBarMode: 'dynamic',
				dockRailRenderer: 'default',
			} ),
		).toEqual( {
			dockSize: 'large',
			desktopLayout: 'unified',
			windowRadius: 'round',
			adminBarMode: 'dynamic',
			dockRailRenderer: 'default',
		} );
	} );

	test( 'every admin-bar mode is accepted', () => {
		for ( const mode of [ 'static', 'dynamic', 'hidden' ] ) {
			expect( sanitizeRecommendedOsSettings( { adminBarMode: mode } ) ).toEqual(
				{ adminBarMode: mode },
			);
		}
	} );

	test( 'an unknown admin-bar mode drops', () => {
		expect(
			sanitizeRecommendedOsSettings( {
				adminBarMode: 'peekaboo',
				dockSize: 'large',
			} ),
		).toEqual( { dockSize: 'large' } );
	} );

	test( 'out-of-enum values drop and the rest survive', () => {
		expect(
			sanitizeRecommendedOsSettings( {
				dockSize: 'enormous',
				desktopLayout: 'spatial',
			} ),
		).toEqual( { desktopLayout: 'spatial' } );
	} );

	test( 'keys outside the schema are dropped', () => {
		// The payload passes through the `desktop_mode_desktop_themes`
		// PHP filter AFTER sanitization, so the shell must not treat it
		// as trusted. A theme must never reach a feature switch.
		expect(
			sanitizeRecommendedOsSettings( {
				dockSize: 'compact',
				nativePluginsEnabled: 'true',
				desktopTheme: 'someone-elses-theme',
			} ),
		).toEqual( { dockSize: 'compact' } );
	} );

	test.each( [
		[ 'a string', 'large' ],
		[ 'null', null ],
		[ 'an array', [ 'large' ] ],
		[ 'undefined', undefined ],
	] )( 'yields an empty set for %s', ( _label, value ) => {
		expect( sanitizeRecommendedOsSettings( value ) ).toEqual( {} );
	} );

	test( 'non-string values are dropped', () => {
		expect(
			sanitizeRecommendedOsSettings( {
				dockSize: [ 'large' ],
				desktopLayout: 5,
				windowRadius: true,
			} ),
		).toEqual( {} );
	} );

	test( 'the exported key list covers every field it sanitizes', () => {
		expect( RECOMMENDED_OS_SETTINGS_KEYS ).toEqual( [
			'dockSize',
			'desktopLayout',
			'windowRadius',
			'adminBarMode',
			'dockRailRenderer',
			'windowReveal',
			'windowRevealDuration',
		] );
	} );

	test( 'keeps a window-reveal id on the slug charset', () => {
		expect(
			sanitizeRecommendedOsSettings( { windowReveal: 'iris' } ),
		).toEqual( { windowReveal: 'iris' } );
	} );

	test( 'clamps a reveal duration instead of dropping it', () => {
		// A theme asking for something outside the playable range is
		// still expressing a direction; the nearest playable duration
		// is the honest reading of it.
		expect(
			sanitizeRecommendedOsSettings( { windowRevealDuration: 99_999 } ),
		).toEqual( { windowRevealDuration: 4000 } );
		expect(
			sanitizeRecommendedOsSettings( { windowRevealDuration: 1 } ),
		).toEqual( { windowRevealDuration: 80 } );
		expect(
			sanitizeRecommendedOsSettings( { windowRevealDuration: 512.6 } ),
		).toEqual( { windowRevealDuration: 513 } );
	} );

	test( 'drops a non-numeric reveal duration', () => {
		expect(
			sanitizeRecommendedOsSettings( {
				windowRevealDuration: '700' as unknown as number,
			} ),
		).toEqual( {} );
	} );
} );

describe( 'resolveRecommendedOsSettings', () => {
	test( 'keeps a dock rail renderer that is registered', () => {
		expect(
			resolveRecommendedOsSettings( { dockRailRenderer: 'default' } ),
		).toEqual( { dockRailRenderer: 'default' } );
	} );

	test( 'drops an unregistered renderer, keeping every other key', () => {
		// A theme recommending a renderer shipped by a plugin the site
		// does not have must not write an id nothing answers to into
		// user meta, where it would look like a deliberate choice.
		expect(
			resolveRecommendedOsSettings( {
				dockSize: 'large',
				dockRailRenderer: 'orbit-rail',
			} ),
		).toEqual( { dockSize: 'large' } );
	} );

	test( 'keeps a registered window reveal, and `none`', () => {
		expect( resolveRecommendedOsSettings( { windowReveal: 'iris' } ) ).toEqual(
			{ windowReveal: 'iris' },
		);
		// `none` is the selector's "no reveal" sentinel rather than a
		// registration, so a theme recommending a deliberately plain
		// shell must survive the registry check.
		expect( resolveRecommendedOsSettings( { windowReveal: 'none' } ) ).toEqual(
			{ windowReveal: 'none' },
		);
	} );

	test( 'drops an unregistered reveal, keeping every other key', () => {
		expect(
			resolveRecommendedOsSettings( {
				windowRevealDuration: 700,
				windowReveal: 'ghost-reveal',
			} ),
		).toEqual( { windowRevealDuration: 700 } );
	} );

	test( 'the renderer survives once its plugin registers it', () => {
		registerDockRailRenderer( railRenderer( 'orbit-rail' ) );
		expect(
			resolveRecommendedOsSettings( { dockRailRenderer: 'orbit-rail' } ),
		).toEqual( { dockRailRenderer: 'orbit-rail' } );
	} );
} );

describe( 'normalizeEntry', () => {
	test( 'sanitizes the block off the payload', () => {
		const entry = normalizeEntry( {
			slug: 'acme-neon',
			name: 'Neon',
			recommendedOsSettings: {
				dockSize: 'large',
				windowRadius: 'squircle',
			},
		} );
		expect( entry?.recommendedOsSettings ).toEqual( { dockSize: 'large' } );
	} );

	test( 'a payload with no block yields an empty object, never undefined', () => {
		// Every theme installed before this feature existed lands here.
		const entry = normalizeEntry( { slug: 'acme-neon', name: 'Neon' } );
		expect( entry?.recommendedOsSettings ).toEqual( {} );
	} );
} );

describe( 'applyThemeRecommendations', () => {
	test( 'seeds on the first activation and records the theme', () => {
		seedLibrary( { dockSize: 'large', desktopLayout: 'unified' } );
		const state = structuredDefaults();

		const applied = applyThemeRecommendations( state, 'acme-neon' );

		expect( applied ).toEqual( {
			dockSize: 'large',
			desktopLayout: 'unified',
		} );
		expect( state.dockSize ).toBe( 'large' );
		expect( state.desktopLayout ).toBe( 'unified' );
		expect( state.appliedThemeRecommendations ).toEqual( [ 'acme-neon' ] );
	} );

	test( 'seeds windowRadius — the corner preset a theme asks for', () => {
		// The path that replaced pinning `--desktop-mode-window-radius`
		// as a token: a token cannot beat the preset's inline write, a
		// recommendation sets the preset itself.
		seedLibrary( { windowRadius: 'round' } );
		const state = structuredDefaults();

		expect( applyThemeRecommendations( state, 'acme-neon' ) ).toEqual( {
			windowRadius: 'round',
		} );
		expect( state.windowRadius ).toBe( 'round' );
	} );

	test( 'a theme already in the ledger does not pick up a NEW recommendation', () => {
		// A theme update that adds a key reaches nobody who has already
		// activated it — deliberate: re-seeding on update is exactly
		// "the theme overwrote my settings again". The button is the
		// way in.
		seedLibrary( { dockSize: 'large' } );
		const state = structuredDefaults();
		applyThemeRecommendations( state, 'acme-neon' );

		seedLibrary( { dockSize: 'large', windowRadius: 'round' } );
		expect( applyThemeRecommendations( state, 'acme-neon' ) ).toEqual( {} );
		expect( state.windowRadius ).toBe( 'default' );

		// …and the button picks it up.
		expect(
			applyThemeRecommendations( state, 'acme-neon', { force: true } ),
		).toEqual( { dockSize: 'large', windowRadius: 'round' } );
		expect( state.windowRadius ).toBe( 'round' );
	} );

	test( 'does nothing the second time, even after the user changed things', () => {
		// This is the whole promise: pick the theme, move the dock back
		// to compact, re-pick the theme — compact stays.
		seedLibrary( { dockSize: 'large' } );
		const state = structuredDefaults();

		applyThemeRecommendations( state, 'acme-neon' );
		state.dockSize = 'compact';

		expect( applyThemeRecommendations( state, 'acme-neon' ) ).toEqual( {} );
		expect( state.dockSize ).toBe( 'compact' );
		expect( state.appliedThemeRecommendations ).toEqual( [ 'acme-neon' ] );
	} );

	test( 'force re-applies and does not duplicate the ledger entry', () => {
		seedLibrary( { dockSize: 'large' } );
		const state = structuredDefaults();

		applyThemeRecommendations( state, 'acme-neon' );
		state.dockSize = 'compact';

		expect(
			applyThemeRecommendations( state, 'acme-neon', { force: true } ),
		).toEqual( { dockSize: 'large' } );
		expect( state.dockSize ).toBe( 'large' );
		expect( state.appliedThemeRecommendations ).toEqual( [ 'acme-neon' ] );
	} );

	test( 'a theme that recommends nothing is not recorded', () => {
		// Leaving it out means a later theme version that DOES ship
		// recommendations still gets its one chance.
		seedLibrary( {} );
		const state = structuredDefaults();

		expect( applyThemeRecommendations( state, 'acme-neon' ) ).toEqual( {} );
		expect( state.appliedThemeRecommendations ).toEqual( [] );
	} );

	test( 'an unknown theme id is a no-op', () => {
		seedLibrary( { dockSize: 'large' } );
		const state = structuredDefaults();

		expect( applyThemeRecommendations( state, 'not-installed' ) ).toEqual( {} );
		expect( state.dockSize ).toBe( 'default' );
		expect( state.appliedThemeRecommendations ).toEqual( [] );
	} );

	test( 'resolves by full id as well as by slug', () => {
		seedLibrary( { dockSize: 'large' } );
		const state = structuredDefaults();

		applyThemeRecommendations( state, 'acme/acme-neon' );
		expect( state.dockSize ).toBe( 'large' );
	} );

	test( 'an unresolvable renderer does not block the other keys', () => {
		seedLibrary( { dockSize: 'large', dockRailRenderer: 'orbit-rail' } );
		const state = structuredDefaults();

		expect( applyThemeRecommendations( state, 'acme-neon' ) ).toEqual( {
			dockSize: 'large',
		} );
		expect( state.dockRailRenderer ).toBe( 'default' );
		expect( state.appliedThemeRecommendations ).toEqual( [ 'acme-neon' ] );
	} );

	test( 'never writes a non-string setting', () => {
		// Belt and braces on top of the sanitizer: even a site that has
		// widened the PHP schema cannot flip a boolean feature toggle
		// from a theme manifest.
		seedLibrary( { dockSize: 'large' } );
		const state = structuredDefaults();
		const before = state.nativePluginsEnabled;

		applyThemeRecommendations( state, 'acme-neon' );
		expect( state.nativePluginsEnabled ).toBe( before );
	} );

	test( 'the ledger keeps the most recent 64 entries', () => {
		const state = structuredDefaults();
		state.appliedThemeRecommendations = Array.from(
			{ length: 64 },
			( _v, i ) => `theme-${ i }`,
		);
		seedLibrary( { dockSize: 'large' }, 'acme-newest' );

		applyThemeRecommendations( state, 'acme-newest' );

		expect( state.appliedThemeRecommendations ).toHaveLength( 64 );
		expect( state.appliedThemeRecommendations ).toContain( 'acme-newest' );
		expect( state.appliedThemeRecommendations ).not.toContain( 'theme-0' );
	} );
} );

describe( 'hasApplicableThemeRecommendations', () => {
	test( 'true when the theme recommends something resolvable', () => {
		seedLibrary( { dockSize: 'large' } );
		expect( hasApplicableThemeRecommendations( 'acme-neon' ) ).toBe( true );
	} );

	test( 'false when every recommendation resolves to nothing', () => {
		seedLibrary( { dockRailRenderer: 'orbit-rail' } );
		expect( hasApplicableThemeRecommendations( 'acme-neon' ) ).toBe( false );
	} );

	test( 'false for an unknown theme', () => {
		seedLibrary( { dockSize: 'large' } );
		expect( hasApplicableThemeRecommendations( 'not-installed' ) ).toBe( false );
	} );
} );
