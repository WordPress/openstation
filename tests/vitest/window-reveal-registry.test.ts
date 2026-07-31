/**
 * Unit tests for `src/reveals/registry.ts`.
 *
 * Shared-store-backed like the unfocus-effect registry, so each test
 * resets the stores and re-imports fresh. The five built-ins are seeded
 * at module load through the public `register()` path, so a fresh
 * import always starts with them present.
 *
 * The interesting validation here is the `from` / `to` shape-function
 * check: it is the one rule a plugin author cannot discover from the
 * type signature, and getting it wrong produces a runtime flicker
 * rather than an error, so registration has to be the thing that
 * catches it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';

type Registry = typeof import( '../../src/reveals/registry' );

async function loadRegistry(): Promise< Registry > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	return import( '../../src/reveals/registry' );
}

const BUILT_INS = [
	'sweep',
	'rise',
	'diagonal',
	'iris',
	'diamond',
	'curtain',
	'shutter',
	'blinds',
	'slats',
	'mosaic',
	'radar',
	'obturator',
];

describe( 'reveals/registry.ts — built-ins', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'ships every built-in reveal', async () => {
		const { listWindowReveals } = await loadRegistry();
		expect( listWindowReveals().map( ( r ) => r.id ) ).toEqual(
			expect.arrayContaining( BUILT_INS ),
		);
	} );

	test( 'every built-in carries a label, a description and matched pairs', async () => {
		const { getWindowReveal, revealLayerPairs } = await loadRegistry();
		for ( const id of BUILT_INS ) {
			const def = getWindowReveal( id );
			expect( def, id ).toBeDefined();
			expect( def?.label, id ).toBeTruthy();
			expect( def?.description, id ).toBeTruthy();
			if ( typeof def!.render === 'function' ) {
				// A rendered reveal owns its DOM; it has no pairs.
				continue;
			}
			// Single-pair and multi-layer defs both normalize to a
			// non-empty list of pairs that actually go somewhere.
			const pairs = revealLayerPairs( def! );
			expect( pairs.length, id ).toBeGreaterThan( 0 );
			for ( const pair of pairs ) {
				expect( pair.from, id ).toBeTruthy();
				expect( pair.to, id ).toBeTruthy();
				expect( pair.from, id ).not.toBe( pair.to );
			}
		}
	} );

	test( 'the camera shutter renders itself rather than clipping layers', async () => {
		// A lens iris has a cyclic overlap, and paint order is linear —
		// no stack of clipped layers can represent it. It renders SVG
		// instead; the mechanism itself is covered in
		// `window-reveal-obturator.test.ts`.
		const { getWindowReveal, revealLayerPairs } = await loadRegistry();
		const def = getWindowReveal( 'obturator' )!;
		expect( typeof def.render ).toBe( 'function' );
		expect( def.from ).toBeUndefined();
		expect( def.to ).toBeUndefined();
		expect( def.layers ).toBeUndefined();
		expect( revealLayerPairs( def ) ).toEqual( [] );
	} );

	test( 'no built-in hard-codes a single surface colour', async () => {
		// A reveal is a shape; the site colours it through the theme
		// token. Hard-coding paint takes that choice away from every
		// theme the reveal will ever run under.
		const { getWindowReveal } = await loadRegistry();
		for ( const id of BUILT_INS ) {
			expect( getWindowReveal( id )?.surfaceColor, id ).toBeUndefined();
		}
	} );

	test( 'no built-in claims the reserved `none` id', async () => {
		const { getWindowReveal, WINDOW_REVEAL_NONE } = await loadRegistry();
		expect( WINDOW_REVEAL_NONE ).toBe( 'none' );
		expect( getWindowReveal( 'none' ) ).toBeUndefined();
	} );
} );

describe( 'reveals/registry.ts — registration', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	const valid = {
		id: 'acme/wipe',
		label: 'Wipe',
		from: 'inset( 0% 0% 0% 0% )',
		to: 'inset( 0% 0% 100% 0% )',
	};

	test( 'registers a namespaced reveal', async () => {
		const { registerWindowReveal, getWindowReveal } = await loadRegistry();
		registerWindowReveal( { ...valid } );
		expect( getWindowReveal( 'acme/wipe' )?.label ).toBe( 'Wipe' );
	} );

	test( 're-registering the same id replaces it', async () => {
		const { registerWindowReveal, getWindowReveal, listWindowReveals } =
			await loadRegistry();
		registerWindowReveal( { ...valid } );
		registerWindowReveal( { ...valid, label: 'Wipe v2' } );
		expect( getWindowReveal( 'acme/wipe' )?.label ).toBe( 'Wipe v2' );
		expect(
			listWindowReveals().filter( ( r ) => r.id === 'acme/wipe' ),
		).toHaveLength( 1 );
	} );

	test( 'rejects endpoints that use different shape functions', async () => {
		const { registerWindowReveal } = await loadRegistry();
		expect( () =>
			registerWindowReveal( {
				...valid,
				from: 'inset( 0% )',
				to: 'circle( 0% )',
			} ),
		).toThrow( /same shape function/ );
	} );

	test( 'rejects a bare keyword endpoint like `none`', async () => {
		const { registerWindowReveal } = await loadRegistry();
		expect( () =>
			registerWindowReveal( { ...valid, to: 'none' } ),
		).toThrow( /shape functions/ );
	} );

	test( 'rejects a missing from or to', async () => {
		const { registerWindowReveal } = await loadRegistry();
		expect( () =>
			registerWindowReveal( {
				...valid,
				from: '',
			} ),
		).toThrow( /from/ );
		expect( () =>
			registerWindowReveal( {
				...valid,
				to: undefined as unknown as string,
			} ),
		).toThrow( /to/ );
	} );

	test( 'rejects the reserved `none` id', async () => {
		const { registerWindowReveal } = await loadRegistry();
		expect( () =>
			registerWindowReveal( { ...valid, id: 'none' } ),
		).toThrow( /reserved/ );
	} );

	test( 'rejects an id outside the registry charset', async () => {
		const { registerWindowReveal } = await loadRegistry();
		expect( () =>
			registerWindowReveal( { ...valid, id: 'Acme Wipe' } ),
		).toThrow( /id/ );
	} );

	test( 'rejects a missing label', async () => {
		const { registerWindowReveal } = await loadRegistry();
		expect( () =>
			registerWindowReveal( { ...valid, label: '  ' } ),
		).toThrow( /label/ );
	} );

	test( 'accepts a polygon pair with equal vertex counts', async () => {
		const { registerWindowReveal, getWindowReveal } = await loadRegistry();
		registerWindowReveal( {
			...valid,
			id: 'acme/poly',
			from: 'polygon( 0% 0%, 100% 0%, 100% 100% )',
			to: 'polygon( 50% 50%, 50% 50%, 50% 50% )',
		} );
		expect( getWindowReveal( 'acme/poly' ) ).toBeDefined();
	} );
} );

describe( 'reveals/registry.ts — removal + subscriptions', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'unregister removes a reveal', async () => {
		const { unregisterWindowReveal, getWindowReveal } = await loadRegistry();
		unregisterWindowReveal( 'sweep' );
		expect( getWindowReveal( 'sweep' ) ).toBeUndefined();
	} );

	test( 'unregisterByOwner removes only that owner’s reveals', async () => {
		const {
			registerWindowReveal,
			unregisterWindowRevealsByOwner,
			getWindowReveal,
		} = await loadRegistry();
		registerWindowReveal( {
			id: 'acme/a',
			label: 'A',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
			owner: 'acme-plugin',
		} );
		registerWindowReveal( {
			id: 'acme/b',
			label: 'B',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
			owner: 'other-plugin',
		} );
		expect( unregisterWindowRevealsByOwner( 'acme-plugin' ) ).toBe( 1 );
		expect( getWindowReveal( 'acme/a' ) ).toBeUndefined();
		expect( getWindowReveal( 'acme/b' ) ).toBeDefined();
		// The built-ins carry no owner and must survive.
		expect( getWindowReveal( 'sweep' ) ).toBeDefined();
	} );

	test( 'unregisterByOwner with an empty owner removes nothing', async () => {
		const { unregisterWindowRevealsByOwner, listWindowReveals } =
			await loadRegistry();
		const before = listWindowReveals().length;
		expect( unregisterWindowRevealsByOwner( '' ) ).toBe( 0 );
		expect( listWindowReveals() ).toHaveLength( before );
	} );

	test( 'subscribers fire on register and unregister, and stop after unsubscribe', async () => {
		const {
			registerWindowReveal,
			unregisterWindowReveal,
			subscribeWindowReveals,
		} = await loadRegistry();
		const seen = vi.fn();
		const off = subscribeWindowReveals( seen );
		registerWindowReveal( {
			id: 'acme/c',
			label: 'C',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
		} );
		unregisterWindowReveal( 'acme/c' );
		expect( seen ).toHaveBeenCalledTimes( 2 );
		off();
		unregisterWindowReveal( 'sweep' );
		expect( seen ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'a throwing subscriber does not stop the others', async () => {
		const { registerWindowReveal, subscribeWindowReveals } =
			await loadRegistry();
		const spy = vi
			.spyOn( console, 'error' )
			.mockImplementation( () => undefined );
		const second = vi.fn();
		subscribeWindowReveals( () => {
			throw new Error( 'boom' );
		} );
		subscribeWindowReveals( second );
		registerWindowReveal( {
			id: 'acme/d',
			label: 'D',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
		} );
		expect( second ).toHaveBeenCalled();
		spy.mockRestore();
	} );
} );

describe( 'reveals/registry.ts — clampRevealDuration', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'falls back to the default for missing or non-finite input', async () => {
		const { clampRevealDuration, DEFAULT_REVEAL_DURATION_MS } =
			await loadRegistry();
		expect( clampRevealDuration( undefined ) ).toBe(
			DEFAULT_REVEAL_DURATION_MS,
		);
		expect( clampRevealDuration( Number.NaN ) ).toBe(
			DEFAULT_REVEAL_DURATION_MS,
		);
		expect( clampRevealDuration( Number.POSITIVE_INFINITY ) ).toBe(
			DEFAULT_REVEAL_DURATION_MS,
		);
	} );

	test( 'clamps to the playable range', async () => {
		const {
			clampRevealDuration,
			MIN_REVEAL_DURATION_MS,
			MAX_REVEAL_DURATION_MS,
		} = await loadRegistry();
		expect( clampRevealDuration( 0 ) ).toBe( MIN_REVEAL_DURATION_MS );
		expect( clampRevealDuration( -50 ) ).toBe( MIN_REVEAL_DURATION_MS );
		expect( clampRevealDuration( 999_999 ) ).toBe( MAX_REVEAL_DURATION_MS );
		expect( clampRevealDuration( 500 ) ).toBe( 500 );
	} );
} );
