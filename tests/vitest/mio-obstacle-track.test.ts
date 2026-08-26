/**
 * Mio obstacle interpolation — turning a throttled measurement of the
 * desk into a desk that moves continuously, so a dragged window pushes
 * Mio smoothly instead of one lurch per sample.
 */
import { describe, expect, test } from 'vitest';
import { createObstacleTrack } from '../../src/mio/obstacle-track';
import type { Obstacle } from '../../src/mio/environment';

function obstacle( over: Partial< Obstacle > = {} ): Obstacle {
	return {
		id: 'window:posts',
		kind: 'window',
		face: 'top',
		x: 100,
		y: 200,
		width: 400,
		height: 300,
		...over,
	};
}

/** The throttle Mio samples the desk on, and the lerp window. */
const INTERVAL = 50;

/** The single obstacle in a track's view of the desk at `nowMs`. */
function only(
	track: ReturnType< typeof createObstacleTrack >,
	nowMs: number,
): Obstacle {
	const set = track.at( nowMs );
	expect( set ).toHaveLength( 1 );
	return set[ 0 ];
}

describe( 'createObstacleTrack', () => {
	test( 'the first sample is solid where it is, not lerped in from nowhere', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle() ], 1000 );

		// Half an interval later it must still be exactly where it was
		// measured: a window that just appeared has no history to
		// slide in from.
		expect( only( track, 1025 ) ).toMatchObject( { x: 100, y: 200 } );
	} );

	test( 'a still desk hands back the measured array untouched', () => {
		const track = createObstacleTrack( INTERVAL );
		const first = [ obstacle() ];
		track.sample( first, 1000 );
		const second = [ obstacle() ];
		track.sample( second, 1050 );

		// Identity, not just equality — the still-desk path is the
		// common case and must not allocate a parallel set per frame.
		expect( track.at( 1075 ) ).toBe( second );
	} );

	test( 'a moving obstacle is presented one interval behind, continuously', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { x: 100 } ) ], 1000 );
		track.sample( [ obstacle( { x: 150 } ) ], 1050 );

		// At the sample instant we show where it *was* — the lag that
		// buys the smoothness.
		expect( only( track, 1050 ).x ).toBe( 100 );
		expect( only( track, 1062.5 ).x ).toBe( 112.5 );
		expect( only( track, 1075 ).x ).toBe( 125 );
		expect( only( track, 1100 ).x ).toBe( 150 );
	} );

	test( 'the presented position never runs past the newest sample', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { x: 100 } ) ], 1000 );
		track.sample( [ obstacle( { x: 150 } ) ], 1050 );

		// A late frame clamps rather than extrapolating: overshooting
		// and snapping back is the artefact this module exists to
		// avoid, and it would reappear every time a drag stopped.
		expect( only( track, 5000 ).x ).toBe( 150 );
	} );

	test( 'successive samples hand off without a seam', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { x: 100 } ) ], 1000 );
		track.sample( [ obstacle( { x: 150 } ) ], 1050 );
		const endOfInterval = only( track, 1100 ).x;

		track.sample( [ obstacle( { x: 200 } ) ], 1100 );
		expect( only( track, 1100 ).x ).toBe( endOfInterval );
	} );

	test( 'a short gap after a long one still hands off without a seam', () => {
		// The gaps between samples are irregular by construction: a
		// 50 ms throttle read on 16.7 ms frames fires at 50 ms and at
		// 66.7 ms in whatever order the frames fall. Spreading the lerp
		// over the *measured* previous gap would leave it unfinished
		// whenever a short gap follows a long one, and the next keyframe
		// pair would start from the position the last one was still
		// travelling toward — a jump.
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { x: 100 } ) ], 1000 );
		track.sample( [ obstacle( { x: 150 } ) ], 1066.7 );

		// The lerp spans the throttle, which the throttle guarantees is
		// no longer than the gap — so it has arrived by now.
		expect( only( track, 1116.7 ).x ).toBe( 150 );

		track.sample( [ obstacle( { x: 200 } ) ], 1116.7 );
		expect( only( track, 1116.7 ).x ).toBe( 150 );
	} );

	test( 'size is interpolated too, so a resizing window sweeps', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { width: 400, height: 300 } ) ], 1000 );
		track.sample( [ obstacle( { width: 500, height: 400 } ) ], 1050 );

		expect( only( track, 1075 ) ).toMatchObject( {
			width: 450,
			height: 350,
		} );
	} );

	test( 'a window that opens mid-drag appears solid, its neighbour keeps lerping', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { id: 'window:a', x: 100 } ) ], 1000 );
		track.sample(
			[
				obstacle( { id: 'window:a', x: 150 } ),
				obstacle( { id: 'window:b', x: 700 } ),
			],
			1050,
		);

		const set = track.at( 1075 );
		expect( set.find( ( o ) => 'window:a' === o.id )?.x ).toBe( 125 );
		expect( set.find( ( o ) => 'window:b' === o.id )?.x ).toBe( 700 );
	} );

	test( 'a window that closes simply leaves the set', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample(
			[
				obstacle( { id: 'window:a', x: 100 } ),
				obstacle( { id: 'window:b', x: 700 } ),
			],
			1000,
		);
		track.sample( [ obstacle( { id: 'window:a', x: 150 } ) ], 1050 );

		const set = track.at( 1075 );
		expect( set.map( ( o ) => o.id ) ).toEqual( [ 'window:a' ] );
	} );

	test( 'duplicate ids stay two obstacles', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample(
			[
				obstacle( { id: 'widget:0', x: 100 } ),
				obstacle( { id: 'widget:0', x: 700 } ),
			],
			1000,
		);
		track.sample(
			[
				obstacle( { id: 'widget:0', x: 150 } ),
				obstacle( { id: 'widget:0', x: 750 } ),
			],
			1050,
		);

		// Keying on the bare id would collapse the pair and silently
		// drop one solid surface out of the simulation.
		expect( track.at( 1075 ).map( ( o ) => o.x ) ).toEqual( [ 125, 725 ] );
	} );

	test( 'a long gap between samples is taken at face value', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { x: 100 } ) ], 1000 );
		// Tab backgrounded for two seconds. Interpolating across that
		// would crawl the desk toward its real position for a quarter
		// of a second after the user came back.
		track.sample( [ obstacle( { x: 900 } ) ], 3000 );

		expect( only( track, 3125 ).x ).toBe( 900 );
	} );

	test( 'reset drops the history, keeping the newest sample', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { x: 100 } ) ], 1000 );
		track.sample( [ obstacle( { x: 150 } ) ], 1050 );
		track.reset();

		// A layer rebase is not motion — after it, the newest
		// measurement is the truth immediately.
		expect( only( track, 1050 ).x ).toBe( 150 );
		expect( only( track, 1075 ).x ).toBe( 150 );
	} );
} );
