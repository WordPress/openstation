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

type Registry = typeof import( '../../src/wallpapers/registry' );

async function loadRegistry(): Promise<Registry> {
	// Reset so the internal `seed` array starts empty each test.
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

	test( 'all() applies the desktop-mode.wallpapers filter', async () => {
		const { register, all } = await loadRegistry();
		register( makeCssDef( { id: 'a' } ) );
		register( makeCssDef( { id: 'b' } ) );

		// Filter that drops anything named 'b'.
		const hooks = ( window as unknown as { wp: { hooks: { addFilter: Function } } } ).wp.hooks;
		hooks.addFilter(
			'desktop-mode.wallpapers',
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
			'desktop-mode.wallpapers',
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
