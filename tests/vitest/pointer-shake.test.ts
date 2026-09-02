/**
 * The shake detector, as a table of pointer traces.
 *
 * Every threshold in the detector exists to reject one specific thing,
 * and every rejection is a test here: jitter (amplitude), a single
 * overshoot correction (count), two wiggles a second apart (gap), and
 * a fast flick (duration). The one positive case is what a hand does
 * when it means "start again".
 */

import { describe, expect, test } from 'vitest';
import {
	createShakeDetector,
	DEFAULT_SHAKE_OPTIONS,
	dispatchShake,
	SHAKE_EVENT,
	type ShakeDetail,
	type ShakeDetector,
} from '../../src/window/shake';

/**
 * Feed a triangle wave on x: the pointer swings `amplitude` px each
 * side of `cx`, one full swing per `periodMs`, sampled every 16ms.
 * Returns the first detection, or null.
 */
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
		// Triangle wave in [-1, 1].
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
		// 40px each side, a swing every 240ms, for 1.6s: ~13 reversals.
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
		// A hand at rest wobbles a few pixels at 120Hz. Below the
		// amplitude floor, forever, and still nothing.
		const det = createShakeDetector();
		expect(
			zigzag( det, { amplitude: 4, periodMs: 60, durationMs: 4000 } ),
		).toBeNull();
	} );

	test( 'a single overshoot correction is not a shake', () => {
		// Out, back, out: two reversals. That is a hand fixing a miss.
		const det = createShakeDetector();
		expect(
			zigzag( det, { amplitude: 60, periodMs: 600, durationMs: 900 } ),
		).toBeNull();
	} );

	test( 'a fast flick that meets the count is not a shake', () => {
		// Six reversals inside 400ms — count satisfied, duration not.
		// A shake is sustained; a flick is over before it began.
		const det = createShakeDetector();
		expect(
			zigzag( det, { amplitude: 40, periodMs: 120, durationMs: 420 } ),
		).toBeNull();
	} );

	test( 'two wiggles a pause apart are not summed into one shake', () => {
		const det = createShakeDetector();
		// Three reversals, then a 600ms pause, then three more. Each
		// half is short of the count on its own; the gap must keep
		// them apart.
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
		// Keep shaking straight through: nothing for the cooldown, then
		// a fresh shake needs its own full duration.
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
		// Another 800ms would have completed the run had it survived.
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
