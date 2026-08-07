/**
 * The stored Mio look — the shape check every boundary calls.
 *
 * A look crosses four of them (style panel → controller → OS Settings
 * blob → REST → user meta) and can arrive from a hand-edited
 * preference, an older release, or another plugin. What is defended
 * here is the *key set*: nothing outside the whitelist may reach user
 * meta, and in particular nothing that could set a spring constant.
 *
 * Ranges are deliberately NOT defended here — that is
 * `sanitizeMioConfig`'s job, and it runs on everything headed for the
 * simulation whatever route it arrived by. Two validators with
 * overlapping opinions about ranges is how ranges drift apart.
 */
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
		// An empty look means "show me the site's Mio", which is always
		// a perfectly good Mio. Nothing here may throw.
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
			// The one that matters: a stored look must never be a route
			// into the spring constants.
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
		// Only the keys the user moved are stored, so a site that later
		// changes its shipped Mio still shows through everywhere they
		// had no opinion.
		const look = sanitizeMioLook( { appearance: { glow: 1 }, physics: {} } );
		expect( Object.keys( look.appearance ) ).toHaveLength( 1 );
		expect( look.appearance ).not.toHaveProperty( 'hueStart' );
	} );

	test( 'the whitelists match the config they mirror', () => {
		// A key added to `MioLookPhysics` without being added here would
		// be a control the panel can move and the account never
		// remembers.
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
		// The panel thinks in one bag of "things I may change"; the
		// simulation is organised as appearance versus physics. The two
		// share no key names, so the split is unambiguous.
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
