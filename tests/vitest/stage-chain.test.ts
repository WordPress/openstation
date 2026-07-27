/**
 * Unit tests for `src/stage/chain.ts` — the pure half of the canvas
 * stage. No DOM, no Pixi, no WebGL: every ordering, clamping and
 * sanitizing rule the shader chain depends on is exercised here.
 */
import { describe, expect, test } from 'vitest';
import {
	chainsAreEqual,
	MAX_SCREEN_EFFECTS,
	resolveEffectChain,
	resolveParams,
	sanitizeScreenEffectSelection,
} from '../../src/stage/chain';
import type { ScreenEffectDef } from '../../src/stage/types';

function def( overrides: Partial< ScreenEffectDef > = {} ): ScreenEffectDef {
	return {
		id: 'test',
		label: 'Test',
		createFilter: () => ( {} as never ),
		...overrides,
	};
}

const withParam = ( id: string, order?: number ): ScreenEffectDef =>
	def( {
		id,
		order,
		params: [
			{ key: 'amount', label: 'Amount', min: 0, max: 10, step: 1, default: 4 },
		],
	} );

describe( 'sanitizeScreenEffectSelection', () => {
	test( 'returns an empty list for non-arrays', () => {
		expect( sanitizeScreenEffectSelection( undefined ) ).toEqual( [] );
		expect( sanitizeScreenEffectSelection( null ) ).toEqual( [] );
		expect( sanitizeScreenEffectSelection( 'crt' ) ).toEqual( [] );
		expect( sanitizeScreenEffectSelection( { id: 'crt' } ) ).toEqual( [] );
	} );

	test( 'keeps well-formed entries and lower-cases ids', () => {
		expect(
			sanitizeScreenEffectSelection( [ { id: ' CRT ' }, { id: 'scanlines' } ] ),
		).toEqual( [ { id: 'crt' }, { id: 'scanlines' } ] );
	} );

	test( 'keeps ids that are not registered anywhere', () => {
		// A plugin's effect must survive the round-trip while its plugin
		// is deactivated — resolution happens later, against the live
		// registry.
		expect(
			sanitizeScreenEffectSelection( [ { id: 'some-plugin/glitch' } ] ),
		).toEqual( [ { id: 'some-plugin/glitch' } ] );
	} );

	test( 'drops malformed entries and illegal ids', () => {
		expect(
			sanitizeScreenEffectSelection( [
				null,
				'crt',
				{ id: 42 },
				{ id: '' },
				{ id: 'Bad Id!' },
				{ id: 'ok' },
			] ),
		).toEqual( [ { id: 'ok' } ] );
	} );

	test( 'de-duplicates by id, first occurrence wins', () => {
		expect(
			sanitizeScreenEffectSelection( [
				{ id: 'crt', params: { a: 1 } },
				{ id: 'crt', params: { a: 2 } },
			] ),
		).toEqual( [ { id: 'crt', params: { a: 1 } } ] );
	} );

	test( 'coerces numeric params and drops the rest', () => {
		expect(
			sanitizeScreenEffectSelection( [
				{
					id: 'crt',
					params: {
						good: 3,
						asString: '2.5',
						nope: 'abc',
						nan: Number.NaN,
						infinite: Number.POSITIVE_INFINITY,
						'bad key': 1,
					},
				},
			] ),
		).toEqual( [ { id: 'crt', params: { good: 3, asString: 2.5 } } ] );
	} );

	test( 'omits the params key entirely when nothing survives', () => {
		expect(
			sanitizeScreenEffectSelection( [ { id: 'crt', params: { bad: 'x' } } ] ),
		).toEqual( [ { id: 'crt' } ] );
	} );

	test( 'caps the chain length', () => {
		const raw = Array.from( { length: 20 }, ( _, i ) => ( { id: `fx-${ i }` } ) );
		expect( sanitizeScreenEffectSelection( raw ) ).toHaveLength(
			MAX_SCREEN_EFFECTS,
		);
	} );
} );

describe( 'resolveParams', () => {
	test( 'fills defaults for missing values', () => {
		expect( resolveParams( withParam( 'a' ) ) ).toEqual( { amount: 4 } );
	} );

	test( 'clamps into range', () => {
		expect( resolveParams( withParam( 'a' ), { amount: 99 } ) ).toEqual( {
			amount: 10,
		} );
		expect( resolveParams( withParam( 'a' ), { amount: -5 } ) ).toEqual( {
			amount: 0,
		} );
	} );

	test( 'falls back to the default for non-finite values', () => {
		expect(
			resolveParams( withParam( 'a' ), { amount: Number.NaN } ),
		).toEqual( { amount: 4 } );
	} );

	test( 'drops params the def does not declare', () => {
		expect(
			resolveParams( withParam( 'a' ), { amount: 2, stale: 7 } ),
		).toEqual( { amount: 2 } );
	} );

	test( 'returns an empty object for a param-less effect', () => {
		expect( resolveParams( def() ) ).toEqual( {} );
	} );
} );

describe( 'resolveEffectChain', () => {
	test( 'skips ids that are not registered', () => {
		const chain = resolveEffectChain(
			[ { id: 'crt' }, { id: 'ghost' } ],
			[ def( { id: 'crt' } ) ],
		);
		expect( chain.map( ( e ) => e.def.id ) ).toEqual( [ 'crt' ] );
	} );

	test( 'sorts by the def order, not the selection order', () => {
		const chain = resolveEffectChain(
			[ { id: 'crt' }, { id: 'pixel' }, { id: 'scan' } ],
			[
				def( { id: 'crt', order: 30 } ),
				def( { id: 'pixel', order: 10 } ),
				def( { id: 'scan', order: 20 } ),
			],
		);
		expect( chain.map( ( e ) => e.def.id ) ).toEqual( [
			'pixel',
			'scan',
			'crt',
		] );
	} );

	test( 'breaks order ties with the selection order', () => {
		const chain = resolveEffectChain(
			[ { id: 'b' }, { id: 'a' } ],
			[ def( { id: 'a' } ), def( { id: 'b' } ) ],
		);
		expect( chain.map( ( e ) => e.def.id ) ).toEqual( [ 'b', 'a' ] );
	} );

	test( 'defaults a missing order to 100', () => {
		const chain = resolveEffectChain(
			[ { id: 'unordered' }, { id: 'late' } ],
			[ def( { id: 'unordered' } ), def( { id: 'late', order: 200 } ) ],
		);
		expect( chain.map( ( e ) => e.def.id ) ).toEqual( [
			'unordered',
			'late',
		] );
	} );

	test( 'resolves params against the def', () => {
		const chain = resolveEffectChain(
			[ { id: 'a', params: { amount: 999 } } ],
			[ withParam( 'a' ) ],
		);
		expect( chain[ 0 ].params ).toEqual( { amount: 10 } );
	} );

	test( 'returns an empty chain for an empty selection', () => {
		expect( resolveEffectChain( [], [ def() ] ) ).toEqual( [] );
	} );
} );

describe( 'chainsAreEqual', () => {
	const a = withParam( 'a' );
	const b = withParam( 'b' );

	test( 'equal for identical chains', () => {
		expect(
			chainsAreEqual(
				[ { def: a, params: { amount: 1 } } ],
				[ { def: a, params: { amount: 1 } } ],
			),
		).toBe( true );
	} );

	test( 'differs on length, def, order or a param value', () => {
		expect(
			chainsAreEqual( [ { def: a, params: {} } ], [] ),
		).toBe( false );
		expect(
			chainsAreEqual(
				[ { def: a, params: {} } ],
				[ { def: b, params: {} } ],
			),
		).toBe( false );
		expect(
			chainsAreEqual(
				[
					{ def: a, params: {} },
					{ def: b, params: {} },
				],
				[
					{ def: b, params: {} },
					{ def: a, params: {} },
				],
			),
		).toBe( false );
		expect(
			chainsAreEqual(
				[ { def: a, params: { amount: 1 } } ],
				[ { def: a, params: { amount: 2 } } ],
			),
		).toBe( false );
	} );

	test( 'differs when one side has an extra param key', () => {
		expect(
			chainsAreEqual(
				[ { def: a, params: { amount: 1 } } ],
				[ { def: a, params: { amount: 1, extra: 0 } } ],
			),
		).toBe( false );
	} );
} );
