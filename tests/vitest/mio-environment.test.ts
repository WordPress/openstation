/**
 * Mio environment awareness — turning the shell's live collision
 * surfaces into obstacles, deciding how hard nearby windows pull,
 * resolving contact, and digging Mio out when a window opens
 * on top of it.
 */
import { describe, expect, test } from 'vitest';
import {
	clampOutsideChrome,
	clampToBounds,
	closestPointOn,
	clusterBounds,
	collectObstacles,
	distanceToObstacle,
	findEscape,
	magnetPull,
	resolveObstacleCollisions,
	type Obstacle,
} from '../../src/mio/environment';
import type { WallpaperSurface } from '../../src/wallpapers/surfaces';

/** Body radius used throughout — the magnet works edge-to-edge. */
const RADIUS = 50;

function surface( over: Partial< WallpaperSurface > = {} ): WallpaperSurface {
	return {
		id: 'window:posts',
		kind: 'window',
		rect: { x: 100, y: 200, width: 400, height: 300 },
		face: 'top',
		element: null,
		...over,
	};
}

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

/** Layer size used by the chrome cases. */
const LAYER = { width: 1200, height: 800 };

/** The shell's left dock rail, as it actually reaches Mio. */
function leftRail( over: Partial< WallpaperSurface > = {} ): WallpaperSurface {
	return surface( {
		id: 'dock:edge',
		kind: 'dock',
		// The shell publishes a one-pixel strip on the dock's inner edge.
		rect: { x: 71, y: 0, width: 1, height: 800 },
		face: 'right',
		...over,
	} );
}

describe( 'collectObstacles', () => {
	test( 'rebases viewport rects into layer coordinates', () => {
		const out = collectObstacles( [ surface() ], { left: 40, top: 32 } );
		expect( out ).toEqual( [
			{
				id: 'window:posts',
				kind: 'window',
				face: 'top',
				x: 60,
				y: 168,
				width: 400,
				height: 300,
			},
		] );
	} );

	test( 'drops degenerate rects', () => {
		const out = collectObstacles(
			[
				surface( { id: 'a', rect: { x: 0, y: 0, width: 0, height: 10 } } ),
				surface( { id: 'b', rect: { x: 0, y: 0, width: 10, height: 0 } } ),
				surface( { id: 'c' } ),
			],
			{ left: 0, top: 0 },
		);
		expect( out.map( ( o ) => o.id ) ).toEqual( [ 'c' ] );
	} );

	test( 'keeps thin synthetic strips like the shell floor', () => {
		const out = collectObstacles(
			[
				surface( {
					id: 'shell:floor',
					kind: 'shell',
					rect: { x: 0, y: 799, width: 1200, height: 1 },
				} ),
			],
			{ left: 0, top: 0 },
		);
		expect( out ).toHaveLength( 1 );
		expect( out[ 0 ].kind ).toBe( 'shell' );
	} );

	test( 'inflates the dock strip into a solid the rim can hit', () => {
		// The bug this exists for: as published, the rail is one pixel
		// wide, so a rim point 30 px inside the dock is inside nothing
		// and Mio sinks straight through.
		const [ rail ] = collectObstacles( [ leftRail() ], { left: 0, top: 0 }, LAYER );
		expect( rail.x ).toBe( 0 );
		expect( rail.width ).toBe( 72 );
		expect( rail.height ).toBe( 800 );
	} );

	test( 'inflates a bottom dock downward', () => {
		const [ dock ] = collectObstacles(
			[
				leftRail( {
					rect: { x: 0, y: 740, width: 1200, height: 1 },
					face: 'top',
				} ),
			],
			{ left: 0, top: 0 },
			LAYER,
		);
		expect( dock.y ).toBe( 740 );
		expect( dock.height ).toBe( 60 );
	} );

	test( 'leaves windows and widgets as published', () => {
		const [ win ] = collectObstacles( [ surface() ], { left: 0, top: 0 }, LAYER );
		expect( [ win.x, win.y, win.width, win.height ] ).toEqual( [
			100, 200, 400, 300,
		] );
	} );

	test( 'without bounds the chrome is left as published', () => {
		const [ rail ] = collectObstacles( [ leftRail() ], { left: 0, top: 0 } );
		expect( rail.width ).toBe( 1 );
	} );
} );

describe( 'clampOutsideChrome', () => {
	const rail = collectObstacles( [ leftRail() ], { left: 0, top: 0 }, LAYER );
	const both = collectObstacles(
		[
			leftRail(),
			leftRail( {
				id: 'dock:edge:1',
				rect: { x: 0, y: 740, width: 1200, height: 1 },
				face: 'top',
			} ),
		],
		{ left: 0, top: 0 },
		LAYER,
	);

	test( 'a drag across the dock keeps a full radius of clearance', () => {
		expect( clampOutsideChrome( { x: 20, y: 400 }, RADIUS, rail ) ).toEqual( {
			x: 122,
			y: 400,
		} );
	} );

	test( 'pushes along the face, never the shallowest axis', () => {
		// Shallowest-axis logic would send this one out the left of the
		// layer — behind the dock, off screen.
		const out = clampOutsideChrome( { x: 2, y: 400 }, RADIUS, rail );
		expect( out.x ).toBeGreaterThan( 0 );
	} );

	test( 'a corner is cleared on both axes', () => {
		const out = clampOutsideChrome( { x: 30, y: 780 }, RADIUS, both );
		expect( out.x ).toBe( 122 );
		expect( out.y ).toBe( 690 );
	} );

	test( 'leaves a point already clear of the dock alone', () => {
		const p = { x: 600, y: 300 };
		expect( clampOutsideChrome( p, RADIUS, both ) ).toEqual( p );
	} );

	test( 'windows are not chrome — resting against them is the point', () => {
		const p = { x: 200, y: 300 };
		expect(
			clampOutsideChrome( p, RADIUS, [ obstacle() ] ),
		).toEqual( p );
	} );
} );

describe( 'distanceToObstacle', () => {
	test( 'is zero inside the rect', () => {
		expect( distanceToObstacle( 200, 300, obstacle() ) ).toBe( 0 );
	} );

	test( 'measures to the nearest edge', () => {
		expect( distanceToObstacle( 200, 150, obstacle() ) ).toBe( 50 );
		expect( distanceToObstacle( 60, 300, obstacle() ) ).toBe( 40 );
	} );

	test( 'measures diagonally past a corner', () => {
		expect( distanceToObstacle( 70, 170, obstacle() ) ).toBeCloseTo(
			Math.hypot( 30, 30 ),
			9,
		);
	} );
} );

describe( 'closestPointOn', () => {
	test( 'clamps an outside point onto the rect', () => {
		expect( closestPointOn( 50, 300, obstacle() ) ).toEqual( { x: 100, y: 300 } );
		expect( closestPointOn( 300, 50, obstacle() ) ).toEqual( { x: 300, y: 200 } );
	} );

	test( 'returns an inside point unchanged', () => {
		expect( closestPointOn( 300, 300, obstacle() ) ).toEqual( { x: 300, y: 300 } );
	} );
} );

describe( 'magnetPull', () => {
	test( 'is null with an empty desk — Mio floats', () => {
		expect( magnetPull( 300, 100, RADIUS, [], 240 ) ).toBeNull();
	} );

	test( 'is null when every window is out of range', () => {
		expect( magnetPull( 300, -300, RADIUS, [ obstacle() ], 240 ) ).toBeNull();
	} );

	test( 'pulls toward the nearest edge, from any direction', () => {
		// Above the window → pulled down onto its top edge.
		const above = magnetPull( 300, 100, RADIUS, [ obstacle() ], 240 );
		expect( above?.dx ).toBeCloseTo( 0, 9 );
		expect( above?.dy ).toBeCloseTo( 1, 9 );

		// Left of the window → pulled right onto its side. This is the
		// whole point of a magnet over gravity: there is no "down".
		const beside = magnetPull( 20, 300, RADIUS, [ obstacle() ], 240 );
		expect( beside?.dx ).toBeCloseTo( 1, 9 );
		expect( beside?.dy ).toBeCloseTo( 0, 9 );

		// Below → pulled back up.
		const below = magnetPull( 300, 620, RADIUS, [ obstacle() ], 240 );
		expect( below?.dy ).toBeCloseTo( -1, 9 );
	} );

	test( 'strength ramps in with proximity and saturates on contact', () => {
		const far = magnetPull( 300, 0, RADIUS, [ obstacle() ], 240 );
		const near = magnetPull( 300, 120, RADIUS, [ obstacle() ], 240 );
		const touching = magnetPull( 300, 200, RADIUS, [ obstacle() ], 240 );
		expect( far?.strength ).toBeGreaterThan( 0 );
		expect( near?.strength ).toBeGreaterThan( far?.strength ?? 1 );
		expect( near?.strength ).toBeLessThan( 1 );
		expect( touching?.strength ).toBe( 1 );
	} );

	test( 'strength is monotonic in distance', () => {
		let previous = -1;
		for ( let d = 240; d >= 0; d -= 10 ) {
			const pull = magnetPull( 300, 200 - d, RADIUS, [ obstacle() ], 240 );
			const s = pull?.strength ?? 0;
			expect( s ).toBeGreaterThanOrEqual( previous );
			previous = s;
		}
	} );

	test( 'only the nearest window pulls — no tug-of-war in a gap', () => {
		const left = obstacle( { id: 'window:a', x: 0, width: 200, y: 0, height: 600 } );
		const right = obstacle( {
			id: 'window:b',
			x: 260,
			width: 200,
			y: 0,
			height: 600,
		} );
		// Sitting in the gap, a hair closer to the left window.
		const pull = magnetPull( 225, 300, RADIUS, [ left, right ], 240 );
		// Committed to one side rather than cancelling out.
		expect( pull?.dx ).toBeCloseTo( -1, 9 );
	} );

	test( 'the shell floor and the dock are inert', () => {
		const floor = obstacle( {
			id: 'shell:floor',
			kind: 'shell',
			y: 300,
			height: 1,
		} );
		const dock = obstacle( { id: 'dock:edge', kind: 'dock', x: 0, width: 1 } );
		expect( magnetPull( 300, 290, RADIUS, [ floor, dock ], 240 ) ).toBeNull();
	} );

	test( 'widget cards are magnetic', () => {
		const widget = obstacle( { id: 'widget:clock', kind: 'widget' } );
		expect( magnetPull( 300, 190, RADIUS, [ widget ], 240 )?.strength ).toBeGreaterThan(
			0,
		);
	} );

	test( 'a zero range disables the magnet entirely', () => {
		expect( magnetPull( 300, 300, RADIUS, [ obstacle() ], 0 ) ).toBeNull();
	} );

	test( 'reports full strength with no direction when already inside', () => {
		const pull = magnetPull( 300, 300, RADIUS, [ obstacle() ], 240 );
		expect( pull?.strength ).toBe( 1 );
		expect( pull?.dx ).toBe( 0 );
		expect( pull?.dy ).toBe( 0 );
	} );

	test( 'gap is measured edge-to-edge, not centre-to-edge', () => {
		// Centre 150 px above the window with a 50 px body → 100 px of
		// clear air between the two surfaces.
		expect( magnetPull( 300, 50, RADIUS, [ obstacle() ], 240 )?.gap ).toBe(
			100,
		);
		// Just touching.
		expect( magnetPull( 300, 150, RADIUS, [ obstacle() ], 240 )?.gap ).toBe( 0 );
		// Overlapping — negative, which is what lets the magnet spring
		// push back instead of only ever pulling.
		expect( magnetPull( 300, 180, RADIUS, [ obstacle() ], 240 )?.gap ).toBe(
			-30,
		);
	} );

	test( 'strength reaches exactly 1 on contact', () => {
		// The bug this guards: a centroid-based falloff tops out
		// around 0.9 for a resting body, leaving a permanent sliver of
		// idle float driving Mio that should be sitting still.
		expect( magnetPull( 300, 150, RADIUS, [ obstacle() ], 240 )?.strength ).toBe(
			1,
		);
		expect( magnetPull( 300, 300, RADIUS, [ obstacle() ], 240 )?.strength ).toBe(
			1,
		);
	} );

	test( 'range is a gap, so a bigger body notices a window sooner', () => {
		// Same centre, same window (top edge at y = 200), so the
		// centre is 310 px out; only the body size differs.
		expect( magnetPull( 300, -110, 50, [ obstacle() ], 240 ) ).toBeNull();
		expect( magnetPull( 300, -110, 120, [ obstacle() ], 240 ) ).not.toBeNull();
	} );
} );

describe( 'clusterBounds', () => {
	test( 'a lone window is its own cluster', () => {
		const solo = obstacle();
		expect( clusterBounds( solo, [ solo ] ) ).toEqual( {
			x: 100,
			y: 200,
			width: 400,
			height: 300,
		} );
	} );

	test( 'merges a tiled pair, hairline gap included', () => {
		const left = obstacle( { id: 'a', x: 0, y: 0, width: 300, height: 400 } );
		// Snapped beside it with a 4 px seam — one desk region, not two.
		const right = obstacle( { id: 'b', x: 304, y: 0, width: 300, height: 400 } );
		expect( clusterBounds( left, [ left, right ] ) ).toEqual( {
			x: 0,
			y: 0,
			width: 604,
			height: 400,
		} );
	} );

	test( 'merges transitively across a chain', () => {
		const a = obstacle( { id: 'a', x: 0, y: 0, width: 200, height: 200 } );
		const b = obstacle( { id: 'b', x: 190, y: 0, width: 200, height: 200 } );
		const c = obstacle( { id: 'c', x: 380, y: 0, width: 200, height: 200 } );
		// `a` doesn't touch `c`, but `b` bridges them.
		expect( clusterBounds( a, [ a, b, c ] ).width ).toBe( 580 );
	} );

	test( 'leaves a distant window out', () => {
		const near = obstacle( { id: 'a', x: 0, y: 0, width: 200, height: 200 } );
		const far = obstacle( { id: 'b', x: 900, y: 0, width: 200, height: 200 } );
		expect( clusterBounds( near, [ near, far ] ).width ).toBe( 200 );
	} );

	test( 'ignores the floor and the dock', () => {
		const win = obstacle( { id: 'a', x: 100, y: 100, width: 200, height: 200 } );
		const floor = obstacle( {
			id: 'shell:floor',
			kind: 'shell',
			x: 0,
			y: 0,
			width: 2000,
			height: 1,
		} );
		expect( clusterBounds( win, [ win, floor ] ).width ).toBe( 200 );
	} );
} );

describe( 'findEscape', () => {
	const bounds = { width: 1400, height: 900 };

	test( 'resting against a window is not trapped', () => {
		// Touching the top edge but centred outside it.
		expect(
			findEscape( 300, 150, 50, [ obstacle() ], bounds ),
		).toBeNull();
	} );

	test( 'an empty desk is never trapped', () => {
		expect( findEscape( 300, 300, 50, [], bounds ) ).toBeNull();
	} );

	test( 'any depth inside the dock is trapped, and it leaves sideways', () => {
		const rail = collectObstacles( [ leftRail() ], { left: 0, top: 0 }, LAYER );
		// A rail is narrower than Mio, so the window depth rule
		// (0.75 × radius) can never fire inside one. This has to be the
		// bare inside-test, or Mio in the dock stays there.
		const out = findEscape( 40, 400, 50, rail, bounds );
		expect( out ).not.toBeNull();
		expect( out?.x ).toBe( 130 );
		expect( out?.y ).toBe( 400 );
	} );

	test( 'resting against the dock is not trapped', () => {
		const rail = collectObstacles( [ leftRail() ], { left: 0, top: 0 }, LAYER );
		// Centroid a radius clear of the rail's inner face.
		expect( findEscape( 122, 400, 50, rail, bounds ) ).toBeNull();
	} );

	test( 'a shallow overlap is not trapped', () => {
		// Stuck to the top edge with the centroid a few pixels past
		// it — routine while the contact solver settles, and exactly
		// what a bare inside-test would teleport away from. Depth
		// threshold is 0.75 × radius = 37.5 px.
		expect( findEscape( 300, 210, 50, [ obstacle() ], bounds ) ).toBeNull();
		expect( findEscape( 300, 230, 50, [ obstacle() ], bounds ) ).toBeNull();
	} );

	test( 'a corner rest is not trapped', () => {
		// The hardest case: two faces fighting over the rim, so the
		// centroid sits a little inside on both axes at once.
		expect( findEscape( 112, 212, 50, [ obstacle() ], bounds ) ).toBeNull();
	} );

	test( 'being buried past the depth threshold is trapped', () => {
		// 45 px in, past 0.75 × 50 → genuinely engulfed.
		const out = findEscape( 300, 245, 50, [ obstacle() ], bounds );
		expect( out ).not.toBeNull();
	} );

	test( 'ejects to the midpoint of the nearest edge', () => {
		// Deep inside, nearest the top → out to the top edge's midpoint.
		const out = findEscape( 300, 280, 50, [ obstacle() ], bounds );
		expect( out ).not.toBeNull();
		expect( out?.x ).toBe( 300 ); // horizontal midpoint of the window
		expect( out?.y ).toBe( 200 - 58 ); // radius + 8 clear of the edge
	} );

	test( 'picks the side it is actually closest to', () => {
		// A window with room on every side; Mio is trapped
		// just inside its left edge.
		const win = obstacle( { x: 400, y: 200, width: 400, height: 300 } );
		const out = findEscape( 445, 430, 50, [ win ], bounds );
		expect( out?.x ).toBe( 400 - 58 );
		expect( out?.y ).toBe( 350 ); // vertical midpoint
	} );

	test( 'skips a side with no room and takes the next-nearest', () => {
		// Flush against the layer's left edge: the left candidate
		// would sit off-canvas, so Mio goes over the top
		// instead of being parked outside the viewport.
		const win = obstacle( { x: 20, y: 200, width: 400, height: 300 } );
		const out = findEscape( 70, 430, 50, [ win ], bounds );
		expect( out?.x ).toBeGreaterThanOrEqual( 50 );
		expect( out?.y ).toBeGreaterThanOrEqual( 50 );
	} );

	test( 'escapes the whole cluster, not one window of a tiled pair', () => {
		const left = obstacle( { id: 'a', x: 100, y: 100, width: 400, height: 400 } );
		const right = obstacle( { id: 'b', x: 500, y: 100, width: 400, height: 400 } );
		// Trapped in the left window. Ejecting rightwards would land
		// inside its neighbour and bounce forever.
		const out = findEscape( 440, 300, 50, [ left, right ], bounds );
		expect( out ).not.toBeNull();
		const insideRight =
			( out as { x: number; y: number } ).x > 500 &&
			( out as { x: number; y: number } ).x < 900 &&
			( out as { x: number; y: number } ).y > 100 &&
			( out as { x: number; y: number } ).y < 500;
		expect( insideRight ).toBe( false );
	} );

	test( 'falls back to the widest free strip under a maximised window', () => {
		// Fills everything except a 120 px band at the bottom.
		const maximised = obstacle( {
			id: 'window:big',
			x: 0,
			y: 0,
			width: 1400,
			height: 780,
		} );
		const out = findEscape( 700, 400, 50, [ maximised ], bounds );
		expect( out ).not.toBeNull();
		expect( out?.y ).toBeGreaterThan( 780 );
		expect( out?.y ).toBeLessThanOrEqual( 900 );
	} );

	test( 'falls back to the layer centre when nothing is free', () => {
		const everything = obstacle( {
			id: 'window:all',
			x: 0,
			y: 0,
			width: 1400,
			height: 900,
		} );
		expect( findEscape( 700, 400, 50, [ everything ], bounds ) ).toEqual( {
			x: 700,
			y: 450,
		} );
	} );

	test( 'never returns a point outside the layer', () => {
		// Window flush against the top-left corner.
		const corner = obstacle( { id: 'w', x: 0, y: 0, width: 300, height: 300 } );
		const out = findEscape( 150, 150, 50, [ corner ], bounds );
		expect( out?.x ).toBeGreaterThanOrEqual( 50 );
		expect( out?.y ).toBeGreaterThanOrEqual( 50 );
		expect( out?.x ).toBeLessThanOrEqual( bounds.width - 50 );
		expect( out?.y ).toBeLessThanOrEqual( bounds.height - 50 );
	} );
} );

describe( 'resolveObstacleCollisions', () => {
	test( 'lifts a falling point onto the top face and bounces it', () => {
		const p = { x: 300, y: 210, vx: 30, vy: 400 };
		expect(
			resolveObstacleCollisions( p, [ obstacle() ], 0.5, 0.8 ),
		).toBe( true );
		expect( p.y ).toBe( 200 );
		expect( p.vy ).toBe( -200 );
		expect( p.vx ).toBeCloseTo( 24, 9 );
	} );

	test( 'picks the shallowest axis', () => {
		// Just inside the left edge, deep from the top → push left.
		const p = { x: 105, y: 400, vx: -50, vy: 0 };
		resolveObstacleCollisions( p, [ obstacle() ], 0.5, 1 );
		expect( p.x ).toBe( 100 );
		// Moving further left already — velocity is untouched.
		expect( p.vx ).toBe( -50 );
	} );

	test( 'leaves a point outside every rect alone', () => {
		const p = { x: 10, y: 10, vx: 5, vy: 5 };
		expect( resolveObstacleCollisions( p, [ obstacle() ], 0.5, 0.8 ) ).toBe(
			false,
		);
		expect( p ).toEqual( { x: 10, y: 10, vx: 5, vy: 5 } );
	} );
} );

describe( 'clampToBounds', () => {
	test( 'reflects off the layer edges', () => {
		const p = { x: -20, y: 400, vx: -100, vy: 10 };
		clampToBounds( p, 1000, 800, 0.5, 0.9 );
		expect( p.x ).toBe( 0 );
		expect( p.vx ).toBe( 50 );
		expect( p.vy ).toBeCloseTo( 9, 9 );
	} );

	test( 'leaves an interior point alone', () => {
		const p = { x: 500, y: 400, vx: 1, vy: 2 };
		clampToBounds( p, 1000, 800, 0.5, 0.9 );
		expect( p ).toEqual( { x: 500, y: 400, vx: 1, vy: 2 } );
	} );
} );
