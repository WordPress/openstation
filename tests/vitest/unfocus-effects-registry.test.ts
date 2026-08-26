/**
 * Unit tests for `src/effects/registry.ts`.
 *
 * The registry is shared-store-backed (so the main bundle and the
 * lazy OS-settings-panel bundle share one list), so we reset the
 * shared stores and re-import fresh in each test. The built-in
 * `darken` effect is seeded at module load through the public
 * `register()` path, so a fresh import always starts with it present.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';

type Registry = typeof import( '../../src/effects/registry' );

async function loadRegistry(): Promise< Registry > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	return import( '../../src/effects/registry' );
}

describe( 'effects/registry.ts', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'ships the built-in `darken` effect with a class', async () => {
		const { listUnfocusEffects, getUnfocusEffect } = await loadRegistry();
		const darken = getUnfocusEffect( 'darken' );
		expect( darken ).toBeDefined();
		expect( darken?.className ).toBe( 'os-window--fx-darken' );
		expect(
			listUnfocusEffects().map( ( e ) => e.id ),
		).toContain( 'darken' );
	} );

	test( 'ships the built-in `frost` and `grayscale` effects with classes', async () => {
		const { listUnfocusEffects, getUnfocusEffect } = await loadRegistry();
		expect( getUnfocusEffect( 'frost' )?.className ).toBe(
			'os-window--fx-frost',
		);
		expect( getUnfocusEffect( 'grayscale' )?.className ).toBe(
			'os-window--fx-grayscale',
		);
		// All three built-ins resolve and each carries a description.
		const ids = listUnfocusEffects().map( ( e ) => e.id );
		expect( ids ).toEqual(
			expect.arrayContaining( [ 'darken', 'frost', 'grayscale' ] ),
		);
		for ( const id of [ 'darken', 'frost', 'grayscale' ] ) {
			expect( getUnfocusEffect( id )?.description ).toBeTruthy();
		}
	} );

	test( 'register adds an effect', async () => {
		const { registerUnfocusEffect, getUnfocusEffect } = await loadRegistry();
		registerUnfocusEffect( {
			id: 'blur',
			label: 'Blur',
			className: 'x-blur',
		} );
		expect( getUnfocusEffect( 'blur' )?.label ).toBe( 'Blur' );
	} );

	test( 'register with an existing id replaces (late wins)', async () => {
		const { registerUnfocusEffect, getUnfocusEffect } = await loadRegistry();
		registerUnfocusEffect( { id: 'x', label: 'First', className: 'a' } );
		registerUnfocusEffect( { id: 'x', label: 'Second', className: 'b' } );
		expect( getUnfocusEffect( 'x' )?.label ).toBe( 'Second' );
	} );

	test( 'accepts an `apply` callback in place of a className', async () => {
		const { registerUnfocusEffect, getUnfocusEffect } = await loadRegistry();
		const apply = vi.fn();
		registerUnfocusEffect( { id: 'fn', label: 'Fn', apply } );
		expect( getUnfocusEffect( 'fn' )?.apply ).toBe( apply );
	} );

	test( 'rejects a def missing both className and apply', async () => {
		const { registerUnfocusEffect } = await loadRegistry();
		expect( () =>
			registerUnfocusEffect( {
				id: 'bad',
				label: 'Bad',
			} as never ),
		).toThrow();
	} );

	test( 'rejects the reserved id "none"', async () => {
		const { registerUnfocusEffect } = await loadRegistry();
		expect( () =>
			registerUnfocusEffect( {
				id: 'none',
				label: 'None',
				className: 'x',
			} ),
		).toThrow();
	} );

	test( 'rejects ids outside the allowed charset', async () => {
		const { registerUnfocusEffect } = await loadRegistry();
		expect( () =>
			registerUnfocusEffect( {
				id: 'Bad Id!',
				label: 'Bad',
				className: 'x',
			} ),
		).toThrow();
	} );

	test( 'unregister removes an effect', async () => {
		const { registerUnfocusEffect, unregisterUnfocusEffect, getUnfocusEffect } =
			await loadRegistry();
		registerUnfocusEffect( { id: 'temp', label: 'Temp', className: 'x' } );
		unregisterUnfocusEffect( 'temp' );
		expect( getUnfocusEffect( 'temp' ) ).toBeUndefined();
	} );

	test( 'unregisterByOwner removes only the matching owner', async () => {
		const {
			registerUnfocusEffect,
			unregisterUnfocusEffectsByOwner,
			getUnfocusEffect,
		} = await loadRegistry();
		registerUnfocusEffect( {
			id: 'a',
			label: 'A',
			className: 'x',
			owner: 'plugin-a',
		} );
		registerUnfocusEffect( {
			id: 'b',
			label: 'B',
			className: 'y',
			owner: 'plugin-b',
		} );
		const removed = unregisterUnfocusEffectsByOwner( 'plugin-a' );
		expect( removed ).toBe( 1 );
		expect( getUnfocusEffect( 'a' ) ).toBeUndefined();
		expect( getUnfocusEffect( 'b' ) ).toBeDefined();
	} );

	test( 'subscribe fires on register and unregister', async () => {
		const { registerUnfocusEffect, unregisterUnfocusEffect, subscribeUnfocusEffects } =
			await loadRegistry();
		const cb = vi.fn();
		const unsub = subscribeUnfocusEffects( cb );
		registerUnfocusEffect( { id: 'z', label: 'Z', className: 'x' } );
		unregisterUnfocusEffect( 'z' );
		expect( cb ).toHaveBeenCalledTimes( 2 );
		unsub();
		registerUnfocusEffect( { id: 'z2', label: 'Z2', className: 'x' } );
		expect( cb ).toHaveBeenCalledTimes( 2 );
	} );
} );
