/**
 * Mascot soft body — the spring/pressure simulation that gives the
 * mascot its jelly.
 *
 * These are behavioural invariants rather than golden numbers: a
 * blob at rest stays round, a squashed blob re-inflates, a magnet
 * pulls it onto a window from any direction and it settles there
 * instead of through it, a throw glides, and the integrator never
 * produces NaN even when fed a hostile frame delta.
 */
import { describe, expect, test } from 'vitest';
import { MASCOT_DEFAULTS } from '../../src/mascot/config';
import { magnetPull, type Obstacle } from '../../src/mascot/environment';
import {
	addVelocity,
	createSoftBody,
	polygonArea,
	resetBody,
	rimCentroid,
	shapeProfile,
	stepSoftBody,
	syncCore,
	translateBody,
	type SoftBody,
	type StepInput,
} from '../../src/mascot/soft-body';

const BOUNDS = { width: 1200, height: 800 };

/**
 * The shipped physics with the rest shape forced back to a circle.
 *
 * Almost every invariant below is phrased in terms of *roundness* —
 * "an untouched blob keeps its shape", "a squashed blob re-inflates",
 * "the silhouette stays inside an annulus". Those are statements about
 * the body returning to its rest shape, and they read far more clearly
 * against a circle than against the shipped rounded triangle. The
 * profile gets its own block at the end.
 */
const PHYSICS = { ...MASCOT_DEFAULTS.physics, shapeLobes: 0 };

function input( over: Partial< StepInput > = {} ): StepInput {
	return {
		physics: PHYSICS,
		magnet: null,
		obstacles: [],
		bounds: BOUNDS,
		dragTarget: null,
		...over,
	};
}

/** Run `seconds` of simulated time in 60 fps frames. */
function run( body: SoftBody, seconds: number, over: Partial< StepInput > = {} ): void {
	const frames = Math.round( seconds * 60 );
	for ( let i = 0; i < frames; i++ ) {
		stepSoftBody( body, 1 / 60, input( over ) );
	}
}

/**
 * Run with a live magnet — recomputed each frame from the obstacle
 * set, exactly as the runtime does.
 */
function runMagnetised(
	body: SoftBody,
	seconds: number,
	obstacles: Obstacle[],
): void {
	const frames = Math.round( seconds * 60 );
	for ( let i = 0; i < frames; i++ ) {
		stepSoftBody(
			body,
			1 / 60,
			input( {
				obstacles,
				magnet: magnetPull(
					body.core.x,
					body.core.y,
					body.radius,
					obstacles,
					PHYSICS.magnetRange,
				),
			} ),
		);
	}
}

/** Largest deviation of any rim point from the rest radius. */
function radiusError( body: SoftBody ): number {
	let worst = 0;
	for ( const p of body.rim ) {
		worst = Math.max(
			worst,
			Math.abs( Math.hypot( p.x - body.core.x, p.y - body.core.y ) - body.radius ),
		);
	}
	return worst;
}

function extents( body: SoftBody ): { width: number; height: number } {
	const xs = body.rim.map( ( p ) => p.x );
	const ys = body.rim.map( ( p ) => p.y );
	return {
		width: Math.max( ...xs ) - Math.min( ...xs ),
		height: Math.max( ...ys ) - Math.min( ...ys ),
	};
}

function isFiniteBody( body: SoftBody ): boolean {
	if ( ! Number.isFinite( body.core.x ) || ! Number.isFinite( body.core.y ) ) {
		return false;
	}
	return body.rim.every(
		( p ) =>
			Number.isFinite( p.x ) &&
			Number.isFinite( p.y ) &&
			Number.isFinite( p.vx ) &&
			Number.isFinite( p.vy ),
	);
}

describe( 'createSoftBody', () => {
	test( 'lays rim points on the rest circle', () => {
		const body = createSoftBody( 100, 100, 50, 24 );
		expect( body.rim ).toHaveLength( 24 );
		expect( radiusError( body ) ).toBeLessThan( 1e-9 );
	} );

	test( 'rest area is the inscribed polygon, not the circle', () => {
		const body = createSoftBody( 0, 0, 50, 40 );
		// Below πr² (7853.98) but within a couple of percent of it.
		expect( body.restArea ).toBeLessThan( Math.PI * 50 * 50 );
		expect( body.restArea ).toBeGreaterThan( Math.PI * 50 * 50 * 0.97 );
		expect( Math.abs( polygonArea( body.rim ) ) ).toBeCloseTo( body.restArea, 6 );
	} );
} );

describe( 'floating', () => {
	test( 'an untouched blob keeps its shape', () => {
		const body = createSoftBody( 600, 400, 56, 34 );
		run( body, 2 );
		expect( isFiniteBody( body ) ).toBe( true );
		expect( radiusError( body ) ).toBeLessThan( 12 );
	} );

	test( 'stays airborne — no window means no net fall', () => {
		const body = createSoftBody( 600, 400, 56, 34 );
		run( body, 4 );
		// Bob amplitude is 10 px; anything beyond that is a leak.
		expect( Math.abs( body.core.y - 400 ) ).toBeLessThan( 45 );
	} );

	test( 'idle wobble keeps the silhouette continuously changing', () => {
		const body = createSoftBody( 600, 400, 56, 34 );
		const samples: number[] = [];
		for ( let i = 0; i < 600; i++ ) {
			stepSoftBody( body, 1 / 60, input() );
			if ( i % 30 === 0 ) {
				const { width, height } = extents( body );
				samples.push( width - height );
			}
		}
		const min = Math.min( ...samples );
		const max = Math.max( ...samples );
		// It breathes — but softly. A perfect circle would hold
		// width − height at 0; a flailing one would swing wildly.
		expect( max - min ).toBeGreaterThan( 3 );
		expect( max - min ).toBeLessThan( 0.6 * 2 * body.radius );
		expect( isFiniteBody( body ) ).toBe( true );
	} );

	test( 'the wobble is smooth — every spring family agrees on the rest shape', () => {
		// Regression guard for the flicker bug. Breathe the shape
		// springs while the edge springs go on defending the original
		// perimeter and the two fight at their natural frequency: the
		// outline buzzes instead of breathing. That shows up as
		// high-frequency content, so we measure the *second*
		// difference of each vertex's radius — smooth motion has
		// almost none, a spring fight has plenty.
		const body = createSoftBody( 600, 400, 56, 34 );
		run( body, 2 ); // settle

		const radii = (): number[] =>
			body.rim.map( ( p ) =>
				Math.hypot( p.x - body.core.x, p.y - body.core.y ),
			);

		let previous = radii();
		let previousDelta: number[] | null = null;
		let worstJerk = 0;
		let worstStep = 0;
		for ( let i = 0; i < 600; i++ ) {
			stepSoftBody( body, 1 / 60, input() );
			const current = radii();
			const delta = current.map( ( r, k ) => r - previous[ k ] );
			worstStep = Math.max( worstStep, ...delta.map( Math.abs ) );
			if ( previousDelta ) {
				const jerk = delta.map( ( d, k ) =>
					Math.abs( d - ( previousDelta as number[] )[ k ] ),
				);
				worstJerk = Math.max( worstJerk, ...jerk );
			}
			previousDelta = delta;
			previous = current;
		}

		// It is moving…
		expect( worstStep ).toBeGreaterThan( 0.005 );
		// …but never jerking. A fighting ring lands orders of
		// magnitude above this.
		expect( worstJerk ).toBeLessThan( 0.05 );
	} );

	test( 'with the wobble off the body is perfectly still', () => {
		const body = createSoftBody( 600, 400, 56, 34 );
		const calm = { ...PHYSICS, idleWobble: 0, floatAmplitude: 0 };
		run( body, 2, { physics: calm } );
		const before = body.rim.map( ( p ) => ( { x: p.x, y: p.y } ) );
		run( body, 2, { physics: calm } );
		body.rim.forEach( ( p, i ) => {
			expect( p.x ).toBeCloseTo( before[ i ].x, 6 );
			expect( p.y ).toBeCloseTo( before[ i ].y, 6 );
		} );
	} );

	test( 'the wobble is deformation, not drift', () => {
		const body = createSoftBody( 600, 400, 56, 34 );
		run( body, 8 );
		// Internal forces are mean-projected: breathing must never
		// push the body across the desk.
		expect( Math.abs( body.core.x - 600 ) ).toBeLessThan( 40 );
	} );
} );

describe( 'stepSoftBody', () => {
	test( 'pressure re-inflates a squashed blob', () => {
		const body = createSoftBody( 600, 400, 56, 34 );
		// Flatten it hard: collapse every rim point onto a thin band.
		for ( const p of body.rim ) {
			p.y = body.core.y + ( p.y - body.core.y ) * 0.06;
		}
		const squashedArea = Math.abs( polygonArea( body.rim ) );
		expect( squashedArea ).toBeLessThan( body.restArea * 0.2 );
		run( body, 3 );
		const recovered = Math.abs( polygonArea( body.rim ) );
		expect( recovered ).toBeGreaterThan( body.restArea * 0.8 );
		expect( isFiniteBody( body ) ).toBe( true );
	} );

	test( 'a window magnet pulls the body onto it and it rests there', () => {
		const window_: Obstacle = {
			id: 'window:posts',
			kind: 'window',
			x: 300,
			y: 500,
			width: 600,
			height: 260,
		};
		const body = createSoftBody( 600, 340, 56, 34 );
		runMagnetised( body, 5, [ window_ ] );

		expect( isFiniteBody( body ) ).toBe( true );
		// Settled on the surface, not through it.
		const lowest = Math.max( ...body.rim.map( ( p ) => p.y ) );
		expect( lowest ).toBeLessThanOrEqual( window_.y + 0.5 );
		expect( lowest ).toBeGreaterThan( window_.y - 8 );
		// And the centre sits a body's-worth above the surface rather
		// than sinking to it (the failure mode a dynamic core mass
		// produces — see the module header).
		expect( body.core.y ).toBeGreaterThan( window_.y - body.radius );
		expect( body.core.y ).toBeLessThan( window_.y - body.radius * 0.5 );
	} );

	test( 'the magnet works sideways — there is no global down', () => {
		// A tall window to the right; the mascot starts level with it.
		const window_: Obstacle = {
			id: 'window:tall',
			kind: 'window',
			x: 700,
			y: 100,
			width: 400,
			height: 600,
		};
		const body = createSoftBody( 560, 400, 56, 34 );
		runMagnetised( body, 5, [ window_ ] );

		expect( isFiniteBody( body ) ).toBe( true );
		// Stuck to the left face, not fallen to the floor.
		const rightmost = Math.max( ...body.rim.map( ( p ) => p.x ) );
		expect( rightmost ).toBeLessThanOrEqual( window_.x + 0.5 );
		expect( rightmost ).toBeGreaterThan( window_.x - 8 );
		expect( Math.abs( body.core.y - 400 ) ).toBeLessThan( 60 );
	} );

	test( 'a mascot parked in a corner comes to rest', () => {
		// Regression guard for the corner limit cycle. A magnet that
		// pulls with constant force has no equilibrium: it drives the
		// body into the surface, the contact solver bounces it back,
		// forever. Against a flat face that's invisible — the bounce
		// is purely normal and friction eats it. In a corner the pull
		// is diagonal, so every cycle also slides the body along one
		// face and the mascot visibly orbits the corner.
		const window_: Obstacle = {
			id: 'window:posts',
			kind: 'window',
			x: 500,
			y: 400,
			width: 500,
			height: 300,
		};
		const body = createSoftBody( 470, 370, 56, 34 );
		runMagnetised( body, 7, [ window_ ] );

		// Now watch it for two more seconds: it must be still, not
		// cycling. The pre-fix build oscillated between 4 and 61 px/s
		// here with a ~0.25 s period.
		let worstSpeed = 0;
		for ( let i = 0; i < 120; i++ ) {
			stepSoftBody(
				body,
				1 / 60,
				input( {
					obstacles: [ window_ ],
					magnet: magnetPull(
						body.core.x,
						body.core.y,
						body.radius,
						[ window_ ],
						PHYSICS.magnetRange,
					),
				} ),
			);
			worstSpeed = Math.max(
				worstSpeed,
				Math.hypot( body.core.vx, body.core.vy ),
			);
		}
		expect( worstSpeed ).toBeLessThan( 2 );
	} );

	test( 'a mascot resting on a flat face comes to rest', () => {
		const window_: Obstacle = {
			id: 'window:posts',
			kind: 'window',
			x: 300,
			y: 500,
			width: 700,
			height: 260,
		};
		const body = createSoftBody( 650, 340, 56, 34 );
		runMagnetised( body, 8, [ window_ ] );
		expect( Math.hypot( body.core.vx, body.core.vy ) ).toBeLessThan( 2 );
	} );

	test( 'contact squashes the blob against the surface', () => {
		const window_: Obstacle = {
			id: 'window:posts',
			kind: 'window',
			x: 200,
			y: 520,
			width: 800,
			height: 200,
		};
		const body = createSoftBody( 600, 300, 56, 34 );
		runMagnetised( body, 5, [ window_ ] );
		const { width, height } = extents( body );
		expect( width ).toBeGreaterThan( height );
	} );

	test( 'moving fast stretches the body along its heading', () => {
		const body = createSoftBody( 150, 400, 56, 34 );
		// Drag rightwards at a steady clip, staying inside the layer.
		let target = 150;
		for ( let i = 0; i < 60; i++ ) {
			target += 14; // ≈ 840 px/s
			stepSoftBody(
				body,
				1 / 60,
				input( { dragTarget: { x: target, y: 400 } } ),
			);
		}
		const moving = extents( body );
		// Drawn out along the direction of travel…
		expect( moving.width / moving.height ).toBeGreaterThan( 1.25 );
		// …without gaining mass: the stretch is area-preserving.
		expect( Math.abs( polygonArea( body.rim ) ) ).toBeGreaterThan(
			body.restArea * 0.95,
		);
		expect( Math.abs( polygonArea( body.rim ) ) ).toBeLessThan(
			body.restArea * 1.05,
		);
	} );

	test( 'the stretch relaxes once it stops moving', () => {
		const body = createSoftBody( 150, 400, 56, 34 );
		let target = 150;
		for ( let i = 0; i < 60; i++ ) {
			target += 14;
			stepSoftBody(
				body,
				1 / 60,
				input( { dragTarget: { x: target, y: 400 } } ),
			);
		}
		const moving = extents( body );
		run( body, 3 );
		const settled = extents( body );
		expect( settled.width / settled.height ).toBeLessThan(
			moving.width / moving.height - 0.2,
		);
		// Back to roughly round — the idle wobble keeps it from ever
		// being exactly 1.
		expect( settled.width / settled.height ).toBeLessThan( 1.2 );
	} );

	test( 'a stationary body is not stretched', () => {
		const body = createSoftBody( 600, 400, 56, 34 );
		const calm = { ...PHYSICS, idleWobble: 0, floatAmplitude: 0 };
		run( body, 2, { physics: calm } );
		const still = extents( body );
		expect( still.width / still.height ).toBeCloseTo( 1, 2 );
	} );

	test( 'the body is never crushed flat by an out-of-bounds drag', () => {
		const body = createSoftBody( 600, 400, 56, 34 );
		// A caller that forgets to clamp: haul the target far past
		// the layer's edge and hold it there. Unclamped, every rim
		// point piles onto the same wall and the blob flattens to
		// zero area.
		run( body, 3, { dragTarget: { x: 99999, y: 99999 } } );
		expect( Math.abs( polygonArea( body.rim ) ) ).toBeGreaterThan(
			body.restArea * 0.5,
		);
		expect( isFiniteBody( body ) ).toBe( true );
	} );

	test( 'drag pulls the body toward the pointer', () => {
		const body = createSoftBody( 200, 200, 56, 34 );
		run( body, 1.5, { dragTarget: { x: 800, y: 600 } } );
		expect( body.core.x ).toBeGreaterThan( 700 );
		expect( body.core.y ).toBeGreaterThan( 500 );
		expect( isFiniteBody( body ) ).toBe( true );
	} );

	test( 'stays inside the layer bounds', () => {
		const body = createSoftBody( 40, 40, 56, 34 );
		run( body, 3, { dragTarget: { x: -900, y: -900 } } );
		for ( const p of body.rim ) {
			expect( p.x ).toBeGreaterThanOrEqual( -0.001 );
			expect( p.y ).toBeGreaterThanOrEqual( -0.001 );
			expect( p.x ).toBeLessThanOrEqual( BOUNDS.width + 0.001 );
			expect( p.y ).toBeLessThanOrEqual( BOUNDS.height + 0.001 );
		}
	} );

	test( 'survives a hostile frame delta without exploding', () => {
		const body = createSoftBody( 600, 200, 56, 34 );
		// Tab restore: a five-second delta, then a negative one.
		stepSoftBody( body, 5, input() );
		stepSoftBody( body, -1, input() );
		stepSoftBody( body, Number.NaN, input() );
		expect( isFiniteBody( body ) ).toBe( true );
		expect( radiusError( body ) ).toBeLessThan( 60 );
	} );
} );

describe( 'addVelocity', () => {
	test( 'throws the whole body without tearing it', () => {
		const body = createSoftBody( 300, 400, 56, 34 );
		addVelocity( body, 900, 0 );
		expect( body.core.vx ).toBeCloseTo( 900, 6 );
		run( body, 0.5 );
		// Carried a long way on its own momentum…
		expect( body.core.x ).toBeGreaterThan( 550 );
		// …and stayed a blob doing it.
		expect( radiusError( body ) ).toBeLessThan( 25 );
	} );

	test( 'a throw glides to a stop instead of running forever', () => {
		const body = createSoftBody( 200, 400, 56, 34 );
		addVelocity( body, 600, 0 );
		run( body, 6 );
		expect( Math.abs( body.core.vx ) ).toBeLessThan( 60 );
	} );
} );

describe( 'hard stretch limits', () => {
	/** Every rim point's distance from the centroid, over the rest radius. */
	function radialFractions( body: SoftBody ): number[] {
		return body.rim.map(
			( p ) =>
				Math.hypot( p.x - body.core.x, p.y - body.core.y ) / body.radius,
		);
	}

	/** Mangle the body far outside any legal shape. */
	function mangle( body: SoftBody ): void {
		body.rim.forEach( ( p, i ) => {
			const scale = i % 2 === 0 ? 0.05 : 2.6;
			p.x = body.core.x + ( p.x - body.core.x ) * scale;
			p.y = body.core.y + ( p.y - body.core.y ) * scale;
		} );
	}

	test( 'a free body is pulled inside the limits within one frame', () => {
		// No contact anywhere: this is the exact guarantee. Springs
		// alone would take many frames to unwind a shape this extreme,
		// and a hard enough force could hold it there indefinitely.
		const body = createSoftBody( 600, 400, 56, 34 );
		mangle( body );
		expect( Math.min( ...radialFractions( body ) ) ).toBeLessThan( 0.1 );
		expect( Math.max( ...radialFractions( body ) ) ).toBeGreaterThan( 2.5 );

		stepSoftBody( body, 1 / 60, input() );

		const after = radialFractions( body );
		// A little slack for the wobble/stretch shaping of the rest
		// radius, which the limits are relative to.
		expect( Math.min( ...after ) ).toBeGreaterThan( PHYSICS.minStretch * 0.9 );
		expect( Math.max( ...after ) ).toBeLessThan( PHYSICS.maxStretch * 1.1 );
	} );

	test( 'without them the same body stays mangled', () => {
		const body = createSoftBody( 600, 400, 56, 34 );
		mangle( body );
		stepSoftBody( body, 1 / 60, input( {
			physics: { ...PHYSICS, limitIterations: 0 },
		} ) );
		const after = radialFractions( body );
		expect( Math.min( ...after ) ).toBeLessThan( PHYSICS.minStretch );
		expect( Math.max( ...after ) ).toBeGreaterThan( PHYSICS.maxStretch );
	} );

	test( 'they bound the squash of a violent impact', () => {
		const window_: Obstacle = {
			id: 'window:posts',
			kind: 'window',
			x: 400,
			y: 600,
			width: 700,
			height: 250,
		};
		const worstSquash = ( physics: typeof PHYSICS ): number => {
			const body = createSoftBody( 750, 300, 56, 34 );
			for ( const p of body.rim ) {
				p.vx = 1200;
				p.vy = 4000;
			}
			let worst = Infinity;
			for ( let i = 0; i < 400; i++ ) {
				stepSoftBody(
					body,
					1 / 60,
					input( {
						physics,
						obstacles: [ window_ ],
						magnet: magnetPull(
							body.core.x,
							body.core.y,
							body.radius,
							[ window_ ],
							physics.magnetRange,
						),
					} ),
				);
				worst = Math.min( worst, ...radialFractions( body ) );
			}
			return worst;
		};

		const unlimited = worstSquash( { ...PHYSICS, limitIterations: 0 } );
		const limited = worstSquash( PHYSICS );

		// Unbounded, a slam this hard flattens the blob to a line.
		expect( unlimited ).toBeLessThan( 0.15 );
		// Bounded, it stays a recognisable pancake. Contact still has
		// the final word — a rim point pinned against a window can't
		// be pushed back out to satisfy a limit — so this is a big
		// improvement rather than the exact floor.
		expect( limited ).toBeGreaterThan( unlimited * 2 );
		expect( limited ).toBeGreaterThan( 0.2 );
	} );

	test( 'barely penetrates a window to satisfy a limit', () => {
		const window_: Obstacle = {
			id: 'window:posts',
			kind: 'window',
			x: 400,
			y: 600,
			width: 700,
			height: 250,
		};
		const body = createSoftBody( 750, 300, 56, 34 );
		for ( const p of body.rim ) {
			p.vx = 1200;
			p.vy = 4000;
		}
		let worstPenetration = 0;
		for ( let i = 0; i < 400; i++ ) {
			stepSoftBody(
				body,
				1 / 60,
				input( {
					obstacles: [ window_ ],
					magnet: magnetPull(
						body.core.x,
						body.core.y,
						body.radius,
						[ window_ ],
						PHYSICS.magnetRange,
					),
				} ),
			);
			for ( const p of body.rim ) {
				if (
					p.x > window_.x &&
					p.x < window_.x + window_.width &&
					p.y > window_.y &&
					p.y < window_.y + window_.height
				) {
					worstPenetration = Math.max(
						worstPenetration,
						Math.min(
							p.x - window_.x,
							window_.x + window_.width - p.x,
							p.y - window_.y,
							window_.y + window_.height - p.y,
						),
					);
				}
			}
		}
		// The stretch limits themselves never do this — contact gets
		// the last word over them. The sub-pixel residue is the
		// angular repair, which outranks contact by design because a
		// fold is unrecoverable and a hair of overlap is not.
		expect( worstPenetration ).toBeLessThan( 1 );
	} );

	test( 'they stay out of the way in ordinary use', () => {
		// A mascot drifting onto a window under its own magnet never
		// deforms enough for a limit to engage — they must not be
		// quietly stiffening the everyday feel.
		const window_: Obstacle = {
			id: 'window:posts',
			kind: 'window',
			x: 400,
			y: 600,
			width: 700,
			height: 250,
		};
		const body = createSoftBody( 750, 300, 56, 34 );
		let worst = Infinity;
		for ( let i = 0; i < 400; i++ ) {
			stepSoftBody(
				body,
				1 / 60,
				input( {
					obstacles: [ window_ ],
					magnet: magnetPull(
						body.core.x,
						body.core.y,
						body.radius,
						[ window_ ],
						PHYSICS.magnetRange,
					),
				} ),
			);
			worst = Math.min( worst, ...radialFractions( body ) );
		}
		expect( worst ).toBeGreaterThan( PHYSICS.minStretch + 0.1 );
	} );
} );

describe( 'the outline can never fold', () => {
	/** True when no two rim edges cross. O(n²) — fine for a test. */
	function isSimplePolygon( body: SoftBody ): boolean {
		const n = body.rim.length;
		const cross = (
			o: { x: number; y: number },
			a: { x: number; y: number },
			c: { x: number; y: number },
		): number => ( a.x - o.x ) * ( c.y - o.y ) - ( a.y - o.y ) * ( c.x - o.x );
		for ( let i = 0; i < n; i++ ) {
			for ( let j = i + 2; j < n; j++ ) {
				if ( i === 0 && j === n - 1 ) {
					continue;
				}
				const p1 = body.rim[ i ];
				const p2 = body.rim[ ( i + 1 ) % n ];
				const p3 = body.rim[ j ];
				const p4 = body.rim[ ( j + 1 ) % n ];
				const d1 = cross( p3, p4, p1 );
				const d2 = cross( p3, p4, p2 );
				const d3 = cross( p1, p2, p3 );
				const d4 = cross( p1, p2, p4 );
				if ( d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0 ) {
					return false;
				}
			}
		}
		return true;
	}

	/**
	 * 3000 frames of relentless abuse: hard flings in every
	 * direction, direct rim mangling, and drags held deep inside
	 * windows. Returns how many frames ended self-intersecting and
	 * the smallest area the body ever reached.
	 */
	function torture( physics: typeof PHYSICS ): {
		broken: number;
		minArea: number;
	} {
		const windows: Obstacle[] = [
			{ id: 'a', kind: 'window', x: 400, y: 600, width: 700, height: 250 },
			{ id: 'b', kind: 'window', x: 200, y: 200, width: 300, height: 300 },
		];
		const body = createSoftBody( 750, 300, 56, physics.points );
		let broken = 0;
		let minArea = Infinity;
		for ( let i = 0; i < 3000; i++ ) {
			if ( i % 60 === 0 ) {
				const a = ( i * 0.37 ) % ( Math.PI * 2 );
				for ( const p of body.rim ) {
					p.vx += Math.cos( a ) * 2600;
					p.vy += Math.sin( a ) * 2600;
				}
			}
			if ( i % 240 === 100 ) {
				// Turn every third point inside out by hand.
				body.rim.forEach( ( p, k ) => {
					if ( k % 3 === 0 ) {
						p.x = body.core.x - ( p.x - body.core.x ) * 1.4;
						p.y = body.core.y - ( p.y - body.core.y ) * 1.4;
					}
				} );
			}
			const dragging = i % 400 > 250;
			stepSoftBody(
				body,
				1 / 60,
				input( {
					physics,
					obstacles: windows,
					magnet: dragging
						? null
						: magnetPull(
							body.core.x,
							body.core.y,
							body.radius,
							windows,
							physics.magnetRange,
						),
					dragTarget: dragging ? { x: 750, y: 700 } : null,
					bounds: { width: 1600, height: 1000 },
				} ),
			);
			if ( ! isSimplePolygon( body ) ) {
				broken++;
			}
			minArea = Math.min(
				minArea,
				Math.abs( polygonArea( body.rim ) ) / body.restArea,
			);
		}
		return { broken, minArea };
	}

	test( 'survives torture without ever self-intersecting', () => {
		const out = torture( PHYSICS );
		expect( out.broken ).toBe( 0 );
		// And never collapses while it's at it.
		expect( out.minArea ).toBeGreaterThan( 0.3 );
		expect( isFiniteBody as unknown ).toBeTruthy();
	} );

	test( 'without the angular constraint it folds and stays folded', () => {
		// The bug this guards: a folded ring satisfies every
		// distance-based constraint — radial limits, edge limits,
		// pressure — so nothing pulls it back out and the mascot is a
		// crescent for the rest of the session.
		const out = torture( { ...PHYSICS, minAngularGap: 0 } );
		expect( out.broken ).toBeGreaterThan( 100 );
	} );

	test( 'a hand-folded body untangles itself', () => {
		const body = createSoftBody( 600, 400, 56, 34 );
		// Reflect half the rim through the centre: a textbook fold.
		body.rim.forEach( ( p, i ) => {
			if ( i < 17 ) {
				p.x = body.core.x - ( p.x - body.core.x );
				p.y = body.core.y - ( p.y - body.core.y );
			}
		} );
		expect( isSimplePolygon( body ) ).toBe( false );

		stepSoftBody( body, 1 / 60, input() );

		expect( isSimplePolygon( body ) ).toBe( true );
	} );

	test( 'repairing a fold does not walk the mascot across the desk', () => {
		// Individual points must move a long way to unfold — that's
		// the repair working. The *body* must not: the corrections
		// are rotations about the centroid and their mean angular
		// drift is projected out, so nothing translates or spins.
		const body = createSoftBody( 600, 400, 56, 34 );
		body.rim.forEach( ( p, i ) => {
			if ( i % 2 === 0 ) {
				p.x = body.core.x - ( p.x - body.core.x ) * 0.8;
				p.y = body.core.y - ( p.y - body.core.y ) * 0.8;
			}
		} );
		// Mangling moves the centroid; measure the drift from where
		// the body actually is, not from where it was built.
		syncCore( body );
		const start = { x: body.core.x, y: body.core.y };
		const calm = { ...PHYSICS, idleWobble: 0, floatAmplitude: 0 };
		run( body, 1, { physics: calm } );

		expect( Math.hypot( body.core.x - start.x, body.core.y - start.y ) )
			.toBeLessThan( 15 );
		// And it recovered its shape rather than settling deformed.
		expect( radiusError( body ) ).toBeLessThan( 12 );
	} );

	test( 'the repair never fires on a healthy body', () => {
		// It must be a no-op in the common case, or it would be
		// quietly regularising the silhouette every frame and killing
		// the soft look. Proven by trajectory equivalence: a body
		// that never folds behaves identically with the constraint
		// switched off.
		const withRepair = createSoftBody( 600, 400, 56, 34 );
		const without = createSoftBody( 600, 400, 56, 34 );
		for ( let i = 0; i < 600; i++ ) {
			stepSoftBody( withRepair, 1 / 60, input() );
			stepSoftBody(
				without,
				1 / 60,
				input( { physics: { ...PHYSICS, minAngularGap: 0 } } ),
			);
		}
		withRepair.rim.forEach( ( p, i ) => {
			expect( p.x ).toBeCloseTo( without.rim[ i ].x, 9 );
			expect( p.y ).toBeCloseTo( without.rim[ i ].y, 9 );
		} );
	} );
} );

describe( 'dragging against windows', () => {
	test( 'the mascot cannot be shoved inside a window', () => {
		const window_: Obstacle = {
			id: 'window:posts',
			kind: 'window',
			x: 400,
			y: 600,
			width: 700,
			height: 250,
		};
		const body = createSoftBody( 750, 300, 56, 34 );
		// Hold the cursor deep inside the window and lean on it.
		let worstPenetration = 0;
		for ( let i = 0; i < 600; i++ ) {
			stepSoftBody(
				body,
				1 / 60,
				input( {
					obstacles: [ window_ ],
					dragTarget: { x: 750, y: 760 },
					bounds: { width: 1600, height: 1000 },
				} ),
			);
			for ( const p of body.rim ) {
				if (
					p.x > window_.x &&
					p.x < window_.x + window_.width &&
					p.y > window_.y &&
					p.y < window_.y + window_.height
				) {
					worstPenetration = Math.max(
						worstPenetration,
						Math.min(
							p.x - window_.x,
							window_.x + window_.width - p.x,
							p.y - window_.y,
							window_.y + window_.height - p.y,
						),
					);
				}
			}
		}
		// Sub-pixel: the angular repair can carry a point a hair
		// across an edge, and that trade is deliberate — see the
		// solver's closing comment.
		expect( worstPenetration ).toBeLessThan( 2 );
		// It stops at the surface instead of sinking in.
		expect( body.core.y ).toBeLessThan( window_.y );
	} );

	test( 'a blocked drag presses firmly but cannot crush the body', () => {
		const window_: Obstacle = {
			id: 'window:posts',
			kind: 'window',
			x: 400,
			y: 600,
			width: 700,
			height: 250,
		};
		const body = createSoftBody( 750, 300, 56, 34 );
		let minHeight = Infinity;
		for ( let i = 0; i < 600; i++ ) {
			stepSoftBody(
				body,
				1 / 60,
				input( {
					obstacles: [ window_ ],
					dragTarget: { x: 750, y: 900 },
					bounds: { width: 1600, height: 1000 },
				} ),
			);
			minHeight = Math.min( minHeight, extents( body ).height );
		}
		// Squashed against the glass — but still a blob, not a line.
		expect( minHeight ).toBeGreaterThan( 56 * 0.6 );
		expect( minHeight ).toBeLessThan( 56 * 1.9 );
	} );
} );

describe( 'resetBody', () => {
	test( 're-forms a mangled body as a clean circle at rest', () => {
		const body = createSoftBody( 100, 100, 50, 24 );
		// Mangle it: shove alternating points in opposite directions,
		// the shape the contact solver produces when a window opens on
		// top of the mascot.
		body.rim.forEach( ( p, i ) => {
			p.x += i % 2 === 0 ? 60 : -60;
			p.vx = 500;
			p.vy = -400;
		} );

		resetBody( body, 700, 300 );

		expect( body.core.x ).toBeCloseTo( 700, 6 );
		expect( body.core.y ).toBeCloseTo( 300, 6 );
		expect( radiusError( body ) ).toBeLessThan( 1e-9 );
		expect( body.rim.every( ( p ) => p.vx === 0 && p.vy === 0 ) ).toBe( true );
	} );
} );

describe( 'helpers', () => {
	test( 'translateBody lands the centroid on the target, deformation intact', () => {
		const body = createSoftBody( 100, 100, 50, 12 );
		// Dent the rim so the centroid no longer matches the
		// construction centre — translateBody must resync, not trust
		// the stale cached centre.
		body.rim[ 0 ].x += 17;
		const centroidBefore = rimCentroid( body.rim );
		const offsets = body.rim.map( ( p ) => ( {
			dx: p.x - centroidBefore.x,
			dy: p.y - centroidBefore.y,
		} ) );
		translateBody( body, 500, 300 );
		expect( body.core.x ).toBeCloseTo( 500, 9 );
		expect( body.core.y ).toBeCloseTo( 300, 9 );
		body.rim.forEach( ( p, i ) => {
			expect( p.x - body.core.x ).toBeCloseTo( offsets[ i ].dx, 9 );
			expect( p.y - body.core.y ).toBeCloseTo( offsets[ i ].dy, 9 );
		} );
	} );

	test( 'rimCentroid tracks the deformed centre', () => {
		const body = createSoftBody( 100, 100, 50, 40 );
		expect( rimCentroid( body.rim ).x ).toBeCloseTo( 100, 6 );
		for ( const p of body.rim ) {
			p.x += 25;
		}
		expect( rimCentroid( body.rim ).x ).toBeCloseTo( 125, 6 );
	} );
} );

describe( 'the rest shape', () => {
	const TRIANGLE = MASCOT_DEFAULTS.physics;
	const profile = ( angle: number ): number => shapeProfile( angle, TRIANGLE );

	/** Radius of the rim point nearest `angle`, relative to the rest radius. */
	function radiusAt( body: SoftBody, angle: number ): number {
		let best = body.rim[ 0 ];
		let bestGap = Infinity;
		for ( const p of body.rim ) {
			const gap = Math.abs(
				Math.atan2(
					Math.sin( p.angle - angle ),
					Math.cos( p.angle - angle ),
				),
			);
			if ( gap < bestGap ) {
				bestGap = gap;
				best = p;
			}
		}
		return (
			Math.hypot( best.x - body.core.x, best.y - body.core.y ) / body.radius
		);
	}

	test( 'a circle is the default for degenerate lobe counts', () => {
		for ( const shapeLobes of [ 0, 1 ] ) {
			expect( shapeProfile( 1.234, { ...TRIANGLE, shapeLobes } ) ).toBe( 1 );
		}
		expect( shapeProfile( 1.234, { ...TRIANGLE, shapeAmount: 0 } ) ).toBe( 1 );
	} );

	test( 'amount 1 is exactly the flat-sided limit for any lobe count', () => {
		// `1 + a·cos(kθ)` has zero curvature at its side midpoints when
		// a = 1/(1 + k²). That is what `shapeAmount: 1` has to mean, or
		// the knob means something different for a triangle than for a
		// hexagon.
		for ( const k of [ 3, 4, 6 ] ) {
			const at = ( angle: number ): number =>
				shapeProfile( angle, {
					...TRIANGLE,
					shapeLobes: k,
					shapeAmount: 1,
					shapeAngle: 0,
				} );
			// Corner (θ = 0) and side midpoint (θ = π/k).
			expect( at( 0 ) - 1 ).toBeCloseTo( 1 / ( 1 + k * k ), 12 );
			expect( 1 - at( Math.PI / k ) ).toBeCloseTo( 1 / ( 1 + k * k ), 12 );
		}
	} );

	test( 'the default puts a corner up and a flat side down', () => {
		// Screen coordinates: -90° is up, +90° is down.
		const up = shapeProfile( -Math.PI / 2, TRIANGLE );
		const down = shapeProfile( Math.PI / 2, TRIANGLE );
		expect( up ).toBeGreaterThan( 1 );
		expect( down ).toBeLessThan( 1 );
		expect( up ).toBeGreaterThan( down );
	} );

	test( 'a body is born the right shape, not a disc that morphs', () => {
		const body = createSoftBody( 600, 400, 56, 36, profile );
		expect( radiusAt( body, -Math.PI / 2 ) ).toBeGreaterThan( 1.02 );
		expect( radiusAt( body, Math.PI / 2 ) ).toBeLessThan( 0.98 );
	} );

	test( 'the springs hold the shape rather than relaxing it away', () => {
		// The real test of a rest-length implementation: leave it alone
		// for two seconds and the corners must still be corners. A shape
		// applied as a one-off displacement would have been eaten by the
		// edge and pressure terms long before this.
		const body = createSoftBody( 600, 400, 56, 36, profile );
		run( body, 2, { physics: TRIANGLE } );
		expect( radiusAt( body, -Math.PI / 2 ) ).toBeGreaterThan(
			radiusAt( body, Math.PI / 2 ) + 0.05,
		);
	} );

	test( 'a disc pulled into shape reaches the same silhouette', () => {
		// No profile at build time, so this one starts as a circle and
		// has to be dragged into a triangle by the springs alone. It is
		// how a live `setConfig` shape change plays out.
		const morphed = createSoftBody( 600, 400, 56, 36 );
		run( morphed, 3, { physics: TRIANGLE } );
		const born = createSoftBody( 600, 400, 56, 36, profile );
		run( born, 3, { physics: TRIANGLE } );
		expect( radiusAt( morphed, -Math.PI / 2 ) ).toBeCloseTo(
			radiusAt( born, -Math.PI / 2 ),
			1,
		);
	} );

	test( 'the shape survives a squash and comes back', () => {
		const body = createSoftBody( 600, 400, 56, 36, profile );
		for ( const p of body.rim ) {
			p.y = body.core.y + ( p.y - body.core.y ) * 0.2;
		}
		syncCore( body );
		run( body, 3, { physics: TRIANGLE } );
		expect( radiusAt( body, -Math.PI / 2 ) ).toBeGreaterThan(
			radiusAt( body, Math.PI / 2 ) + 0.05,
		);
		expect( isFiniteBody( body ) ).toBe( true );
	} );

	test( 'resetBody re-forms the shape, not a circle', () => {
		const body = createSoftBody( 600, 400, 56, 36, profile );
		run( body, 1, { physics: TRIANGLE } );
		resetBody( body, 300, 300 );
		expect( radiusAt( body, -Math.PI / 2 ) ).toBeGreaterThan( 1.02 );
		expect( radiusAt( body, Math.PI / 2 ) ).toBeLessThan( 0.98 );
	} );

	test( 'the outline never folds, even at a clover amount', () => {
		// Past the flat-sided limit the sides bow inward. The angular
		// gap constraint still has to hold: a self-intersecting rim is
		// the one failure the body cannot recover from.
		const clover = { ...TRIANGLE, shapeAmount: 1.4 };
		const body = createSoftBody( 600, 400, 56, 36, ( a ) =>
			shapeProfile( a, clover ),
		);
		run( body, 2, { physics: clover } );
		expect( isFiniteBody( body ) ).toBe( true );
		expect( Math.abs( polygonArea( body.rim ) ) ).toBeGreaterThan(
			body.restArea * 0.4,
		);
	} );
} );
