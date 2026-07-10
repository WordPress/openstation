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

/** Clamp to the unit interval. */
function clamp01( v: number ): number {
	return Math.min( 1, Math.max( 0, v ) );
}

/** Saturating half-life curve: 0 → 0, `k` → 0.5, ∞ → 1. */
function sat( v: number, k: number ): number {
	return v <= 0 ? 0 : v / ( v + k );
}

/**
 * Saturating logarithmic age curve — the master clock. Fast change in the
 * early days, flattening as the site matures so extra age past ~10y buys
 * texture, not height.
 *
 * @param days Site age in days.
 * @return Normalised age, 0..1.
 */
export function ageCurve( days: number ): number {
	if ( days <= 0 ) {
		return 0;
	}
	return clamp01( Math.log1p( days ) / Math.log1p( AGE_SATURATION_DAYS ) );
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

	// Diversity approximates taxonomy entropy from term counts — a site
	// with one category reads monochrome, a folksonomy reads iridescent.
	const diversity01 = clamp01(
		sat( Math.max( 0, snapshot.totalCategories ) + Math.max( 0, snapshot.totalTags ), 30 ),
	);

	// Wind keeps a gentle floor so the tree always feels alive, scaling
	// up with traffic.
	const wind01 = clamp01( 0.2 + 0.8 * sat( traffic, 5000 ) );

	const pages = Math.max( 0, snapshot.totalPages );

	return {
		age01: ageCurve( snapshot.siteAgeDays ),
		vigor01,
		foliage01: clamp01( sat( posts, 150 ) ),
		health01: clamp01( snapshot.seoHealth ),
		diversity01,
		bloom01,
		wind01,
		// Pages are the site's evergreen scaffolding → structural mass.
		structure01: clamp01( sat( pages, 40 ) ),
		// Performance → how vividly the canopy holds itself up.
		vitality01: performance,
		spark: Math.min( 40, Math.round( users ) ),
	};
}
