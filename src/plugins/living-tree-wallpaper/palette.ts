/**
 * The Living Tree — canopy colour.
 *
 * The canopy wears a NATURAL green: one base hue per site (shifted per
 * identity so two blogs never wear the exact same green) with small
 * random per-tuft variation, the way real foliage varies. Leaf *value*
 * comes from `health01` (SEO): green → yellow → red → grey, desaturating
 * with content age. Categories no longer tint the crown — they bloom as
 * wildflowers in the meadow instead (`render/flowers.ts`). See
 * `docs/living-tree-algorithm.md` §A.7.
 *
 * @since 0.9.4
 */

import { hash32 } from './rng';

/**
 * Canopy base hue — a lush leaf green, shifted ±12° per SITE (from the
 * identity seed) so two blogs never wear the exact same green. Part of
 * what makes each site's tree an individual, not a template.
 */
const BASE_HUE = 105;
const BASE_HUE_IDENTITY_SPREAD = 24;

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
 * The site's canopy base hue (0..360). Pure function of the identity
 * key (`siteUrl|siteName`) — the same inputs that seed the skeleton —
 * so a site's green is as much its fingerprint as its silhouette.
 *
 * @param siteKey The identity key, `siteUrl|siteName`.
 * @return Base canopy hue in degrees.
 */
export function canopyHue( siteKey: string ): number {
	const identity = hash32( siteKey );
	return (
		BASE_HUE -
		BASE_HUE_IDENTITY_SPREAD / 2 +
		( identity % ( BASE_HUE_IDENTITY_SPREAD + 1 ) )
	);
}

/**
 * Compute a leaf's packed 0xRRGGBB colour from its hue, health, and the
 * age of the content it represents.
 *
 * Health walks the vitality ramp: 1 → the canopy hue at full
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
	// yellow, 20 = red-orange) regardless of the canopy hue.
	const effectiveHue = health >= 0.7 ? hue : 20 + ( hue - 20 ) * ( health / 0.7 );
	let s = 0.3 + 0.42 * health;
	let l = 0.32 + 0.18 * health;
	// Dry-out: content older than ~2 years desaturates progressively.
	const dryness = clamp01( ( ageDays - 730 ) / 2920 );
	s *= 1 - 0.55 * dryness;
	l -= 0.06 * dryness;
	return hslToRgb( effectiveHue, clamp01( s ), clamp01( l ) );
}
