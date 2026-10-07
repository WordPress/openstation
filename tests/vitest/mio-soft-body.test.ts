import { describe, expect, test } from 'vitest';
import { MIO_DEFAULTS } from '../../src/mio/config';
import { magnetPull, type Obstacle } from '../../src/mio/environment';
import {
	addVelocity,
	createSoftBody,
	polygonArea,
	presetRimPoints,
	resampleBody,
	resetBody,
	rimCentroid,
	shapeProfile,
	stepSoftBody,
	syncCore,
	translateBody,
	type SoftBody,
	type StepInput,
} from '../../src/mio/soft-body';
import type {
	MioPhysics,
	MioShapePreset,
} from '../../src/mio/types';

const BOUNDS = { width: 1200, height: 800 };

const PHYSICS = {
	...MIO_DEFAULTS.physics,
	shapePreset: 'circle' as const,
};

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

function run( body: SoftBody, seconds: number, over: Partial< StepInput > = {} ): void {
	const frames = Math.round( seconds * 60 );
	for ( let i = 0; i < frames; i++ ) {
		stepSoftBody( body, 1 / 60, input( over ) );
	}
}

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

		expect( max - min ).toBeGreaterThan( 3 );
		expect( max - min ).toBeLessThan( 0.6 * 2 * body.radius );
		expect( isFiniteBody( body ) ).toBe( true );
	} );

	test( 'the wobble is smooth — every spring family agrees on the rest shape', () => {

		const body = createSoftBody( 600, 400, 56, 34 );
		run( body, 2 );

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

		expect( worstStep ).toBeGreaterThan( 0.005 );

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

		expect( Math.abs( body.core.x - 600 ) ).toBeLessThan( 40 );
	} );
} );

describe( 'stepSoftBody', () => {
	test( 'pressure re-inflates a squashed blob', () => {
		const body = createSoftBody( 600, 400, 56, 34 );

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

		const lowest = Math.max( ...body.rim.map( ( p ) => p.y ) );
		expect( lowest ).toBeLessThanOrEqual( window_.y + 0.5 );
		expect( lowest ).toBeGreaterThan( window_.y - 8 );

		expect( body.core.y ).toBeGreaterThan( window_.y - body.radius );
		expect( body.core.y ).toBeLessThan( window_.y - body.radius * 0.5 );
	} );

	test( 'the magnet works sideways — there is no global down', () => {

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

		const rightmost = Math.max( ...body.rim.map( ( p ) => p.x ) );
		expect( rightmost ).toBeLessThanOrEqual( window_.x + 0.5 );
		expect( rightmost ).toBeGreaterThan( window_.x - 8 );
		expect( Math.abs( body.core.y - 400 ) ).toBeLessThan( 60 );
	} );

	test( 'Mio parked in a corner comes to rest', () => {

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

	test( 'Mio resting on a flat face comes to rest', () => {
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

		expect( moving.width / moving.height ).toBeGreaterThan( 1.25 );

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

		expect( body.core.x ).toBeGreaterThan( 550 );

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

	function radialFractions( body: SoftBody ): number[] {
		return body.rim.map(
			( p ) =>
				Math.hypot( p.x - body.core.x, p.y - body.core.y ) / body.radius,
		);
	}

	function mangle( body: SoftBody ): void {
		body.rim.forEach( ( p, i ) => {
			const scale = i % 2 === 0 ? 0.05 : 2.6;
			p.x = body.core.x + ( p.x - body.core.x ) * scale;
			p.y = body.core.y + ( p.y - body.core.y ) * scale;
		} );
	}

	test( 'a free body is pulled inside the limits within one frame', () => {

		const body = createSoftBody( 600, 400, 56, 34 );
		mangle( body );
		expect( Math.min( ...radialFractions( body ) ) ).toBeLessThan( 0.1 );
		expect( Math.max( ...radialFractions( body ) ) ).toBeGreaterThan( 2.5 );

		stepSoftBody( body, 1 / 60, input() );

		const after = radialFractions( body );

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

		expect( unlimited ).toBeLessThan( 0.15 );

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

		expect( worstPenetration ).toBeLessThan( 1 );
	} );

	test( 'they stay out of the way in ordinary use', () => {

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

		expect( out.minArea ).toBeGreaterThan( 0.3 );
		expect( isFiniteBody as unknown ).toBeTruthy();
	} );

	test( 'without the angular constraint it folds and stays folded', () => {

		const out = torture( { ...PHYSICS, minAngularGap: 0 } );
		expect( out.broken ).toBeGreaterThan( 100 );
	} );

	test( 'a hand-folded body untangles itself', () => {
		const body = createSoftBody( 600, 400, 56, 34 );

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

	test( 'repairing a fold does not walk Mio across the desk', () => {

		const body = createSoftBody( 600, 400, 56, 34 );
		body.rim.forEach( ( p, i ) => {
			if ( i % 2 === 0 ) {
				p.x = body.core.x - ( p.x - body.core.x ) * 0.8;
				p.y = body.core.y - ( p.y - body.core.y ) * 0.8;
			}
		} );

		syncCore( body );
		const start = { x: body.core.x, y: body.core.y };
		const calm = { ...PHYSICS, idleWobble: 0, floatAmplitude: 0 };
		run( body, 1, { physics: calm } );

		expect( Math.hypot( body.core.x - start.x, body.core.y - start.y ) )
			.toBeLessThan( 15 );

		expect( radiusError( body ) ).toBeLessThan( 12 );
	} );

	test( 'the repair never fires on a healthy body', () => {

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
	test( 'Mio cannot be shoved inside a window', () => {
		const window_: Obstacle = {
			id: 'window:posts',
			kind: 'window',
			x: 400,
			y: 600,
			width: 700,
			height: 250,
		};
		const body = createSoftBody( 750, 300, 56, 34 );

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

		expect( worstPenetration ).toBeLessThan( 2 );

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

		expect( minHeight ).toBeGreaterThan( 56 * 0.6 );
		expect( minHeight ).toBeLessThan( 56 * 1.9 );
	} );
} );

describe( 'resetBody', () => {
	test( 're-forms a mangled body as a clean circle at rest', () => {
		const body = createSoftBody( 100, 100, 50, 24 );

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
	const TRIANGLE = MIO_DEFAULTS.physics;
	const profile = ( angle: number ): number => shapeProfile( angle, TRIANGLE );

	function withPreset( shapePreset: MioShapePreset ): MioPhysics {
		return { ...MIO_DEFAULTS.physics, shapePreset };
	}

	function sweep(
		physics: MioPhysics,
		steps = 720,
	): { angle: number; r: number }[] {
		const out = [];
		for ( let i = 0; i < steps; i++ ) {
			const angle = ( i / steps ) * Math.PI * 2;
			out.push( { angle, r: shapeProfile( angle, physics ) } );
		}
		return out;
	}

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

	test( 'the circle preset is exactly a circle', () => {
		for ( const { r } of sweep( withPreset( 'circle' ) ) ) {
			expect( r ).toBe( 1 );
		}
	} );

	const ALL_PRESETS = [
		'blob',
		'ghost',
		'potato',
		'star',
		'flower',
		'heart',
		'diamond',
		'drop',
		'cloud',
		'custom',
	] as const;

	test( 'zero amount is a circle whatever the preset', () => {

		for ( const p of ALL_PRESETS ) {
			const flat = { ...withPreset( p ), shapeAmount: 0 };
			for ( const { r } of sweep( flat, 60 ) ) {
				expect( r ).toBe( 1 );
			}
		}
	} );

	test( 'every preset stays inside the limits the solver assumes', () => {

		for ( const p of ALL_PRESETS ) {
			for ( const { r } of sweep( withPreset( p ) ) ) {
				expect( r ).toBeGreaterThan( MIO_DEFAULTS.physics.minStretch );
				expect( r ).toBeLessThan( MIO_DEFAULTS.physics.maxStretch );
			}
		}
	} );

	test( 'every preset is a shape you can actually see', () => {

		for ( const p of ALL_PRESETS ) {
			if ( p === 'blob' ) {
				continue;
			}
			const radii = sweep( withPreset( p ) ).map( ( s ) => s.r );
			const spread = Math.max( ...radii ) - Math.min( ...radii );
			expect( spread ).toBeGreaterThan( 0.1 );
		}
	} );

	test( 'no preset is upside down', () => {

		const crownIsHighest = ( p: MioShapePreset ): boolean => {
			const at = ( angle: number ): number =>
				shapeProfile( angle, withPreset( p ) );
			const crown = at( -Math.PI / 2 );
			const foot = at( Math.PI / 2 );
			return crown > foot;
		};

		for ( const p of [ 'star', 'drop', 'cloud' ] as const ) {
			expect( crownIsHighest( p ) ).toBe( true );
		}

		const diamond = withPreset( 'diamond' );
		expect( shapeProfile( -Math.PI / 2, diamond ) ).toBeGreaterThan(
			shapeProfile( -Math.PI / 4, diamond ),
		);
		expect( shapeProfile( -Math.PI / 2, diamond ) ).toBeCloseTo(
			shapeProfile( Math.PI / 2, diamond ),
			12,
		);
		const heart = withPreset( 'heart' );
		expect( shapeProfile( -Math.PI / 2, heart ) ).toBeLessThan( 1 );
		expect( shapeProfile( Math.PI / 2, heart ) ).toBeGreaterThan( 1 );

		for ( let i = 1; i < 12; i++ ) {
			const off = ( i / 12 ) * Math.PI;
			expect( shapeProfile( -Math.PI / 2 + off, heart ) ).toBeCloseTo(
				shapeProfile( -Math.PI / 2 - off, heart ),
				12,
			);
		}
	} );

	test( 'the star has five points, the flower six petals', () => {

		const crests = ( p: MioShapePreset ): number => {
			const radii = sweep( withPreset( p ), 360 ).map( ( s ) => s.r );
			let count = 0;
			for ( let i = 0; i < radii.length; i++ ) {
				const prev = radii[ ( i - 1 + radii.length ) % radii.length ];
				const next = radii[ ( i + 1 ) % radii.length ];
				if ( radii[ i ] > prev && radii[ i ] >= next ) {
					count++;
				}
			}
			return count;
		};
		expect( crests( 'star' ) ).toBe( 5 );
		expect( crests( 'flower' ) ).toBe( 6 );
		expect( crests( 'diamond' ) ).toBe( 4 );
		expect( crests( 'drop' ) ).toBe( 1 );
	} );

	test( 'a star point is narrower than a flower petal', () => {

		const aboveMean = ( p: MioShapePreset ): number => {
			const radii = sweep( withPreset( p ), 720 ).map( ( s ) => s.r );
			const mean = radii.reduce( ( a, b ) => a + b, 0 ) / radii.length;
			return radii.filter( ( r ) => r > mean ).length / radii.length;
		};
		expect( aboveMean( 'star' ) ).toBeLessThan( aboveMean( 'flower' ) );
	} );

	test( 'a degenerate lobe count falls back to a circle', () => {
		for ( const shapeLobes of [ 0, 1 ] ) {
			expect(
				shapeProfile( 1.234, { ...withPreset( 'custom' ), shapeLobes } ),
			).toBe( 1 );
		}
	} );

	test( 'custom at amount 1 is the flat-sided limit for any lobe count', () => {

		for ( const k of [ 3, 4, 6 ] ) {
			const at = ( angle: number ): number =>
				shapeProfile( angle, {
					...withPreset( 'custom' ),
					shapeLobes: k,
					shapeAmount: 1,
					shapeAngle: 0,
				} );

			expect( at( 0 ) - 1 ).toBeCloseTo( 1 / ( 1 + k * k ), 12 );
			expect( 1 - at( Math.PI / k ) ).toBeCloseTo( 1 / ( 1 + k * k ), 12 );
		}
	} );

	test( 'the ghost is a dome on top and feet underneath', () => {
		const ghost = withPreset( 'ghost' );

		for ( let i = 0; i <= 20; i++ ) {
			const angle = -Math.PI + ( i / 20 ) * Math.PI;
			expect( shapeProfile( angle, ghost ) ).toBeCloseTo( 1, 9 );
		}

		for ( const foot of [ Math.PI / 6, Math.PI / 2, ( 5 * Math.PI ) / 6 ] ) {
			for ( const notch of [ Math.PI / 3, ( 2 * Math.PI ) / 3 ] ) {
				expect( shapeProfile( foot, ghost ) ).toBeGreaterThan(
					shapeProfile( notch, ghost ),
				);
			}
		}

		expect( shapeProfile( Math.PI / 4, ghost ) ).toBeGreaterThan( 1.1 );
	} );

	test( 'the potato has no symmetry to speak of', () => {
		const potato = withPreset( 'potato' );

		for ( let a = 0; a < 12; a++ ) {
			const axis = ( a / 12 ) * Math.PI;
			let worst = 0;
			for ( let i = 0; i < 60; i++ ) {
				const angle = ( i / 60 ) * Math.PI * 2;
				worst = Math.max(
					worst,
					Math.abs(
						shapeProfile( angle, potato ) -
							shapeProfile( 2 * axis - angle, potato ),
					),
				);
			}
			expect( worst ).toBeGreaterThan( 0.02 );
		}
	} );

	test( 'the blob preset puts a corner up and a flat side down', () => {

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

		const body = createSoftBody( 600, 400, 56, 36, profile );
		run( body, 2, { physics: TRIANGLE } );
		expect( radiusAt( body, -Math.PI / 2 ) ).toBeGreaterThan(
			radiusAt( body, Math.PI / 2 ) + 0.05,
		);
	} );

	test( 'a disc pulled into shape reaches the same silhouette', () => {

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

	test( 'every preset survives being simulated', () => {

		for ( const p of [ 'circle', 'ghost', 'potato' ] as const ) {
			const physics = withPreset( p );
			const body = createSoftBody( 600, 400, 56, 36, ( a ) =>
				shapeProfile( a, physics ),
			);
			run( body, 2, { physics } );
			expect( isFiniteBody( body ) ).toBe( true );
			expect( Math.abs( polygonArea( body.rim ) ) ).toBeGreaterThan(
				body.restArea * 0.5,
			);
		}
	} );

	test( 'the outline never folds, even at a clover amount', () => {

		const clover = { ...withPreset( 'custom' ), shapeAmount: 1.4 };
		const body = createSoftBody( 600, 400, 56, 36, ( a ) =>
			shapeProfile( a, clover ),
		);
		run( body, 2, { physics: clover } );
		expect( isFiniteBody( body ) ).toBe( true );
		expect( Math.abs( polygonArea( body.rim ) ) ).toBeGreaterThan(
			body.restArea * 0.4,
		);
	} );

	test( 'the pointed presets hold their shape under the springs', () => {

		for ( const p of [ 'star', 'heart', 'drop', 'flower' ] as const ) {
			const physics = {
				...withPreset( p ),
				points: presetRimPoints( withPreset( p ) ),
			};
			const body = createSoftBody(
				600,
				400,
				56,
				physics.points,
				( a ) => shapeProfile( a, physics ),
			);
			run( body, 3, { physics } );
			expect( isFiniteBody( body ) ).toBe( true );

			const radii = body.rim.map( ( q ) =>
				Math.hypot( q.x - body.core.x, q.y - body.core.y ),
			);
			const spread =
				( Math.max( ...radii ) - Math.min( ...radii ) ) / body.radius;
			expect( spread ).toBeGreaterThan( 0.15 );
		}
	} );
} );

describe( 'rim resolution', () => {
	test( 'a preset asks for the resolution its detail needs', () => {

		const at = ( shapePreset: MioShapePreset ): number =>
			presetRimPoints( { ...MIO_DEFAULTS.physics, shapePreset } );

		expect( at( 'circle' ) ).toBe( 12 );
		expect( at( 'blob' ) ).toBe( 12 );

		expect( at( 'star' ) ).toBeGreaterThanOrEqual( 5 * 6 );
		expect( at( 'flower' ) ).toBeGreaterThanOrEqual( 6 * 6 );
		expect( at( 'star' ) ).toBeGreaterThan( at( 'potato' ) );

		expect(
			presetRimPoints( {
				...MIO_DEFAULTS.physics,
				shapePreset: 'custom',
				shapeLobes: 6,
			} ),
		).toBeGreaterThan(
			presetRimPoints( {
				...MIO_DEFAULTS.physics,
				shapePreset: 'custom',
				shapeLobes: 3,
			} ),
		);
	} );

	test( 'a star is unrecognisable at the shipped resolution', () => {

		const physics = { ...MIO_DEFAULTS.physics, shapePreset: 'star' as const };
		const worstError = ( count: number ): number => {
			const sampled: number[] = [];
			for ( let i = 0; i < count; i++ ) {
				sampled.push( shapeProfile( ( i / count ) * Math.PI * 2, physics ) );
			}
			let worst = 0;
			for ( let i = 0; i < 720; i++ ) {
				const angle = ( i / 720 ) * Math.PI * 2;

				const u = ( angle / ( Math.PI * 2 ) ) * count;
				const lo = Math.floor( u );
				const t = u - lo;
				const a = sampled[ lo % count ];
				const b = sampled[ ( lo + 1 ) % count ];
				worst = Math.max(
					worst,
					Math.abs( a + ( b - a ) * t - shapeProfile( angle, physics ) ),
				);
			}
			return worst;
		};

		expect( worstError( 12 ) ).toBeGreaterThan( 0.25 );

		expect( worstError( presetRimPoints( physics ) ) ).toBeLessThan( 0.05 );
	} );

	test( 'resampling preserves position, size and pose', () => {
		const physics = { ...MIO_DEFAULTS.physics, shapePreset: 'circle' as const };
		const body = createSoftBody( 600, 400, 56, 12 );
		run( body, 0.5, { physics } );
		const before = { x: body.core.x, y: body.core.y };
		const areaBefore = Math.abs( polygonArea( body.rim ) );

		resampleBody( body, 40 );

		expect( body.rim ).toHaveLength( 40 );

		expect( body.core.x ).toBeCloseTo( before.x, 1 );
		expect( body.core.y ).toBeCloseTo( before.y, 1 );

		expect( Math.abs( polygonArea( body.rim ) ) ).toBeGreaterThan(
			areaBefore * 0.99,
		);

		body.rim.forEach( ( p, i ) => {
			expect( p.angle ).toBeCloseTo( ( i / 40 ) * Math.PI * 2, 12 );
		} );
	} );

	test( 'resampling up and down again does not shrink Mio', () => {

		const body = createSoftBody( 600, 400, 56, 12 );
		const area = Math.abs( polygonArea( body.rim ) );
		for ( let i = 0; i < 20; i++ ) {
			resampleBody( body, 40 );
			resampleBody( body, 12 );
		}
		expect( Math.abs( polygonArea( body.rim ) ) ).toBeGreaterThan(
			area * 0.98,
		);
	} );

	test( 'the rest area follows the resolution', () => {

		const body = createSoftBody( 600, 400, 56, 12 );
		resampleBody( body, 48 );
		expect( body.restArea ).toBeCloseTo(
			0.5 * 48 * 56 * 56 * Math.sin( ( 2 * Math.PI ) / 48 ),
			6,
		);
	} );

	test( 'a resampled body carries on simulating', () => {
		const physics = { ...MIO_DEFAULTS.physics, shapePreset: 'star' as const };
		const body = createSoftBody( 600, 400, 56, 12, ( a ) =>
			shapeProfile( a, physics ),
		);
		run( body, 0.3, { physics } );
		resampleBody( body, presetRimPoints( physics ) );
		run( body, 2, { physics } );
		expect( isFiniteBody( body ) ).toBe( true );
		expect( Math.abs( polygonArea( body.rim ) ) ).toBeGreaterThan(
			body.restArea * 0.5,
		);
	} );

	test( 'a degenerate resample is refused rather than obeyed', () => {
		const body = createSoftBody( 600, 400, 56, 12 );
		resampleBody( body, 12 );
		expect( body.rim ).toHaveLength( 12 );
		resampleBody( body, 1 );
		expect( body.rim ).toHaveLength( 3 );
	} );
} );

 describe( 'conversation attraction', () => {
	test( 'approaches from any distance without jumping, settles, and blends a reversed destination', () => {
		const body = createSoftBody( 100, 100, 40, 24 );
		const target = { x: 1050, y: 650 };
		stepSoftBody( body, 1 / 60, input( { anchor: target } ) );
		expect( body.core.x ).toBeGreaterThan( 100 );
		expect( body.core.x ).toBeLessThan( 120 );
		for ( let i = 0; i < 240; i++ ) { stepSoftBody( body, 1 / 60, input( { anchor: target } ) ); }
		expect( body.core.x ).toBeCloseTo( target.x, 0 );
		expect( body.core.y ).toBeCloseTo( target.y, 0 );
		stepSoftBody( body, 1 / 60, input( { anchor: { x: 100, y: 100 } } ) );
		expect( body.core.x ).toBeGreaterThan( 1030 );
		for ( let i = 0; i < 240; i++ ) { stepSoftBody( body, 1 / 60, input( { anchor: { x: 100, y: 100 } } ) ); }
		expect( body.core.x ).toBeCloseTo( 100, 0 );
	} );
	test( 'lets dragging override the anchor, then returns after release', () => {
		const body = createSoftBody( 900, 500, 40, 24 );
		const anchor = { x: 900, y: 500 };
		for ( let i = 0; i < 180; i++ ) { stepSoftBody( body, 1 / 60, input( { anchor, dragTarget: { x: 150, y: 150 } } ) ); }
		expect( body.core.x ).toBeLessThan( 180 );
		for ( let i = 0; i < 240; i++ ) { stepSoftBody( body, 1 / 60, input( { anchor } ) ); }
		expect( body.core.x ).toBeCloseTo( 900, 0 );
		expect( body.core.y ).toBeCloseTo( 500, 0 );
	} );
} );
