/**
 * Unit tests for `src/stage/registry.ts`.
 *
 * The registry is shared-store-backed (three bundles touch it: the
 * lazy `stage` bundle registers the built-ins, the lazy OS-settings
 * panel lists them, and the main bundle resolves the user's chain), so
 * we reset the shared stores and re-import fresh in each test.
 *
 * Unlike the unfocus-effect registry, this one ships EMPTY — the
 * built-in shaders are seeded by `src/stage/entry.ts` in the lazy
 * bundle, not at registry module load.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import type { ScreenEffectDef } from '../../src/stage/types';

type Registry = typeof import( '../../src/stage/registry' );

async function loadRegistry(): Promise< Registry > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	return import( '../../src/stage/registry' );
}

/** Minimal valid def — `createFilter` is never called in these tests. */
function def( overrides: Partial< ScreenEffectDef > = {} ): ScreenEffectDef {
	return {
		id: 'test-effect',
		label: 'Test effect',
		createFilter: () => ( {} as never ),
		...overrides,
	};
}

describe( 'stage/registry.ts', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'starts empty — built-ins live in the lazy stage bundle', async () => {
		const { listScreenEffects } = await loadRegistry();
		expect( listScreenEffects() ).toEqual( [] );
	} );

	test( 'registers and reads back an effect', async () => {
		const { registerScreenEffect, getScreenEffect, listScreenEffects } =
			await loadRegistry();
		registerScreenEffect( def( { id: 'scanlines', label: 'Scanlines' } ) );
		expect( getScreenEffect( 'scanlines' )?.label ).toBe( 'Scanlines' );
		expect( listScreenEffects() ).toHaveLength( 1 );
	} );

	test( 'normalises the id to lower case', async () => {
		const { registerScreenEffect, getScreenEffect } = await loadRegistry();
		registerScreenEffect( def( { id: '  My-Vendor/CRT  ' } ) );
		expect( getScreenEffect( 'my-vendor/crt' ) ).toBeDefined();
	} );

	test( 're-registering the same id replaces, WordPress-style', async () => {
		const { registerScreenEffect, listScreenEffects, getScreenEffect } =
			await loadRegistry();
		registerScreenEffect( def( { id: 'crt', label: 'First' } ) );
		registerScreenEffect( def( { id: 'crt', label: 'Second' } ) );
		expect( listScreenEffects() ).toHaveLength( 1 );
		expect( getScreenEffect( 'crt' )?.label ).toBe( 'Second' );
	} );

	test( 'rejects a missing id, label or createFilter', async () => {
		const { registerScreenEffect } = await loadRegistry();
		expect( () =>
			registerScreenEffect( def( { id: '' } ) ),
		).toThrow();
		expect( () =>
			registerScreenEffect( def( { label: '' } ) ),
		).toThrow();
		expect( () =>
			registerScreenEffect( {
				id: 'no-filter',
				label: 'No filter',
			} as unknown as ScreenEffectDef ),
		).toThrow();
	} );

	test( 'rejects an id with illegal characters', async () => {
		const { registerScreenEffect } = await loadRegistry();
		expect( () =>
			registerScreenEffect( def( { id: 'Bad Id!' } ) ),
		).toThrow();
	} );

	test( 'rejects malformed params', async () => {
		const { registerScreenEffect } = await loadRegistry();
		// Bad key.
		expect( () =>
			registerScreenEffect(
				def( {
					params: [
						{
							key: 'not a key',
							label: 'X',
							min: 0,
							max: 1,
							step: 0.1,
							default: 0,
						},
					],
				} ),
			),
		).toThrow();
		// min greater than max.
		expect( () =>
			registerScreenEffect(
				def( {
					params: [
						{
							key: 'x',
							label: 'X',
							min: 5,
							max: 1,
							step: 0.1,
							default: 2,
						},
					],
				} ),
			),
		).toThrow();
		// Non-finite default.
		expect( () =>
			registerScreenEffect(
				def( {
					params: [
						{
							key: 'x',
							label: 'X',
							min: 0,
							max: 1,
							step: 0.1,
							default: Number.NaN,
						},
					],
				} ),
			),
		).toThrow();
	} );

	test( 'unregisters by id', async () => {
		const { registerScreenEffect, unregisterScreenEffect, listScreenEffects } =
			await loadRegistry();
		registerScreenEffect( def( { id: 'crt' } ) );
		unregisterScreenEffect( 'crt' );
		expect( listScreenEffects() ).toEqual( [] );
	} );

	test( 'unregisters every effect belonging to one owner', async () => {
		const {
			registerScreenEffect,
			unregisterScreenEffectsByOwner,
			listScreenEffects,
		} = await loadRegistry();
		registerScreenEffect( def( { id: 'a', owner: 'plugin-x' } ) );
		registerScreenEffect( def( { id: 'b', owner: 'plugin-x' } ) );
		registerScreenEffect( def( { id: 'c', owner: 'plugin-y' } ) );

		expect( unregisterScreenEffectsByOwner( 'plugin-x' ) ).toBe( 2 );
		expect( listScreenEffects().map( ( e ) => e.id ) ).toEqual( [ 'c' ] );
		// An empty owner is a no-op, not a mass deletion.
		expect( unregisterScreenEffectsByOwner( '' ) ).toBe( 0 );
		expect( listScreenEffects() ).toHaveLength( 1 );
	} );

	test( 'notifies subscribers on register and unregister', async () => {
		const {
			registerScreenEffect,
			unregisterScreenEffect,
			subscribeScreenEffects,
		} = await loadRegistry();
		const seen = vi.fn();
		const unsubscribe = subscribeScreenEffects( seen );

		registerScreenEffect( def( { id: 'crt' } ) );
		expect( seen ).toHaveBeenCalledTimes( 1 );
		unregisterScreenEffect( 'crt' );
		expect( seen ).toHaveBeenCalledTimes( 2 );

		// Unregistering something absent must not fire.
		unregisterScreenEffect( 'nope' );
		expect( seen ).toHaveBeenCalledTimes( 2 );

		unsubscribe();
		registerScreenEffect( def( { id: 'crt' } ) );
		expect( seen ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'a throwing subscriber does not break the fan-out', async () => {
		const { registerScreenEffect, subscribeScreenEffects } =
			await loadRegistry();
		const spy = vi
			.spyOn( console, 'error' )
			.mockImplementation( () => undefined );
		const good = vi.fn();
		subscribeScreenEffects( () => {
			throw new Error( 'boom' );
		} );
		subscribeScreenEffects( good );

		expect( () =>
			registerScreenEffect( def( { id: 'crt' } ) ),
		).not.toThrow();
		expect( good ).toHaveBeenCalledTimes( 1 );
		spy.mockRestore();
	} );
} );
