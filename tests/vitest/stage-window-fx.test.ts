/**
 * Unit tests for the window transition effect registry and its
 * selection sanitizing — the parts that carry a contract without
 * needing a GPU.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { sanitizeWindowEffectSelection } from '../../src/stage/window-fx/selection';
import type { WindowEffectDef } from '../../src/stage/window-fx/types';

type Registry = typeof import( '../../src/stage/window-fx/registry' );

async function loadRegistry(): Promise< Registry > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	return import( '../../src/stage/window-fx/registry' );
}

function def( overrides: Partial< WindowEffectDef > = {} ): WindowEffectDef {
	return {
		id: 'test-fx',
		label: 'Test',
		transitions: [ 'close' ],
		run: () => undefined,
		...overrides,
	};
}

describe( 'window-fx/registry', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'starts empty — built-ins ship with the lazy stage bundle', async () => {
		const { listWindowEffects } = await loadRegistry();
		expect( listWindowEffects() ).toEqual( [] );
	} );

	test( 'registers and looks up an effect', async () => {
		const { registerWindowEffect, getWindowEffect } = await loadRegistry();
		registerWindowEffect( def( { id: 'vanish', label: 'Vanish' } ) );
		expect( getWindowEffect( 'vanish' )?.label ).toBe( 'Vanish' );
	} );

	test( 'rejects the reserved "none" id', async () => {
		const { registerWindowEffect } = await loadRegistry();
		// `none` is what the settings picker uses to mean "no effect", so
		// a def claiming it would be unselectable-but-present.
		expect( () => registerWindowEffect( def( { id: 'none' } ) ) ).toThrow();
	} );

	test( 'requires at least one valid transition', async () => {
		const { registerWindowEffect } = await loadRegistry();
		expect( () =>
			registerWindowEffect( def( { transitions: [] } ) ),
		).toThrow();
		expect( () =>
			registerWindowEffect( {
				...def(),
				transitions: [ 'explode' ],
			} as unknown as WindowEffectDef ),
		).toThrow();
	} );

	test( 'requires a run function', async () => {
		const { registerWindowEffect } = await loadRegistry();
		expect( () =>
			registerWindowEffect( {
				id: 'no-run',
				label: 'No run',
				transitions: [ 'close' ],
			} as unknown as WindowEffectDef ),
		).toThrow();
	} );

	test( 'listWindowEffectsFor filters by transition', async () => {
		const { registerWindowEffect, listWindowEffectsFor } =
			await loadRegistry();
		registerWindowEffect( def( { id: 'closer', transitions: [ 'close' ] } ) );
		registerWindowEffect(
			def( { id: 'minimiser', transitions: [ 'minimize', 'restore' ] } ),
		);

		expect( listWindowEffectsFor( 'close' ).map( ( d ) => d.id ) ).toEqual( [
			'closer',
		] );
		expect(
			listWindowEffectsFor( 'restore' ).map( ( d ) => d.id ),
		).toEqual( [ 'minimiser' ] );
		expect( listWindowEffectsFor( 'focus' ) ).toEqual( [] );
	} );

	test( 'unregisters by owner', async () => {
		const { registerWindowEffect, unregisterWindowEffectsByOwner, listWindowEffects } =
			await loadRegistry();
		registerWindowEffect( def( { id: 'a', owner: 'plugin-x' } ) );
		registerWindowEffect( def( { id: 'b', owner: 'plugin-x' } ) );
		registerWindowEffect( def( { id: 'c' } ) );

		expect( unregisterWindowEffectsByOwner( 'plugin-x' ) ).toBe( 2 );
		expect( listWindowEffects().map( ( d ) => d.id ) ).toEqual( [ 'c' ] );
	} );
} );

describe( 'sanitizeWindowEffectSelection', () => {
	test( 'returns an empty map for non-objects and arrays', () => {
		expect( sanitizeWindowEffectSelection( null ) ).toEqual( {} );
		expect( sanitizeWindowEffectSelection( 'vanish' ) ).toEqual( {} );
		expect( sanitizeWindowEffectSelection( [ { id: 'vanish' } ] ) ).toEqual(
			{},
		);
	} );

	test( 'keeps well-formed entries and lower-cases the id', () => {
		expect(
			sanitizeWindowEffectSelection( { close: { id: ' Vanish ' } } ),
		).toEqual( { close: { id: 'vanish' } } );
	} );

	test( 'drops unknown transition keys', () => {
		// The transition set is fixed and ours, unlike effect ids.
		expect(
			sanitizeWindowEffectSelection( {
				close: { id: 'vanish' },
				explode: { id: 'vanish' },
			} ),
		).toEqual( { close: { id: 'vanish' } } );
	} );

	test( 'keeps effect ids that are not registered', () => {
		// A deactivated plugin's effect must survive the round-trip.
		expect(
			sanitizeWindowEffectSelection( { open: { id: 'acme/swoosh' } } ),
		).toEqual( { open: { id: 'acme/swoosh' } } );
	} );

	test( 'drops focus and blur — they are not offered', () => {
		// Removed from WINDOW_TRANSITIONS: an effect animates a COPY of
		// the window, and mid-click that copy is either invisible
		// (swallowing the click) or duplicated. Neither is acceptable.
		expect(
			sanitizeWindowEffectSelection( {
				focus: { id: 'scale-fade' },
				blur: { id: 'scale-fade' },
				open: { id: 'scale-fade' },
			} ),
		).toEqual( { open: { id: 'scale-fade' } } );
	} );

	test( 'coerces numeric params and drops the rest', () => {
		expect(
			sanitizeWindowEffectSelection( {
				close: {
					id: 'vanish',
					params: {
						duration: 900,
						asString: '24',
						nope: 'abc',
						'bad key': 1,
					},
				},
			} ),
		).toEqual( {
			close: { id: 'vanish', params: { duration: 900, asString: 24 } },
		} );
	} );

	test( 'omits params entirely when none survive', () => {
		expect(
			sanitizeWindowEffectSelection( {
				close: { id: 'vanish', params: { bad: 'x' } },
			} ),
		).toEqual( { close: { id: 'vanish' } } );
	} );

	test( 'drops malformed entries and illegal ids', () => {
		expect(
			sanitizeWindowEffectSelection( {
				open: null,
				close: { id: 'Bad Id!' },
				minimize: { id: 42 },
				drag: { id: 'ok' },
			} ),
		).toEqual( { drag: { id: 'ok' } } );
	} );
} );
