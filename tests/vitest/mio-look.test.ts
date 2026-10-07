import { describe, expect, test } from 'vitest';
import { MIO_DEFAULTS } from '../../src/mio/config';
import {
	emptyMioLook,
	isEmptyMioLook,
	sanitizeMioLook,
	splitMioLook,
	LOOK_PHYSICS_KEYS,
} from '../../src/mio/look';

describe( 'sanitizeMioLook', () => {
	test( 'anything unreadable becomes an empty look', () => {

		for ( const raw of [
			undefined,
			null,
			0,
			'',
			'nonsense',
			[],
			[ { appearance: {} } ],
			{ appearance: 'nope', shape: 7 },
		] ) {
			expect( sanitizeMioLook( raw ) ).toEqual( emptyMioLook() );
		}
	} );

	test( 'keeps the keys a user can actually set', () => {
		const look = sanitizeMioLook( {
			appearance: { glow: 2, hueLoop: false, bodyColor: '#ff00aa' },
			physics: { shapePreset: 'star', shapeAmount: 0.8, idleWobble: 0 },
		} );
		expect( look ).toEqual( {
			appearance: { glow: 2, hueLoop: false, bodyColor: '#ff00aa' },
			physics: { shapePreset: 'star', shapeAmount: 0.8, idleWobble: 0 },
		} );
	} );

	test( 'drops every key outside the whitelist', () => {
		const look = sanitizeMioLook( {
			appearance: { glow: 1, notAThing: 5 },

			physics: { shapePreset: 'heart', radialStiffness: 9, pressure: 0 },
		} );
		expect( Object.keys( look.appearance ) ).toEqual( [ 'glow' ] );
		expect( Object.keys( look.physics ) ).toEqual( [ 'shapePreset' ] );
	} );

	test( 'drops values that are not worth storing', () => {
		const look = sanitizeMioLook( {
			appearance: {
				glow: Number.NaN,
				saturation: Number.POSITIVE_INFINITY,
				lightness: null,
				eyeScale: { nested: true },
				bodyAlpha: [ 1 ],
			},
			shape: {},
		} );
		expect( look.appearance ).toEqual( {} );
	} );

	test( 'a partial look stays partial', () => {

		const look = sanitizeMioLook( { appearance: { glow: 1 }, physics: {} } );
		expect( Object.keys( look.appearance ) ).toHaveLength( 1 );
		expect( look.appearance ).not.toHaveProperty( 'hueStart' );
	} );

	test( 'the whitelists match the config they mirror', () => {

		for ( const key of LOOK_PHYSICS_KEYS ) {
			expect( MIO_DEFAULTS.physics ).toHaveProperty( key );
		}
		const roundTrip = sanitizeMioLook( {
			appearance: Object.fromEntries(
				Object.entries( MIO_DEFAULTS.appearance ),
			),
			physics: Object.fromEntries(
				LOOK_PHYSICS_KEYS.map( ( k ) => [ k, MIO_DEFAULTS.physics[ k ] ] ),
			),
		} );
		expect( Object.keys( roundTrip.appearance ).sort() ).toEqual(
			Object.keys( MIO_DEFAULTS.appearance ).sort(),
		);
		expect( Object.keys( roundTrip.physics ).sort() ).toEqual(
			[ ...LOOK_PHYSICS_KEYS ].sort(),
		);
	} );
} );

describe( 'splitMioLook', () => {
	test( 'routes a flat bag to the group each key belongs to', () => {

		expect(
			splitMioLook( {
				glow: 2,
				shapePreset: 'star',
				idleWobble: 0,
			} ),
		).toEqual( {
			appearance: { glow: 2 },
			physics: { shapePreset: 'star', idleWobble: 0 },
		} );
	} );

	test( 'drops anything belonging to neither', () => {
		expect(
			splitMioLook( {
				radialStiffness: 9,
				damping: 0,
				nonsense: true,
			} as never ),
		).toEqual( emptyMioLook() );
	} );
} );

describe( 'isEmptyMioLook', () => {
	test( 'tells an opinion from the absence of one', () => {
		expect( isEmptyMioLook( emptyMioLook() ) ).toBe( true );
		expect(
			isEmptyMioLook( { appearance: { glow: 1 }, physics: {} } ),
		).toBe( false );
		expect(
			isEmptyMioLook( { appearance: {}, physics: { shapePreset: 'star' } } ),
		).toBe( false );
	} );
} );
