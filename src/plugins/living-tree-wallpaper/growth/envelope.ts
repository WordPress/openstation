import { ageCurve } from '../dna';
import type { Envelope, GrowthConfig, Vec2 } from '../types';

const LEVELS: Array< { days: number; depth: number } > = [
	{ days: 30, depth: 2 },
	{ days: 180, depth: 4 },
	{ days: 730, depth: 6 },
	{ days: 1825, depth: 8 },
	{ days: 3650, depth: 10 },
];

const DEPTH_ANCIENT = 12;

const MATURE_HEIGHT = 900;

const MATURE_CROWN_RADIUS = 380;

const MATURE_TRUNK_GIRTH = 26.5;

const MATURE_ATTRACTOR_BUDGET = 860;

export function maxDepthForAge( age01: number ): number {
	for ( const level of LEVELS ) {
		if ( age01 < ageCurve( level.days ) ) {
			return level.depth;
		}
	}
	return DEPTH_ANCIENT;
}

export function trunkGirthForAge( age01: number ): number {
	return 2.5 + ( MATURE_TRUNK_GIRTH - 2.5 ) * Math.min( 1, Math.max( 0, age01 ) );
}

export function revealCountForAge( total: number, age01: number ): number {
	const a = Math.min( 1, Math.max( 0, age01 ) );
	return Math.max( 2, Math.min( total, 2 + Math.round( ( total - 2 ) * Math.pow( a, 1.35 ) ) ) );
}

export function buildEnvelope(
	age01: number,
	vigor01: number,
	rng: () => number,
): Envelope {
	void age01;
	void vigor01;

	const heightMax = MATURE_HEIGHT * ( 0.88 + rng() * 0.24 );
	const crownRadius = MATURE_CROWN_RADIUS * ( 0.82 + rng() * 0.36 );

	return {
		heightMax,
		crownRadius,
		trunkBaseGirth: MATURE_TRUNK_GIRTH,
		maxDepth: DEPTH_ANCIENT,
		attractorBudget: MATURE_ATTRACTOR_BUDGET,
	};
}

export function sampleAttractors(
	env: Envelope,
	count: number,
	rng: () => number,
): Vec2[] {
	const out: Vec2[] = [];

	const crownHeight = env.heightMax * 0.72;
	const cy = -( env.heightMax - crownHeight / 2 );
	const rx = env.crownRadius;
	const ry = crownHeight / 2;

	let guard = 0;
	while ( out.length < count && guard < count * 40 ) {
		guard++;
		const x = ( rng() * 2 - 1 ) * rx;
		const y = cy + ( rng() * 2 - 1 ) * ry;
		const nx = x / rx;
		const ny = ( y - cy ) / ry;

		const inside = nx * nx + ny * ny <= 1;
		const pinch = ny < -0.85 ? Math.abs( nx ) < 0.55 : true;
		if ( inside && pinch ) {
			out.push( { x, y } );
		}
	}
	return out;
}

export function buildGrowthConfig(
	env: Envelope,
	vigor01: number,
): GrowthConfig {
	const segLen = Math.min( 24, Math.max( 7, env.heightMax / 42 ) );
	return {
		segLen,
		influenceRadius: segLen * 5,

		killRadius: segLen * 0.82,
		jitter: 0.22,
		tropism: 0.28,
		droop: 0.02,
		maxNodes: Math.max( 6, Math.round( env.attractorBudget * 2 ) ),
		growthRate: 3 + Math.round( 7 * Math.min( 1, Math.max( 0, vigor01 ) ) ),
	};
}
