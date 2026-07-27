/**
 * The Living Tree — morphological envelope + attractor sampling + age
 * gates.
 *
 * **The canonical-skeleton principle.** The envelope — and therefore the
 * attractor cloud and the fully-grown skeleton — is a function of the
 * SEED ALONE. Age never touches the geometry: it decides how much of the
 * canonical skeleton is *revealed* (`revealCountForAge`), how many
 * branching levels are unlocked (`maxDepthForAge`), and how thick the
 * wood is (`trunkGirthForAge`). That is what makes growth **gradual and
 * monotone**: tomorrow's tree is exactly today's tree plus a few more
 * nodes of the same immutable structure — never a reshuffle. (The first
 * design derived the envelope from `age01`; every daily tick of
 * `siteAgeDays` shifted the rejection-sampling boundaries and re-rolled
 * the whole topology.)
 *
 * See `docs/living-tree-algorithm.md` §A.4.
 */

import { ageCurve } from '../dna';
import type { Envelope, GrowthConfig, Vec2 } from '../types';

/**
 * Age → branching-levels table (§A.4). Thresholds are expressed in days
 * and compared through the same `ageCurve` the hormones use, so the
 * mapping stays monotone in `age01`.
 */
const LEVELS: Array< { days: number; depth: number } > = [
	{ days: 30, depth: 2 },
	{ days: 180, depth: 4 },
	{ days: 730, depth: 6 },
	{ days: 1825, depth: 8 },
	{ days: 3650, depth: 10 },
];

/** Depth ceiling for 10+ year sites — texture, not more height. */
const DEPTH_ANCIENT = 12;

/** The mature reference height every canonical skeleton grows toward. */
const MATURE_HEIGHT = 900;

/** The mature crown half-width. */
const MATURE_CROWN_RADIUS = 380;

/** The mature trunk-base radius (before the structure hormone). */
const MATURE_TRUNK_GIRTH = 26.5;

/**
 * Auxin sources in the mature crown. Dense on purpose — a rich cloud
 * yields the fine interior twigs that let foliage clothe the whole
 * canopy, not just its rim, and every twig is a leaf anchor: interior
 * density here is what removes "empty" patches inside the crown.
 */
const MATURE_ATTRACTOR_BUDGET = 860;

/**
 * Branching levels unlocked at a given age (§A.4 table).
 *
 * @param age01 Master clock, 0..1.
 * @return Depth cap for the revealed skeleton.
 */
export function maxDepthForAge( age01: number ): number {
	for ( const level of LEVELS ) {
		// Strict: the curve clamps to exactly 1.0 at the last threshold,
		// and a 10+ year site must fall through to the ancient tier.
		if ( age01 < ageCurve( level.days ) ) {
			return level.depth;
		}
	}
	return DEPTH_ANCIENT;
}

/**
 * Trunk-base radius at a given age (before the structure hormone).
 *
 * @param age01 Master clock, 0..1.
 * @return Base radius in reference units.
 */
export function trunkGirthForAge( age01: number ): number {
	return 2.5 + ( MATURE_TRUNK_GIRTH - 2.5 ) * Math.min( 1, Math.max( 0, age01 ) );
}

/**
 * How many nodes of the canonical skeleton an age reveals. Monotone in
 * `age01` — THE gradual-growth guarantee. Sub-linear early so a young
 * site visibly sprints, an old one refines.
 *
 * @param total Nodes available (after the depth cap).
 * @param age01 Master clock, 0..1.
 * @return Node count to reveal, 2..total.
 */
export function revealCountForAge( total: number, age01: number ): number {
	const a = Math.min( 1, Math.max( 0, age01 ) );
	return Math.max( 2, Math.min( total, 2 + Math.round( ( total - 2 ) * Math.pow( a, 1.35 ) ) ) );
}

/**
 * Build the canonical (mature) envelope. Seed-only: `age01` / `vigor01`
 * are accepted for signature stability but deliberately shape NOTHING —
 * the gradual-growth guarantee and the topology invariant both depend on
 * that.
 *
 * @param age01   Accepted, unused (see above).
 * @param vigor01 Accepted, unused — pacing comes from buildGrowthConfig.
 * @param rng     Seeded PRNG for silhouette jitter.
 * @return The mature envelope.
 */
export function buildEnvelope(
	age01: number,
	vigor01: number,
	rng: () => number,
): Envelope {
	void age01;
	void vigor01;

	// Wide deterministic jitter — each site is an INDIVIDUAL: some grow
	// tall and narrow, some low and spreading. (±6% was tried first and
	// every site's tree read as the same template.)
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

/**
 * Scatter `count` auxin attractors inside the crown volume — an egg
 * (ellipse, slightly bottom-heavy) whose base sits above the trunk gap.
 * Rejection sampling with the seeded PRNG keeps the cloud deterministic.
 *
 * @param env   The envelope to sample within.
 * @param count Number of attractors to place.
 * @param rng   Seeded PRNG.
 * @return Attractor positions in reference space (root at origin, up = -y).
 */
export function sampleAttractors(
	env: Envelope,
	count: number,
	rng: () => number,
): Vec2[] {
	const out: Vec2[] = [];
	// Crown occupies the upper ~72% of the height; the lower 28% is the
	// trunk gap the skeleton must climb through.
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
		// Egg profile: full ellipse, mildly pinched at the very top so the
		// crown reads rounded rather than onion-pointed.
		const inside = nx * nx + ny * ny <= 1;
		const pinch = ny < -0.85 ? Math.abs( nx ) < 0.55 : true;
		if ( inside && pinch ) {
			out.push( { x, y } );
		}
	}
	return out;
}

/**
 * Growth tuning derived from the envelope (shape) and vigour (pacing
 * only). `growthRate` is now "revealed nodes per frame" — the canonical
 * skeleton is fully grown up front; pacing only controls how fast the
 * reveal animation plays, never what the tree looks like.
 *
 * @param env     The envelope.
 * @param vigor01 Growth energy, 0..1.
 * @return Growth config for {@link GrowthSimulator} + the reveal pacing.
 */
export function buildGrowthConfig(
	env: Envelope,
	vigor01: number,
): GrowthConfig {
	const segLen = Math.min( 24, Math.max( 7, env.heightMax / 42 ) );
	return {
		segLen,
		influenceRadius: segLen * 5,
		// Tight kill radius: attractors survive near a passing branch long
		// enough to pull secondary shoots out of it — this is where the
		// fine interior twigs (and therefore full-canopy foliage) come
		// from. A generous radius mows the cloud down into bare chains.
		killRadius: segLen * 0.82,
		jitter: 0.22,
		tropism: 0.28,
		droop: 0.02,
		maxNodes: Math.max( 6, Math.round( env.attractorBudget * 2 ) ),
		growthRate: 3 + Math.round( 7 * Math.min( 1, Math.max( 0, vigor01 ) ) ),
	};
}
