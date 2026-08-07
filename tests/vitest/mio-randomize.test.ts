/**
 * "Surprise me" — the random Mio behind the button in the style panel.
 *
 * The thing worth testing about a randomizer is not that it varies. It
 * is that it *cannot* produce the looks a user would read as broken —
 * an upside-down heart, a seam in the gradient, a grey companion — and
 * that everything it does produce survives the sanitizer unchanged,
 * because a random look that gets clamped on the way in is a slider
 * range nobody meant.
 */
import { describe, expect, test } from 'vitest';
import { MIO_DEFAULTS, sanitizeMioConfig } from '../../src/mio/config';
import { randomMioLook } from '../../src/mio/randomize';
import { LOOK_PHYSICS_KEYS } from '../../src/mio/look';

/** A deterministic `random()` cycling through the given values. */
function seeded( values: number[] ): () => number {
	let i = 0;
	return () => values[ i++ % values.length ];
}

/** Every look a fixed set of samples can produce, plus the extremes. */
function samples( count = 400 ) {
	const out = [];
	for ( let i = 0; i < count; i++ ) {
		out.push( randomMioLook() );
	}
	// The corners of the space: `random()` pinned low and pinned high.
	out.push( randomMioLook( seeded( [ 0 ] ) ) );
	out.push( randomMioLook( seeded( [ 0.999999 ] ) ) );
	return out;
}

describe( 'randomMioLook', () => {
	test( 'never rotates the silhouette', () => {
		// An upside-down heart is not a variation, it is a mistake —
		// and the fastest way to make a carefully authored shape read
		// as broken.
		for ( const look of samples() ) {
			expect( look.physics.shapeAngle ).toBe( 0 );
		}
	} );

	test( 'never leaves a seam in the gradient', () => {
		for ( const look of samples() ) {
			expect( look.appearance.hueLoop ).toBe( true );
		}
	} );

	test( 'never lands on a grey or a dim companion', () => {
		// Uniform noise across saturation and lightness produces
		// something washed out most of the time, and a user who presses
		// the button twice and gets two of those concludes it is broken.
		for ( const look of samples() ) {
			expect( look.appearance.saturation ).toBeGreaterThanOrEqual( 0.68 );
			expect( look.appearance.lightness ).toBeGreaterThanOrEqual( 0.52 );
			expect( look.appearance.lightness ).toBeLessThanOrEqual( 0.78 );
			expect( look.appearance.glow ).toBeGreaterThan( 0.5 );
		}
	} );

	test( 'keeps the body dark enough for the ring to read against', () => {
		for ( const look of samples() ) {
			const body = look.appearance.bodyColor as number;
			/* eslint-disable no-bitwise -- packed 24-bit colour. */
			for ( const channel of [
				( body >> 16 ) & 0xff,
				( body >> 8 ) & 0xff,
				body & 0xff,
			] ) {
				expect( channel ).toBeLessThan( 48 );
			}
			/* eslint-enable no-bitwise */
			expect( look.appearance.bodyAlpha ).toBeGreaterThan( 0.7 );
		}
	} );

	test( 'never picks a shape the shuffle would not', () => {
		// `custom` is a shape someone configured on purpose, and
		// `circle` is the one preset with nothing to look at — a
		// randomizer landing on it has wasted the press.
		for ( const look of samples() ) {
			expect( look.physics.shapePreset ).not.toBe( 'custom' );
			expect( look.physics.shapePreset ).not.toBe( 'circle' );
		}
	} );

	test( 'never touches the shuffle the user set', () => {
		for ( const look of samples() ) {
			expect( look.physics ).not.toHaveProperty( 'shapeShuffle' );
		}
	} );

	test( 'leaves Mio alive but never twitchy', () => {
		for ( const look of samples() ) {
			// Never zero: a still companion is a setting, not a surprise.
			expect( look.physics.idleWobble ).toBeGreaterThan( 0 );
			// And never near the top of the range, which reads as a
			// shiver rather than as breathing.
			expect( look.physics.idleWobble ).toBeLessThanOrEqual( 0.16 );
			expect( look.physics.idleWobbleSpeed ).toBeLessThanOrEqual( 1.1 );
		}
	} );

	test( 'writes only keys the panel is allowed to write', () => {
		for ( const look of samples( 40 ) ) {
			for ( const key of Object.keys( look.appearance ) ) {
				expect( MIO_DEFAULTS.appearance ).toHaveProperty( key );
			}
			for ( const key of Object.keys( look.physics ) ) {
				expect( LOOK_PHYSICS_KEYS ).toContain( key );
			}
		}
	} );

	test( 'every value survives the sanitizer unchanged', () => {
		// A random look that gets clamped is a range nobody meant.
		for ( const look of samples( 200 ) ) {
			const config = sanitizeMioConfig( {
				appearance: look.appearance,
				physics: look.physics,
			} );
			for ( const [ key, value ] of Object.entries( look.appearance ) ) {
				expect( config.appearance[ key as never ] ).toEqual( value );
			}
			for ( const [ key, value ] of Object.entries( look.physics ) ) {
				expect( config.physics[ key as never ] ).toEqual( value );
			}
		}
	} );

	test( 'actually varies', () => {
		const seen = new Set(
			samples( 60 ).map( ( l ) => JSON.stringify( l ) ),
		);
		expect( seen.size ).toBeGreaterThan( 50 );
	} );

	test( 'is driven entirely by the injected random source', () => {
		// Same source, same look — which is what makes the guarantees
		// above testable at the extremes rather than sampled and hoped.
		const source = (): number[] => [ 0.1, 0.9, 0.42, 0.7, 0.05, 0.6 ];
		expect( randomMioLook( seeded( source() ) ) ).toEqual(
			randomMioLook( seeded( source() ) ),
		);
	} );
} );
