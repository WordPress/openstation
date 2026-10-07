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

const INTERVAL = 50;

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

		expect( only( track, 1025 ) ).toMatchObject( { x: 100, y: 200 } );
	} );

	test( 'a still desk hands back the measured array untouched', () => {
		const track = createObstacleTrack( INTERVAL );
		const first = [ obstacle() ];
		track.sample( first, 1000 );
		const second = [ obstacle() ];
		track.sample( second, 1050 );

		expect( track.at( 1075 ) ).toBe( second );
	} );

	test( 'a moving obstacle is presented one interval behind, continuously', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { x: 100 } ) ], 1000 );
		track.sample( [ obstacle( { x: 150 } ) ], 1050 );

		expect( only( track, 1050 ).x ).toBe( 100 );
		expect( only( track, 1062.5 ).x ).toBe( 112.5 );
		expect( only( track, 1075 ).x ).toBe( 125 );
		expect( only( track, 1100 ).x ).toBe( 150 );
	} );

	test( 'the presented position never runs past the newest sample', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { x: 100 } ) ], 1000 );
		track.sample( [ obstacle( { x: 150 } ) ], 1050 );

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

		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { x: 100 } ) ], 1000 );
		track.sample( [ obstacle( { x: 150 } ) ], 1066.7 );

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

		expect( track.at( 1075 ).map( ( o ) => o.x ) ).toEqual( [ 125, 725 ] );
	} );

	test( 'a long gap between samples is taken at face value', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { x: 100 } ) ], 1000 );

		track.sample( [ obstacle( { x: 900 } ) ], 3000 );

		expect( only( track, 3125 ).x ).toBe( 900 );
	} );

	test( 'reset drops the history, keeping the newest sample', () => {
		const track = createObstacleTrack( INTERVAL );
		track.sample( [ obstacle( { x: 100 } ) ], 1000 );
		track.sample( [ obstacle( { x: 150 } ) ], 1050 );
		track.reset();

		expect( only( track, 1050 ).x ).toBe( 150 );
		expect( only( track, 1075 ).x ).toBe( 150 );
	} );
} );
