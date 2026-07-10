/**
 * The Living Tree — category palette + leaf colour.
 *
 * Categories partition a hue band; each leaf inherits the hue of its
 * cluster's dominant category. Diversity controls how wide the band is:
 * a one-category site reads as a uniform green canopy, a folksonomy
 * spreads toward the full wheel. Leaf *value* comes from `health01`
 * (SEO): green → yellow → red → grey, desaturating with content age.
 * See `docs/living-tree-algorithm.md` §A.7.
 *
 * @since 0.9.4
 */

import { hash32 } from './rng';
import type { HuePartition, TreeSnapshot } from './types';

/**
 * Canopy base hue — a lush leaf green, shifted ±12° per SITE (from the
 * identity seed) so two blogs never wear the exact same green. Part of
 * what makes each site's tree an individual, not a template.
 */
const BASE_HUE = 105;
const BASE_HUE_IDENTITY_SPREAD = 24;

/**
 * Full spread of the hue band at diversity 1 (degrees). Wide enough that
 * a taxonomy-rich site reads as visibly distinct colour regions (spring
 * golds through greens into blue-teals) while staying inside foliage-
 * plausible hues — varied canopy, not confetti.
 */
const MAX_SPREAD = 150;

function clamp01( v: number ): number {
	return Math.min( 1, Math.max( 0, v ) );
}

/** HSL → packed 0xRRGGBB, h in degrees, s/l in 0..1. No bitwise ops. */
function hslToRgb( h: number, s: number, l: number ): number {
	const hue = ( ( h % 360 ) + 360 ) % 360;
	const c = ( 1 - Math.abs( 2 * l - 1 ) ) * s;
	const x = c * ( 1 - Math.abs( ( ( hue / 60 ) % 2 ) - 1 ) );
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if ( hue < 60 ) {
		r = c;
		g = x;
	} else if ( hue < 120 ) {
		r = x;
		g = c;
	} else if ( hue < 180 ) {
		g = c;
		b = x;
	} else if ( hue < 240 ) {
		g = x;
		b = c;
	} else if ( hue < 300 ) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}
	const to255 = ( v: number ): number => Math.round( ( v + m ) * 255 );
	return to255( r ) * 65536 + to255( g ) * 256 + to255( b );
}

/**
 * Build the category → hue partition from a snapshot's category count.
 * The band is centred on leaf green and widens with taxonomy richness,
 * so 2000 categories → many mixed hues across the canopy → still a tree.
 *
 * @param snapshot The tree snapshot (category/tag counts feed the spread).
 * @return A {@link HuePartition} resolving category ids to hues.
 */
export function buildCategoryPalette( snapshot: TreeSnapshot ): HuePartition {
	const n = Math.min( 24, Math.max( 1, snapshot.totalCategories ) );
	const terms = Math.max( 0, snapshot.totalCategories ) + Math.max( 0, snapshot.totalTags );
	const richness = terms / ( terms + 30 ); // saturating, mirrors diversity01
	const spread = MAX_SPREAD * richness;
	// Per-site identity: the same seed inputs that shape the skeleton
	// nudge the canopy's base green.
	const identity = hash32( `${ snapshot.siteUrl }|${ snapshot.siteName }` );
	const baseHue =
		BASE_HUE - BASE_HUE_IDENTITY_SPREAD / 2 + ( identity % ( BASE_HUE_IDENTITY_SPREAD + 1 ) );

	const bands: Array< { id: number; hue: number } > = [];
	for ( let i = 0; i < n; i++ ) {
		const t = n === 1 ? 0.5 : i / ( n - 1 );
		bands.push( { id: i, hue: baseHue + ( t - 0.5 ) * spread } );
	}

	return {
		bands,
		hueForCategory( categoryId: number ): number {
			const idx = ( ( categoryId % n ) + n ) % n;
			return bands[ idx ].hue;
		},
	};
}

/**
 * Compute a leaf's packed 0xRRGGBB colour from its hue, health, and the
 * age of the content it represents.
 *
 * Health walks the vitality ramp: 1 → the category hue at full
 * saturation, ~0.5 → shifted toward yellow, ~0.25 → red-orange, → 0 →
 * grey. Old content dries out (desaturates + darkens).
 *
 * @param hue      Base hue, 0..360.
 * @param health01 Vitality, 0..1.
 * @param ageDays  Age of the represented content — older leaves dry out.
 * @return Packed 0xRRGGBB colour.
 */
export function leafColor( hue: number, health01: number, ageDays: number ): number {
	const health = clamp01( health01 );
	// Below the healthy band the hue slides toward the warm end (60 =
	// yellow, 20 = red-orange) regardless of category.
	const effectiveHue = health >= 0.7 ? hue : 20 + ( hue - 20 ) * ( health / 0.7 );
	let s = 0.3 + 0.42 * health;
	let l = 0.32 + 0.18 * health;
	// Dry-out: content older than ~2 years desaturates progressively.
	const dryness = clamp01( ( ageDays - 730 ) / 2920 );
	s *= 1 - 0.55 * dryness;
	l -= 0.06 * dryness;
	return hslToRgb( effectiveHue, clamp01( s ), clamp01( l ) );
}
