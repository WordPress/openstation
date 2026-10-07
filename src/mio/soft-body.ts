import {
	clampToBounds,
	resolveObstacleCollisions,
	type MagnetPull,
	type Obstacle,
	type Particle,
} from './environment';
import type { MioPhysics } from './types';

const STRETCH_FULL_SPEED = 1200;

const BUMP_ZONE = 1.25;

export interface RimPoint extends Particle {
	angle: number;
}

export interface SoftBody {

	core: Particle;

	rim: RimPoint[];

	radius: number;

	profile?: ( angle: number ) => number;

	restArea: number;

	elapsed: number;

	accumulator: number;
}

import { TAU, presetRimPoints, shapeProfile } from './shape';

export { presetRimPoints, shapeProfile };

export function createSoftBody(
	cx: number,
	cy: number,
	radius: number,
	count: number,
	profile?: ( angle: number ) => number,
): SoftBody {
	const n = Math.max( 3, Math.round( count ) );
	const rim: RimPoint[] = [];
	for ( let i = 0; i < n; i++ ) {
		const angle = ( i / n ) * Math.PI * 2;
		const r = radius * ( profile ? profile( angle ) : 1 );
		rim.push( {
			angle,
			x: cx + Math.cos( angle ) * r,
			y: cy + Math.sin( angle ) * r,
			vx: 0,
			vy: 0,
		} );
	}
	return {
		core: { x: cx, y: cy, vx: 0, vy: 0 },
		rim,
		radius,
		profile,

		restArea: 0.5 * n * radius * radius * Math.sin( ( 2 * Math.PI ) / n ),
		elapsed: 0,
		accumulator: 0,
	};
}

export function resampleBody( body: SoftBody, count: number ): void {
	const n = Math.max( 3, Math.round( count ) );
	const old = body.rim;
	const from = old.length;
	if ( n === from || from < 3 ) {
		return;
	}
	syncCore( body );
	const cx = body.core.x;
	const cy = body.core.y;

	const radius = ( p: Particle ): number => Math.hypot( p.x - cx, p.y - cy );

	const rim: RimPoint[] = new Array( n );
	for ( let i = 0; i < n; i++ ) {
		const u = ( i / n ) * from;
		const lo = Math.floor( u );
		const t = u - lo;
		const a = old[ lo % from ];
		const b = old[ ( lo + 1 ) % from ];
		let x = a.x + ( b.x - a.x ) * t;
		let y = a.y + ( b.y - a.y ) * t;

		const dist = Math.hypot( x - cx, y - cy );
		if ( dist > 1e-6 ) {
			const want = radius( a ) + ( radius( b ) - radius( a ) ) * t;
			x = cx + ( ( x - cx ) / dist ) * want;
			y = cy + ( ( y - cy ) / dist ) * want;
		}
		rim[ i ] = {
			angle: ( i / n ) * TAU,
			x,
			y,
			vx: a.vx + ( b.vx - a.vx ) * t,
			vy: a.vy + ( b.vy - a.vy ) * t,
		};
	}

	body.rim = rim;

	body.restArea =
		0.5 * n * body.radius * body.radius * Math.sin( ( 2 * Math.PI ) / n );
	syncCore( body );
}

export function polygonArea( rim: readonly Particle[] ): number {
	let area = 0;
	for ( let i = 0; i < rim.length; i++ ) {
		const a = rim[ i ];
		const b = rim[ ( i + 1 ) % rim.length ];
		area += a.x * b.y - b.x * a.y;
	}
	return area / 2;
}

export function rimCentroid( rim: readonly Particle[] ): { x: number; y: number } {
	let x = 0;
	let y = 0;
	for ( const p of rim ) {
		x += p.x;
		y += p.y;
	}
	const n = rim.length || 1;
	return { x: x / n, y: y / n };
}

export function syncCore( body: SoftBody ): void {
	let x = 0;
	let y = 0;
	let vx = 0;
	let vy = 0;
	for ( const p of body.rim ) {
		x += p.x;
		y += p.y;
		vx += p.vx;
		vy += p.vy;
	}
	const n = body.rim.length || 1;
	body.core.x = x / n;
	body.core.y = y / n;
	body.core.vx = vx / n;
	body.core.vy = vy / n;
}

export function translateBody( body: SoftBody, x: number, y: number ): void {
	syncCore( body );
	const dx = x - body.core.x;
	const dy = y - body.core.y;
	for ( const p of body.rim ) {
		p.x += dx;
		p.y += dy;
	}
	syncCore( body );
}

export function addVelocity( body: SoftBody, vx: number, vy: number ): void {
	for ( const p of body.rim ) {
		p.vx += vx;
		p.vy += vy;
	}
	syncCore( body );
}

export function resetBody( body: SoftBody, x: number, y: number ): void {
	const n = body.rim.length;
	for ( let i = 0; i < n; i++ ) {
		const p = body.rim[ i ];
		const r = body.radius * ( body.profile ? body.profile( p.angle ) : 1 );
		p.x = x + Math.cos( p.angle ) * r;
		p.y = y + Math.sin( p.angle ) * r;
		p.vx = 0;
		p.vy = 0;
	}
	body.accumulator = 0;
	syncCore( body );
}

export interface StepInput {
	physics: MioPhysics;

	magnet: MagnetPull | null;

	obstacles: readonly Obstacle[];

	bounds: { width: number; height: number };

	dragTarget: { x: number; y: number } | null;

	anchor?: { x: number; y: number } | null;
}

export function stepSoftBody(
	body: SoftBody,
	frameSeconds: number,
	input: StepInput,
): void {
	const { physics } = input;
	const dt = physics.subStep;

	const safe = Number.isFinite( frameSeconds ) ? frameSeconds : 0;
	const frame = Math.min( Math.max( safe, 0 ), dt * physics.maxSubSteps );
	body.accumulator += frame;

	let steps = 0;
	while ( body.accumulator >= dt && steps < physics.maxSubSteps ) {
		body.accumulator -= dt;
		steps++;
		substep( body, dt, input );
	}

	if ( body.accumulator > dt * physics.maxSubSteps ) {
		body.accumulator = 0;
	}
	syncCore( body );
}

function substep( body: SoftBody, dt: number, input: StepInput ): void {
	const { physics, obstacles, bounds, dragTarget } = input;
	const rim = body.rim;
	const n = rim.length;

	body.elapsed += dt;
	syncCore( body );
	const centre = body.core;

	const pull = input.magnet;
	const strength = pull ? Math.min( 1, Math.max( 0, pull.strength ) ) : 0;
	const float = 1 - strength;

	const wobbleFade = input.dragTarget ? 0 : float;

	const ix = new Float64Array( n );
	const iy = new Float64Array( n );

	const restR = new Float64Array( n );
	const shape = body.profile;
	for ( let i = 0; i < n; i++ ) {
		const a = rim[ i ].angle;
		restR[ i ] = body.radius * ( shape ? shape( a ) : shapeProfile( a, physics ) );
	}

	const wobble = physics.idleWobble * wobbleFade;
	if ( wobble > 0 ) {
		const t = physics.idleWobbleSpeed * body.elapsed;
		for ( let i = 0; i < n; i++ ) {
			const a = rim[ i ].angle;
			const breathe =
				0.55 * Math.sin( 2 * a + t ) +
				0.3 * Math.sin( 3 * a - t * 1.37 + 2.1 ) +
				0.15 * Math.sin( 5 * a + t * 0.71 + 4.2 );
			restR[ i ] *= 1 + wobble * breathe;
		}
	}

	if ( physics.speedStretch > 0 ) {
		const speed = Math.hypot( centre.vx, centre.vy );
		if ( speed > 1 ) {
			const amount =
				physics.speedStretch * Math.min( 1, speed / STRETCH_FULL_SPEED );
			const k = 1 + amount;
			const kk = k * k;
			const dirX = centre.vx / speed;
			const dirY = centre.vy / speed;
			for ( let i = 0; i < n; i++ ) {
				const angle = rim[ i ].angle;

				const a = Math.cos( angle ) * dirX + Math.sin( angle ) * dirY;
				const aa = a * a;

				restR[ i ] /= Math.sqrt( aa / kk + kk * ( 1 - aa ) );
			}
		}
	}

	let targetArea = 0;
	for ( let i = 0; i < n; i++ ) {
		targetArea += restR[ i ] * restR[ ( i + 1 ) % n ];
	}
	targetArea *= 0.5 * Math.sin( ( 2 * Math.PI ) / n );

	if ( physics.radialStiffness > 0 ) {
		for ( let i = 0; i < n; i++ ) {
			const p = rim[ i ];
			let dx = p.x - centre.x;
			let dy = p.y - centre.y;
			let len = Math.hypot( dx, dy );
			if ( len < 1e-6 ) {
				dx = Math.cos( p.angle );
				dy = Math.sin( p.angle );
				len = 1;
			}
			const f = physics.radialStiffness * ( len - restR[ i ] );
			ix[ i ] -= ( f * dx ) / len;
			iy[ i ] -= ( f * dy ) / len;
		}
	}

	applyRingSprings(
		rim,
		ix,
		iy,
		1,
		restR,
		Math.sin( Math.PI / n ),
		physics.edgeStiffness,
	);
	if ( n > 4 && physics.bendStiffness > 0 ) {
		applyRingSprings(
			rim,
			ix,
			iy,
			2,
			restR,
			Math.sin( ( 2 * Math.PI ) / n ),
			physics.bendStiffness,
		);
	}

	if ( physics.pressure > 0 ) {
		const signed = polygonArea( rim );
		const area = Math.abs( signed );
		const deficit = Math.min(
			2,
			Math.max( -1, targetArea / Math.max( area, 1e-3 ) - 1 ),
		);
		if ( deficit !== 0 ) {
			const wind = signed < 0 ? -1 : 1;

			const nominalEdge = 2 * body.radius * Math.sin( Math.PI / n );
			const push =
				( physics.pressure * deficit * wind ) / ( 2 * nominalEdge );
			for ( let i = 0; i < n; i++ ) {
				const a = rim[ i ];
				const b = rim[ ( i + 1 ) % n ];
				const dx = b.x - a.x;
				const dy = b.y - a.y;

				const fx = dy * push;
				const fy = -dx * push;
				ix[ i ] += fx;
				iy[ i ] += fy;
				ix[ ( i + 1 ) % n ] += fx;
				iy[ ( i + 1 ) % n ] += fy;
			}
		}
	}

	let meanIx = 0;
	let meanIy = 0;
	for ( let i = 0; i < n; i++ ) {
		meanIx += ix[ i ];
		meanIy += iy[ i ];
	}
	meanIx /= n;
	meanIy /= n;

	const w = physics.floatSpeed;
	const bobA = -physics.floatAmplitude * w * w * Math.sin( w * body.elapsed );
	const swayA =
		-0.17 *
		physics.floatAmplitude *
		w *
		w *
		Math.sin( w * 0.7 * body.elapsed + 1.1 );
	let extX = float * swayA;
	let extY = float * bobA;
	if ( pull ) {
		const restGap = -body.radius * physics.magnetGrip;
		const soft = Math.max( 1, body.radius * 0.35 );
		const offset = Math.min( 1, Math.max( -1, ( pull.gap - restGap ) / soft ) );
		const magnet = physics.magnetStrength * strength * offset;
		extX += pull.dx * magnet;
		extY += pull.dy * magnet;

		const hold = physics.magnetDamping * strength;
		extX -= centre.vx * hold;
		extY -= centre.vy * hold;
	}

	if ( input.anchor && ! dragTarget ) {
		const r = body.radius;
		const x = clamp( input.anchor.x, r, Math.max( r, bounds.width - r ) );
		const y = clamp( input.anchor.y, r, Math.max( r, bounds.height - r ) );
		const stiffness = 48;
		const damping = 2 * Math.sqrt( stiffness );
		extX = ( x - centre.x ) * stiffness - centre.vx * damping;
		extY = ( y - centre.y ) * stiffness - centre.vy * damping;
	}

	if ( dragTarget ) {
		const r = body.radius;
		const tx = clamp( dragTarget.x, r, Math.max( r, bounds.width - r ) );
		const ty = clamp( dragTarget.y, r, Math.max( r, bounds.height - r ) );
		const k = physics.dragStiffness;
		const c = 2 * Math.sqrt( k );
		let dragX = ( tx - centre.x ) * k - centre.vx * c;
		let dragY = ( ty - centre.y ) * k - centre.vy * c;

		const magnitude = Math.hypot( dragX, dragY );
		if ( magnitude > physics.dragMaxAccel ) {
			const scale = physics.dragMaxAccel / magnitude;
			dragX *= scale;
			dragY *= scale;
		}
		extX += dragX;
		extY += dragY;
	}

	const internalDamp = 1 + physics.damping * dt;
	const airDamp = 1 + physics.airDamping * dt;
	const meanVx = centre.vx;
	const meanVy = centre.vy;
	for ( let i = 0; i < n; i++ ) {
		const p = rim[ i ];
		let vx = p.vx + ( ix[ i ] - meanIx + extX ) * dt;
		let vy = p.vy + ( iy[ i ] - meanIy + extY ) * dt;

		vx = meanVx + ( vx - meanVx ) / internalDamp;
		vy = meanVy + ( vy - meanVy ) / internalDamp;
		p.vx = vx / airDamp;
		p.vy = vy / airDamp;
		p.x += p.vx * dt;
		p.y += p.vy * dt;
	}

	const contacting = new Uint8Array( n );
	const contactPass = (): void => {
		for ( let i = 0; i < n; i++ ) {
			const hit = resolveObstacleCollisions(
				rim[ i ],
				obstacles,
				physics.restitution,
				physics.friction,
			);
			const clamped = clampToBounds(
				rim[ i ],
				bounds.width,
				bounds.height,
				physics.restitution,
				physics.friction,
			);
			contacting[ i ] = hit || clamped ? 1 : 0;
		}
	};

	const solverPasses = Math.max( 1, physics.limitIterations );
	for ( let pass = 0; pass < solverPasses; pass++ ) {
		contactPass();
		if ( physics.limitIterations > 0 ) {
			enforceLimits( body, restR, physics );
		}
		enforceAngularOrder( body, physics.minAngularGap );
	}

	if ( physics.limitIterations > 0 ) {
		contactPass();
		enforceLimits( body, restR, physics, contacting );
	}

	enforceAngularOrder( body, physics.minAngularGap );
}

function clamp( v: number, lo: number, hi: number ): number {
	return Math.min( Math.max( v, lo ), Math.max( lo, hi ) );
}

function enforceAngularOrder( body: SoftBody, minGapFraction: number ): void {
	const rim = body.rim;
	const n = rim.length;
	if ( n < 3 || minGapFraction <= 0 || minGapFraction >= 1 ) {
		return;
	}
	syncCore( body );
	const cx = body.core.x;
	const cy = body.core.y;
	const even = ( 2 * Math.PI ) / n;
	const minGap = even * minGapFraction;

	const angle = new Float64Array( n );
	const gap = new Float64Array( n );
	for ( let i = 0; i < n; i++ ) {
		angle[ i ] = Math.atan2( rim[ i ].y - cy, rim[ i ].x - cx );
	}
	let total = 0;
	let healthy = true;
	for ( let i = 0; i < n; i++ ) {
		let g = angle[ ( i + 1 ) % n ] - angle[ i ];
		while ( g <= -Math.PI ) {
			g += 2 * Math.PI;
		}
		while ( g > Math.PI ) {
			g -= 2 * Math.PI;
		}
		gap[ i ] = g;
		total += g;
		if ( g < minGap ) {
			healthy = false;
		}
	}

	if ( healthy && Math.abs( total - 2 * Math.PI ) < 1e-6 ) {
		return;
	}

	const slackBudget = 2 * Math.PI - n * minGap;
	let slackTotal = 0;
	for ( let i = 0; i < n; i++ ) {
		const clamped = Math.max( gap[ i ], minGap );
		gap[ i ] = clamped;
		slackTotal += clamped - minGap;
	}
	if ( slackTotal > 1e-9 ) {
		const scale = slackBudget / slackTotal;
		for ( let i = 0; i < n; i++ ) {
			gap[ i ] = minGap + ( gap[ i ] - minGap ) * scale;
		}
	} else {
		gap.fill( even );
	}

	const target = new Float64Array( n );
	target[ 0 ] = angle[ 0 ];
	for ( let i = 1; i < n; i++ ) {
		target[ i ] = target[ i - 1 ] + gap[ i - 1 ];
	}
	let drift = 0;
	for ( let i = 0; i < n; i++ ) {
		let d = target[ i ] - angle[ i ];
		while ( d <= -Math.PI ) {
			d += 2 * Math.PI;
		}
		while ( d > Math.PI ) {
			d -= 2 * Math.PI;
		}
		drift += d;
	}
	drift /= n;

	for ( let i = 0; i < n; i++ ) {
		let delta = target[ i ] - drift - angle[ i ];
		while ( delta <= -Math.PI ) {
			delta += 2 * Math.PI;
		}
		while ( delta > Math.PI ) {
			delta -= 2 * Math.PI;
		}
		if ( delta !== 0 ) {
			rotateAbout( rim[ i ], cx, cy, delta );
		}
	}
}

function rotateAbout(
	p: Particle,
	cx: number,
	cy: number,
	angle: number,
): void {
	const cos = Math.cos( angle );
	const sin = Math.sin( angle );
	const dx = p.x - cx;
	const dy = p.y - cy;
	p.x = cx + dx * cos - dy * sin;
	p.y = cy + dx * sin + dy * cos;

	const vx = p.vx;
	const vy = p.vy;
	p.vx = vx * cos - vy * sin;
	p.vy = vx * sin + vy * cos;
}

function limitDistance(
	a: Particle,
	b: Particle,
	minLen: number,
	maxLen: number,
): boolean {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot( dx, dy );
	if ( len < 1e-6 ) {
		return false;
	}
	let target = 0;
	if ( len > maxLen ) {
		target = maxLen;
	} else if ( len < minLen ) {
		target = minLen;
	} else {
		return false;
	}

	const nx = dx / len;
	const ny = dy / len;
	const shift = ( len - target ) * 0.5;
	a.x += nx * shift;
	a.y += ny * shift;
	b.x -= nx * shift;
	b.y -= ny * shift;

	const relative = ( b.vx - a.vx ) * nx + ( b.vy - a.vy ) * ny;
	const feeding = target === maxLen ? relative > 0 : relative < 0;
	if ( feeding ) {
		const half = relative * 0.5;
		a.vx += nx * half;
		a.vy += ny * half;
		b.vx -= nx * half;
		b.vy -= ny * half;
	}
	return true;
}

function enforceLimits(
	body: SoftBody,
	restR: Float64Array,
	physics: MioPhysics,
	pinned: Uint8Array | null = null,
): void {
	const rim = body.rim;
	const n = rim.length;
	const chord = Math.sin( Math.PI / n );
	const min = physics.minStretch;
	const max = physics.maxStretch;

	for ( let i = 0; i < n; i++ ) {
		const j = ( i + 1 ) % n;
		if ( pinned && ( pinned[ i ] || pinned[ j ] ) ) {
			continue;
		}
		const rest = ( restR[ i ] + restR[ j ] ) * chord;
		limitDistance( rim[ i ], rim[ j ], rest * min, rest * max );
	}

	syncCore( body );
	const cx = body.core.x;
	const cy = body.core.y;
	let shiftX = 0;
	let shiftY = 0;
	let touched = false;
	for ( let i = 0; i < n; i++ ) {
		if ( pinned && pinned[ i ] ) {
			continue;
		}
		const p = rim[ i ];
		const dx = p.x - cx;
		const dy = p.y - cy;
		const len = Math.hypot( dx, dy );
		if ( len < 1e-6 ) {
			continue;
		}
		const lo = restR[ i ] * min;
		const hi = restR[ i ] * max;
		const ux = dx / len;
		const uy = dy / len;
		const radial = p.vx * ux + p.vy * uy;

		const zoneLo = lo * BUMP_ZONE;
		const zoneHi = hi / BUMP_ZONE;
		if ( len < zoneLo && radial < 0 && zoneLo > lo ) {
			const t = Math.min( 1, ( zoneLo - len ) / ( zoneLo - lo ) );
			p.vx -= ux * radial * t;
			p.vy -= uy * radial * t;
		} else if ( len > zoneHi && radial > 0 && hi > zoneHi ) {
			const t = Math.min( 1, ( len - zoneHi ) / ( hi - zoneHi ) );
			p.vx -= ux * radial * t;
			p.vy -= uy * radial * t;
		}

		let target = 0;
		if ( len < lo ) {
			target = lo;
		} else if ( len > hi ) {
			target = hi;
		} else {
			continue;
		}
		const scale = target / len;
		const nx = dx * ( scale - 1 );
		const ny = dy * ( scale - 1 );
		p.x += nx;
		p.y += ny;
		shiftX += nx;
		shiftY += ny;
		touched = true;

		const after = p.vx * ux + p.vy * uy;
		if ( target === lo ? after < 0 : after > 0 ) {
			p.vx -= ux * after;
			p.vy -= uy * after;
		}
	}
	if ( touched ) {
		let movable = n;
		if ( pinned ) {
			movable = 0;
			for ( let i = 0; i < n; i++ ) {
				if ( ! pinned[ i ] ) {
					movable++;
				}
			}
		}
		if ( movable > 0 ) {
			const meanX = shiftX / movable;
			const meanY = shiftY / movable;
			for ( let i = 0; i < n; i++ ) {
				if ( pinned && pinned[ i ] ) {
					continue;
				}
				rim[ i ].x -= meanX;
				rim[ i ].y -= meanY;
			}
		}
	}
	syncCore( body );
}

function applyRingSprings(
	rim: readonly RimPoint[],
	ax: Float64Array,
	ay: Float64Array,
	stride: number,
	restR: Float64Array,
	chordFactor: number,
	stiffness: number,
): void {
	if ( stiffness <= 0 ) {
		return;
	}
	const n = rim.length;
	for ( let i = 0; i < n; i++ ) {
		const j = ( i + stride ) % n;
		const a = rim[ i ];
		const b = rim[ j ];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot( dx, dy );
		if ( len < 1e-6 ) {
			continue;
		}
		const rest = ( restR[ i ] + restR[ j ] ) * chordFactor;
		const f = ( stiffness * ( len - rest ) ) / 2;
		const nx = dx / len;
		const ny = dy / len;
		ax[ i ] += f * nx;
		ay[ i ] += f * ny;
		ax[ j ] -= f * nx;
		ay[ j ] -= f * ny;
	}
}
