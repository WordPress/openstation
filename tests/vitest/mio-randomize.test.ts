import { describe, expect, test } from 'vitest';
import { MIO_DEFAULTS, sanitizeMioConfig } from '../../src/mio/config';
import { randomMioLook } from '../../src/mio/randomize';
import { LOOK_PHYSICS_KEYS } from '../../src/mio/look';

function seeded( values: number[] ): () => number {
	let i = 0;
	return () => values[ i++ % values.length ];
}

function samples( count = 400 ) {
	const out = [];
	for ( let i = 0; i < count; i++ ) {
		out.push( randomMioLook() );
	}

	out.push( randomMioLook( seeded( [ 0 ] ) ) );
	out.push( randomMioLook( seeded( [ 0.999999 ] ) ) );
	return out;
}

describe( 'randomMioLook', () => {
	test( 'never rotates the silhouette', () => {

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

			for ( const channel of [
				( body >> 16 ) & 0xff,
				( body >> 8 ) & 0xff,
				body & 0xff,
			] ) {
				expect( channel ).toBeLessThan( 48 );
			}

			expect( look.appearance.bodyAlpha ).toBeGreaterThan( 0.7 );
		}
	} );

	test( 'never picks a shape the shuffle would not', () => {

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

			expect( look.physics.idleWobble ).toBeGreaterThan( 0 );

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

		const source = (): number[] => [ 0.1, 0.9, 0.42, 0.7, 0.05, 0.6 ];
		expect( randomMioLook( seeded( source() ) ) ).toEqual(
			randomMioLook( seeded( source() ) ),
		);
	} );
} );
