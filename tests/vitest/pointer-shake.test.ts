import { describe, expect, test } from 'vitest';
import {
	createShakeDetector,
	DEFAULT_SHAKE_OPTIONS,
	dispatchShake,
	SHAKE_EVENT,
	type ShakeDetail,
	type ShakeDetector,
} from '../../src/window/shake';

function zigzag(
	det: ShakeDetector,
	opts: {
		amplitude: number;
		periodMs: number;
		durationMs: number;
		startT?: number;
		cx?: number;
		cy?: number;
		axis?: 'x' | 'y';
	},
): ShakeDetail | null {
	const { amplitude, periodMs, durationMs } = opts;
	const t0 = opts.startT ?? 1000;
	const cx = opts.cx ?? 500;
	const cy = opts.cy ?? 300;
	const half = periodMs / 2;
	for ( let t = 0; t <= durationMs; t += 16 ) {

		const phase = ( t % periodMs ) / half;
		const tri = phase <= 1 ? -1 + 2 * phase : 3 - 2 * phase;
		const offset = tri * amplitude;
		const x = 'y' === opts.axis ? cx : cx + offset;
		const y = 'y' === opts.axis ? cy + offset : cy;
		const hit = det.feed( x, y, t0 + t );
		if ( hit ) {
			return hit;
		}
	}
	return null;
}

describe( 'shake detector', () => {
	test( 'a sustained side-to-side shake is detected', () => {
		const det = createShakeDetector();

		const hit = zigzag( det, { amplitude: 40, periodMs: 240, durationMs: 1600 } );
		expect( hit ).not.toBeNull();
		expect( hit!.axis ).toBe( 'x' );
		expect( hit!.reversals ).toBeGreaterThanOrEqual(
			DEFAULT_SHAKE_OPTIONS.minReversals,
		);
		expect( hit!.durationMs ).toBeGreaterThanOrEqual(
			DEFAULT_SHAKE_OPTIONS.minDurationMs,
		);
	} );

	test( 'reports the axis the motion was on', () => {
		const det = createShakeDetector();
		const hit = zigzag( det, {
			amplitude: 40,
			periodMs: 240,
			durationMs: 1600,
			axis: 'y',
		} );
		expect( hit?.axis ).toBe( 'y' );
	} );

	test( 'jitter is not a shake', () => {

		const det = createShakeDetector();
		expect(
			zigzag( det, { amplitude: 4, periodMs: 60, durationMs: 4000 } ),
		).toBeNull();
	} );

	test( 'a single overshoot correction is not a shake', () => {

		const det = createShakeDetector();
		expect(
			zigzag( det, { amplitude: 60, periodMs: 600, durationMs: 900 } ),
		).toBeNull();
	} );

	test( 'a fast flick that meets the count is not a shake', () => {

		const det = createShakeDetector();
		expect(
			zigzag( det, { amplitude: 40, periodMs: 120, durationMs: 420 } ),
		).toBeNull();
	} );

	test( 'two wiggles a pause apart are not summed into one shake', () => {
		const det = createShakeDetector();

		expect(
			zigzag( det, { amplitude: 40, periodMs: 240, durationMs: 420, startT: 0 } ),
		).toBeNull();
		expect(
			zigzag( det, { amplitude: 40, periodMs: 240, durationMs: 420, startT: 1100 } ),
		).toBeNull();
	} );

	test( 'a detection is followed by a cooldown', () => {
		const det = createShakeDetector();
		const first = zigzag( det, { amplitude: 40, periodMs: 240, durationMs: 1600, startT: 0 } );
		expect( first ).not.toBeNull();

		const within = zigzag( det, {
			amplitude: 40,
			periodMs: 240,
			durationMs: 500,
			startT: 1700,
		} );
		expect( within ).toBeNull();
	} );

	test( 'reset() forgets a half-built run', () => {
		const det = createShakeDetector();
		zigzag( det, { amplitude: 40, periodMs: 240, durationMs: 800, startT: 0 } );
		det.reset();

		expect(
			zigzag( det, { amplitude: 40, periodMs: 240, durationMs: 800, startT: 816 } ),
		).toBeNull();
	} );

	test( 'the event bubbles from the element it was dispatched on', () => {
		const host = document.createElement( 'div' );
		const child = document.createElement( 'div' );
		host.appendChild( child );
		document.body.appendChild( host );
		let seen: ShakeDetail | null = null;
		document.addEventListener( SHAKE_EVENT, ( e ) => {
			seen = ( e as CustomEvent< ShakeDetail > ).detail;
		} );
		dispatchShake( child, { x: 1, y: 2, durationMs: 1200, reversals: 6, axis: 'x' } );
		expect( seen ).toMatchObject( { x: 1, y: 2, reversals: 6 } );
		host.remove();
	} );
} );
