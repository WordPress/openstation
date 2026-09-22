/**
 * Unit tests for `src/wallpapers/registry.ts`.
 *
 * The registry is module-scoped state, so we import it fresh in
 * each `beforeEach` via Vitest's `resetModules` to prevent entries
 * from one test leaking into the next.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { WallpaperDef } from '../../src/wallpapers/types';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import {
	applyWallpaperTone,
	firstCssUrl,
	LIGHT_TONE_CLASS,
	relativeLuminance,
	resolveWallpaperTone,
	toneForLuminance,
	toneFromCssColors,
} from '../../src/wallpapers/tone';
import { CUSTOM_GRADIENT_ID } from '../../src/settings/constants';

type Registry = typeof import( '../../src/wallpapers/registry' );

async function loadRegistry(): Promise<Registry> {
	// Reset shared-store records first — the wallpaper registry's
	// seed lives on a `createSharedStore`-backed `window` slot since
	// 0.8.4 (so the main bundle and the Preferences app's bundle
	// share one registry). `vi.resetModules()` alone wouldn't clear
	// that slot; the dedicated helper does.
	_resetAllSharedStoresForTests();
	vi.resetModules();
	return await import( '../../src/wallpapers/registry' );
}

const makeCssDef = ( overrides: Partial<WallpaperDef> = {} ): WallpaperDef => ( {
	id: 'test',
	label: 'Test',
	type: 'css',
	value: '#f00',
	preview: '#f00',
	...overrides,
} as WallpaperDef );

describe( 'wallpapers/registry.ts', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'register adds a wallpaper to the list', async () => {
		const { register, all } = await loadRegistry();
		register( makeCssDef( { id: 'red', label: 'Red' } ) );
		expect( all().map( ( w ) => w.id ) ).toEqual( [ 'red' ] );
	} );

	test( 'register with an existing id replaces the entry (late wins)', async () => {
		const { register, all } = await loadRegistry();
		register( makeCssDef( { id: 'x', label: 'First' } ) );
		register( makeCssDef( { id: 'x', label: 'Second' } ) );
		const entries = all();
		expect( entries ).toHaveLength( 1 );
		expect( entries[ 0 ].label ).toBe( 'Second' );
	} );

	test( 'unregister removes a wallpaper', async () => {
		const { register, unregister, all } = await loadRegistry();
		register( makeCssDef( { id: 'doomed' } ) );
		unregister( 'doomed' );
		expect( all() ).toEqual( [] );
	} );

	test( 'all() applies the os.wallpapers filter', async () => {
		const { register, all } = await loadRegistry();
		register( makeCssDef( { id: 'a' } ) );
		register( makeCssDef( { id: 'b' } ) );

		// Filter that drops anything named 'b'.
		const hooks = ( window as unknown as { wp: { hooks: { addFilter: Function } } } ).wp.hooks;
		hooks.addFilter(
			'os.wallpapers',
			'vitest/filter',
			( list: WallpaperDef[] ) => list.filter( ( w ) => w.id !== 'b' ),
		);
		expect( all().map( ( w ) => w.id ) ).toEqual( [ 'a' ] );
	} );

	test( 'register throws RegistrationError for missing id', async () => {
		const { register, all } = await loadRegistry();
		const bad = { label: 'Nope', type: 'css', value: '#f00', preview: '#f00' } as unknown as WallpaperDef;
		expect( () => register( bad ) ).toThrow( /Wallpaper registration rejected/ );
		expect( all() ).toEqual( [] );
	} );

	test( 'register throws RegistrationError for invalid type', async () => {
		const { register, all } = await loadRegistry();
		const bad = {
			id: 'weird',
			label: 'Weird',
			type: 'hologram',
			preview: '#f00',
		} as unknown as WallpaperDef;
		expect( () => register( bad ) ).toThrow( /Wallpaper registration rejected/ );
		expect( all() ).toEqual( [] );
	} );

	test( 'canvas defs throw RegistrationError without a mount function', async () => {
		const { register, all } = await loadRegistry();
		const missingMount = {
			id: 'canvas',
			label: 'Canvas',
			type: 'canvas',
			preview: '#000',
		} as unknown as WallpaperDef;
		expect( () => register( missingMount ) ).toThrow( /Wallpaper registration rejected/ );
		expect( all() ).toEqual( [] );
	} );

	test( 'all() tolerates a filter callback returning a non-array', async () => {
		const { register, all } = await loadRegistry();
		register( makeCssDef() );
		const hooks = ( window as unknown as { wp: { hooks: { addFilter: Function } } } ).wp.hooks;
		hooks.addFilter(
			'os.wallpapers',
			'vitest/bad',
			() => 'not an array',
		);
		// Should NOT throw; falls back to the seed list.
		const result = all();
		expect( result ).toHaveLength( 1 );
		expect( result[ 0 ].id ).toBe( 'test' );
	} );

	test( 'get returns a registered def by id', async () => {
		const { register, get } = await loadRegistry();
		register( makeCssDef( { id: 'lookup' } ) );
		expect( get( 'lookup' )?.id ).toBe( 'lookup' );
		expect( get( 'ghost' ) ).toBeUndefined();
	} );
} );

describe( 'wallpapers/tone.ts', () => {
	test( 'a declared tone is taken at its word, measuring nothing', async () => {
		// A Void gradient that SAYS it is light still gets light.
		await expect(
			resolveWallpaperTone( {
				id: 'declared',
				label: 'Declared',
				type: 'css',
				preview: '',
				value: 'linear-gradient(180deg, #0c0b0f, #000000)',
				tone: 'light',
			} ),
		).resolves.toBe( 'light' );
	} );

	test( 'an undeclared wallpaper is dark, whatever it is made of', async () => {
		// The canvas branch: nothing to read, so no guessing.
		await expect(
			resolveWallpaperTone( {
				id: 'canvas',
				label: 'Canvas',
				type: 'canvas',
				preview: '',
				mount: () => () => {},
			} ),
		).resolves.toBe( 'dark' );
	} );

	test( "the user's own gradient is measured from its stops", async () => {
		const light = await resolveWallpaperTone( {
			id: CUSTOM_GRADIENT_ID,
			label: 'Custom gradient',
			type: 'css',
			preview: '',
			value: 'linear-gradient(135deg, #f6f2ff, #ffe9f6)',
		} );
		const dark = await resolveWallpaperTone( {
			id: CUSTOM_GRADIENT_ID,
			label: 'Custom gradient',
			type: 'css',
			preview: '',
			value: 'linear-gradient(135deg, #1d2327, #2c3338)',
		} );
		expect( [ light, dark ] ).toEqual( [ 'light', 'dark' ] );
	} );

	test( 'an authored gradient is never measured, however bright it averages', async () => {
		// These three run dark-to-bright and average ABOVE the
		// threshold, while the corner the icon grid starts in stays
		// dark. Measuring them put Void icons on a midnight blue.
		const tones = await Promise.all(
			[
				'linear-gradient(135deg, #1a2980 0%, #26d0ce 100%)', // Aurora
				'linear-gradient(135deg, #ff512f 0%, #dd2476 100%)', // Sunset
				'linear-gradient(135deg, #134e5e 0%, #71b280 100%)', // Forest
			].map( ( value, i ) =>
				resolveWallpaperTone( {
					id: `preset-${ i }`,
					label: 'Preset',
					type: 'css',
					preview: '',
					value,
				} ),
			),
		);
		expect( tones ).toEqual( [ 'dark', 'dark', 'dark' ] );

		// Averaged as light, which is why the exclusion is by id rather
		// than by a kinder threshold.
		expect(
			toneFromCssColors( 'linear-gradient(135deg, #1a2980 0%, #26d0ce 100%)' ),
		).toBe( 'light' );
	} );

	test( 'the threshold is where Void ink overtakes Starlight', () => {
		// #808080 is L 0.2159, above the crossover; #6b6b6b is L 0.1441,
		// below. Drifting past either flips a band of mid-tones to the
		// ink that reads worse on them.
		expect( toneForLuminance( relativeLuminance( 128, 128, 128 ) ) ).toBe(
			'light',
		);
		expect( toneForLuminance( relativeLuminance( 107, 107, 107 ) ) ).toBe(
			'dark',
		);
	} );

	test( 'an image outranks a colour sitting beside it', async () => {
		// The custom-image value carries a solid behind the photograph.
		// Averaging that in would describe the backstop, not the desk.
		expect(
			firstCssUrl( 'url("/uploads/desk.jpg") center/cover no-repeat, #1d2327' ),
		).toBe( '/uploads/desk.jpg' );
		expect( toneFromCssColors( 'url("/uploads/desk.jpg")' ) ).toBeNull();
	} );

	test( 'the light class is stamped on body and lifts again', () => {
		applyWallpaperTone( 'light' );
		expect( document.body.classList.contains( LIGHT_TONE_CLASS ) ).toBe( true );
		applyWallpaperTone( 'dark' );
		expect( document.body.classList.contains( LIGHT_TONE_CLASS ) ).toBe( false );
	} );
} );
