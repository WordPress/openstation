/**
 * The Living Tree — snapshot → hormones.
 *
 * `buildHormones()` is the sole mapping from raw WordPress metrics into
 * the normalised DNA the growth + decoration layers consume. See
 * `docs/living-tree-algorithm.md` §A.3.
 *
 * Every hormone is a saturating function of its metric — sites of wildly
 * different sizes land inside the same 0..1 band, they just approach the
 * ceiling at different speeds. `sat( v, k )` is the shared half-life
 * curve: 0 at 0, 0.5 at `k`, →1 as `v` → ∞.
 *
 * @since 0.9.4
 */

import type { Hormones, TreeSnapshot } from './types';

/** Days after which the age curve saturates (10 years). */
const AGE_SATURATION_DAYS = 3650;

/**
 * Master-clock ticks per day for a young site: the sapling regime.
 *
 * The raw log curve alone put a day-old site at ~8% of the clock and a
 * month-old one at ~42% — sprout to TREE overnight. A smoothstep damp
 * was tried first and had the opposite failure: its quadratic start
 * left days 0–10 pinned at the 2-node sprout, no visible growth at
 * all. The fix is a LINEAR clock — `days × this constant` — taken via
 * `min()` against the log curve. Every early day advances the clock by
 * the same step (a node or two of new growth, plainly visible on a
 * seedling), a month in reads as a small sapling (~12% of the clock,
 * with the §A.4 depth cap keeping it low and simple), and the linear
 * ramp crosses the log curve at ~5 months — from there the raw log
 * regime takes over unchanged.
 */
const SAPLING_CLOCK_PER_DAY = 1 / 250;

/** Clamp to the unit interval. */
function clamp01( v: number ): number {
	return Math.min( 1, Math.max( 0, v ) );
}

/** Saturating half-life curve: 0 → 0, `k` → 0.5, ∞ → 1. */
function sat( v: number, k: number ): number {
	return v <= 0 ? 0 : v / ( v + k );
}

/**
 * Saturating logarithmic age curve — the master clock, with a linear
 * sapling regime for young sites.
 *
 * `min()` of two monotone curves:
 *
 *   - `days × SAPLING_CLOCK_PER_DAY` — wins for roughly the first five
 *     months. Steady day-by-day growth: day 1 a sprout, every early
 *     day visibly adds a node or two, a month in reads as a small
 *     sapling.
 *   - the raw saturating log curve — wins from ~5 months on: fast
 *     through the first years, flattening so extra age past ~10y buys
 *     texture, not height.
 *
 * Monotone across the whole domain (min of two increasing curves),
 * which is what `maxDepthForAge`'s day-threshold comparisons rely on.
 *
 * @param days Site age in days.
 * @return Normalised age, 0..1.
 */
export function ageCurve( days: number ): number {
	if ( days <= 0 ) {
		return 0;
	}
	const log01 = clamp01(
		Math.log1p( days ) / Math.log1p( AGE_SATURATION_DAYS ),
	);
	return Math.min( log01, days * SAPLING_CLOCK_PER_DAY );
}

/**
 * Map a snapshot to the normalised hormone set. All fields 0..1 except
 * `spark` (an integer firefly count).
 *
 * @param snapshot Raw metrics from the REST snapshot.
 * @return The DNA driving morphology + decoration.
 */
export function buildHormones( snapshot: TreeSnapshot ): Hormones {
	const posts = Math.max( 0, snapshot.totalPosts );
	const comments = Math.max( 0, snapshot.totalComments );
	const traffic = Math.max( 0, snapshot.traffic );
	const users = Math.max( 0, snapshot.activeUsers );
	const performance = clamp01( snapshot.performance );

	// Energy composite: content + conversation + audience + presence,
	// each saturating on its own scale, throttled by performance headroom
	// (a struggling site grows sluggishly even when busy).
	const energy =
		0.35 * sat( posts, 120 ) +
		0.25 * sat( comments, 400 ) +
		0.25 * sat( traffic, 2000 ) +
		0.15 * sat( users, 8 );
	const vigor01 = clamp01( energy * ( 0.6 + 0.4 * performance ) );

	// Bloom follows conversation density, not volume: comments per post.
	const bloom01 = clamp01( sat( comments / Math.max( 1, posts ), 4 ) );

	// Wind keeps a gentle floor so the tree always feels alive, scaling
	// up with traffic.
	const wind01 = clamp01( 0.2 + 0.8 * sat( traffic, 5000 ) );

	const pages = Math.max( 0, snapshot.totalPages );

	return {
		age01: ageCurve( snapshot.siteAgeDays ),
		vigor01,
		foliage01: clamp01( sat( posts, 150 ) ),
		health01: clamp01( snapshot.seoHealth ),
		bloom01,
		wind01,
		// Pages are the site's evergreen scaffolding → structural mass.
		structure01: clamp01( sat( pages, 40 ) ),
		// Performance → how vividly the canopy holds itself up.
		vitality01: performance,
		spark: Math.min( 40, Math.round( users ) ),
	};
}
