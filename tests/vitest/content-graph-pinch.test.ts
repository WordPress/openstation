/**
 * Content Graph — pinch-to-zoom maths.
 *
 * Pins the one property a pinch has to keep: the world point under the
 * fingers' midpoint stays under it, whether the hands spread, close, or
 * drift sideways; plus the clamp and the degenerate pair.
 */
import { describe, expect, test } from 'vitest';
import { pinchCamera, type Camera, type PointerPair } from '../../src/content-graph/pinch';

const BOUNDS = { min: 0.15, max: 4 };

function worldUnder( camera: Camera, x: number, y: number ) {
	return { x: ( x - camera.x ) / camera.scale, y: ( y - camera.y ) / camera.scale };
}

describe( 'pinchCamera', () => {
	test( 'spreading the fingers zooms in about their midpoint', () => {
		const camera: Camera = { scale: 1, x: 40, y: 20 };
		const prev: PointerPair = { a: { x: 100, y: 100 }, b: { x: 200, y: 100 } };
		const next: PointerPair = { a: { x: 50, y: 100 }, b: { x: 250, y: 100 } };
		const out = pinchCamera( camera, prev, next, BOUNDS );
		expect( out.scale ).toBeCloseTo( 2 );
		// The midpoint (150,100) did not move, so the world under it is unchanged.
		expect( worldUnder( out, 150, 100 ) ).toEqual( worldUnder( camera, 150, 100 ) );
	} );

	test( 'closing the fingers zooms out, and a drifting midpoint pans', () => {
		const camera: Camera = { scale: 2, x: 0, y: 0 };
		const prev: PointerPair = { a: { x: 100, y: 100 }, b: { x: 300, y: 100 } };
		const next: PointerPair = { a: { x: 180, y: 140 }, b: { x: 280, y: 140 } };
		const out = pinchCamera( camera, prev, next, BOUNDS );
		expect( out.scale ).toBeCloseTo( 1 );
		// What was under (200,100) is now under (230,140).
		const before = worldUnder( camera, 200, 100 );
		const after = worldUnder( out, 230, 140 );
		expect( after.x ).toBeCloseTo( before.x );
		expect( after.y ).toBeCloseTo( before.y );
	} );

	test( 'the scale is clamped to the bounds', () => {
		const camera: Camera = { scale: 3.5, x: 0, y: 0 };
		const prev: PointerPair = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
		const next: PointerPair = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
		expect( pinchCamera( camera, prev, next, BOUNDS ).scale ).toBe( 4 );
		const tiny: Camera = { scale: 0.2, x: 0, y: 0 };
		expect( pinchCamera( tiny, next, prev, BOUNDS ).scale ).toBe( 0.15 );
	} );

	test( 'two fingers on one point only pan', () => {
		const camera: Camera = { scale: 1.5, x: 10, y: 10 };
		const prev: PointerPair = { a: { x: 50, y: 50 }, b: { x: 50, y: 50 } };
		const next: PointerPair = { a: { x: 70, y: 40 }, b: { x: 70, y: 40 } };
		const out = pinchCamera( camera, prev, next, BOUNDS );
		expect( out.scale ).toBe( 1.5 );
		expect( out.x ).toBeCloseTo( 30 );
		expect( out.y ).toBeCloseTo( 0 );
	} );
} );
