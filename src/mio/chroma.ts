/**
 * Desktop Mode — Mio chroma ring.
 *
 * Mio's outline is not one colour: hue sweeps around the
 * perimeter (magenta at the crown, through violet, into blue at the
 * heel) and the whole sweep rotates slowly, which is what gives the
 * ring its "chroma" shimmer instead of reading as a flat neon tube.
 *
 * On top of that ramp sits the **hologram**. A real holographic
 * surface does not have a colour, it has a colour *per viewing angle*:
 * tilt the sticker and the rainbow slides across it. Mio has no
 * viewer to track, so the rake direction {@link HoloView.tilt} stands
 * in for one — it drifts slowly while Mio is idle and swings
 * toward the direction of travel as it moves, which is what makes the
 * ring's colours flow when you throw the blob across the desk and
 * settle again when it stops.
 *
 * Three terms build it, all keyed on `d = dot( outward normal, tilt )`,
 * i.e. how squarely each patch of rim faces the rake:
 *
 *   - **Angle hue shift** — `d` displaces the hue, so opposite sides of
 *     the ring sit at opposite ends of the shift and the whole band
 *     re-sorts itself as the tilt turns.
 *   - **Diffraction grating** — two incommensurable harmonics of fine
 *     hue ripple around the perimeter. This is the detail that reads as
 *     "holographic" rather than "gradient".
 *   - **Specular glint** — a narrow, desaturating hotspot that slides
 *     along the rim as the tilt turns. {@link holoSpecular} exposes it
 *     separately so the renderer can push the crisp core stroke to
 *     white exactly where the glint is.
 *
 * Keeping the colour maths here — pure, no Pixi — means the palette is
 * unit-testable and a plugin can reuse it to match Mio's ring in
 * its own UI.
 */

/* eslint-disable no-bitwise -- Pixi takes colours as packed 24-bit
 * ints; shifting channels in and out is the native representation,
 * not a clever trick. */

import type { MioAppearance } from './types';

/**
 * HSL → packed 24-bit RGB.
 *
 * @param h Hue in degrees; wrapped, so -30 and 330 agree.
 * @param s Saturation, 0–1.
 * @param l Lightness, 0–1.
 */
export function hslToRgbInt( h: number, s: number, l: number ): number {
	const hue = ( ( h % 360 ) + 360 ) % 360;
	const sat = Math.min( 1, Math.max( 0, s ) );
	const lig = Math.min( 1, Math.max( 0, l ) );
	const c = ( 1 - Math.abs( 2 * lig - 1 ) ) * sat;
	const hp = hue / 60;
	const x = c * ( 1 - Math.abs( ( hp % 2 ) - 1 ) );
	let r = 0;
	let g = 0;
	let b = 0;
	if ( hp < 1 ) {
		r = c;
		g = x;
	} else if ( hp < 2 ) {
		r = x;
		g = c;
	} else if ( hp < 3 ) {
		g = c;
		b = x;
	} else if ( hp < 4 ) {
		g = x;
		b = c;
	} else if ( hp < 5 ) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}
	const m = lig - c / 2;
	const to8 = ( v: number ): number =>
		Math.min( 255, Math.max( 0, Math.round( ( v + m ) * 255 ) ) );
	return ( to8( r ) << 16 ) | ( to8( g ) << 8 ) | to8( b );
}

/**
 * Blend a packed colour toward white.
 *
 * The crisp core of the stroke is a desaturated, near-white version
 * of the bloom colour behind it — the way an over-exposed neon tube
 * photographs, and what the reference design shows at the top of the
 * ring.
 *
 * @param rgb    Packed 24-bit source colour.
 * @param amount 0 keeps the colour, 1 returns pure white.
 */
export function lighten( rgb: number, amount: number ): number {
	const t = Math.min( 1, Math.max( 0, amount ) );
	const r = ( rgb >> 16 ) & 0xff;
	const g = ( rgb >> 8 ) & 0xff;
	const b = rgb & 0xff;
	const mix = ( v: number ): number => Math.round( v + ( 255 - v ) * t );
	return ( mix( r ) << 16 ) | ( mix( g ) << 8 ) | mix( b );
}

/**
 * An outward unit normal, in the renderer's own `nx`/`ny` naming so a
 * ribbon sample can be handed straight to {@link chromaRing} without
 * copying a parallel array every frame.
 */
export interface HoloNormal {
	nx: number;
	ny: number;
}

/**
 * The hologram's viewing geometry for one frame.
 *
 * @public
 */
export interface HoloView {
	/**
	 * Outward unit normal of every sample around the rim, index-aligned
	 * with the requested colour count.
	 */
	normals: readonly HoloNormal[];
	/**
	 * Direction the virtual light rakes across the ring. Its
	 * **magnitude** is the effect strength, `0` (no hologram) to `1`
	 * (full swing), so a still Mio shimmers gently and a thrown one
	 * flares.
	 */
	tilt: { x: number; y: number };
}

/**
 * How far the viewing angle can displace the hue, in degrees.
 *
 * Wide enough that the two sides of the ring are visibly different
 * colours rather than two shades of the same one — under that, the
 * effect is only legible in a screenshot diff.
 */
const HOLO_HUE_SWING = 82;
/** How far the diffraction grating can displace the hue, in degrees. */
const HOLO_GRATING_SWING = 36;
/** Tightness of the specular glint. Higher is a narrower hotspot. */
const HOLO_GLINT_EXPONENT = 6;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * The diffraction ripple at one point on the ring.
 *
 * Two harmonics at incommensurable rates: any single sine reads as a
 * regular scallop once it has gone round twice, which is exactly the
 * "printed gradient" look the grating exists to break.
 *
 * @param t     Position around the ring, 0–1.
 * @param phase Hue rotation in degrees.
 */
function grating( t: number, phase: number ): number {
	return (
		0.68 * Math.sin( t * TAU * 3 + phase * DEG * 2 ) +
		0.32 * Math.sin( t * TAU * 5 - phase * DEG * 1.3 )
	);
}

/**
 * How squarely sample `i` faces the rake, `-1` to `1`, scaled by the
 * tilt's own magnitude so a weak tilt is a weak effect everywhere.
 */
function rake( view: HoloView, i: number ): number {
	const n = view.normals[ i % view.normals.length ];
	if ( ! n ) {
		return 0;
	}
	return n.nx * view.tilt.x + n.ny * view.tilt.y;
}

/**
 * Build the per-sample colour ramp for one frame.
 *
 * Index `i` is the colour of the rim sample at `i / count` of the way
 * around the ring, walking from its crown. `phase` rotates the whole
 * ramp — the caller passes `appearance.hueDrift * elapsedSeconds`.
 *
 * Lightness is modulated across the sweep (brightest a third of the
 * way round, dimmest opposite it) so the ring reads as lit from one
 * side rather than uniformly emissive.
 *
 * Passing `view` layers the hologram on top; without it the result is
 * the plain chroma ramp, which is also what `appearance.iridescence`
 * of `0` produces.
 *
 * @param count      Number of samples — the rendered ring resolution.
 * @param phase      Hue rotation in degrees (`hueDrift × elapsed`).
 * @param appearance Mio appearance settings.
 * @param view       Optional hologram viewing geometry.
 * @param spin       Positional rotation of the ramp, in degrees
 *                   (`hueSpin × elapsed`). Turns the gradient around
 *                   the ring without touching the hues themselves.
 */
export function chromaRing(
	count: number,
	phase: number,
	appearance: MioAppearance,
	view?: HoloView,
	spin: number = 0,
): number[] {
	const n = Math.max( 1, Math.round( count ) );
	const holo = view ? Math.max( 0, appearance.iridescence ) : 0;
	const out: number[] = new Array( n );
	for ( let i = 0; i < n; i++ ) {
		const t = i / n;
		// A plain `hueStart + hueSpan · t` ramp does not meet itself:
		// it ends a whole span away from where it began, so the ring
		// carries a hard seam at the wrap. Rotating the ramp
		// (`hueDrift`) hides that by keeping the seam moving — which is
		// why it was invisible until the rotation was switched off.
		//
		// `hueLoop` walks the span out and back instead, so the two ends
		// of the ring are the same colour by construction and there is
		// nothing to hide.
		//
		// **It walks it on a raised cosine, not a triangle.** A triangle
		// wave closes the loop but only in *value*: its slope flips sign
		// the instant it turns, so both turning points carry a crease —
		// the hue runs one way, stops dead, and runs back. That crease is
		// the "it goes round and then the colour isn't seamless" tell,
		// and it is a seam in everything but name. `½ − ½·cos( 2πt )`
		// meets itself in value *and* rate: the sweep eases to a stop at
		// each extreme and eases away again, so the ring reads as one
		// continuous band with no beginning. It also spends longer near
		// the two end colours and crosses the middle faster, which is
		// what a three-stop gradient does anyway.
		//
		// `hueAngle` rotates where the ramp starts. It matters most with
		// `hueLoop`, whose two extremes are pinned to the ends of the
		// mirror — without it they would always sit at 3 and 9 o'clock,
		// and the official artwork's gradient runs on a shallow
		// diagonal.
		const shifted =
			( ( ( t - ( appearance.hueAngle + spin ) / 360 ) % 1 ) + 1 ) % 1;
		const ramp = appearance.hueLoop
			? 0.5 - 0.5 * Math.cos( shifted * TAU )
			: shifted;
		let hue = appearance.hueStart + appearance.hueSpan * ramp + phase;
		// Cosine hump peaking at t = 1/3 — the "lit side" of the ring.
		const lift = 0.5 + 0.5 * Math.cos( ( t - 1 / 3 ) * Math.PI * 2 );
		let lightness = appearance.lightness * ( 0.72 + 0.28 * lift );
		let saturation = appearance.saturation;

		if ( holo > 0 && view ) {
			const d = rake( view, i );
			const ripple = grating( t, phase );
			hue += holo * ( HOLO_HUE_SWING * d + HOLO_GRATING_SWING * ripple );
			// The glint blows out to white; the ripple only breathes.
			const glint = Math.pow( Math.max( 0, d ), HOLO_GLINT_EXPONENT );
			lightness += holo * ( 0.32 * glint + 0.07 * ripple );
			saturation *= 1 - Math.min( 1, holo ) * 0.45 * glint;
		}

		out[ i ] = hslToRgbInt( hue, saturation, lightness );
	}
	return out;
}

/**
 * The specular glint per sample, `0`–`1`.
 *
 * Same term {@link chromaRing} folds into its lightness, exposed on its
 * own so the renderer can drive anything else that should track the
 * hotspot — today, how far the crisp core stroke is pushed to white.
 *
 * @param count      Number of samples.
 * @param appearance Mio appearance settings.
 * @param view       Hologram viewing geometry.
 */
export function holoSpecular(
	count: number,
	appearance: MioAppearance,
	view: HoloView,
): number[] {
	const n = Math.max( 1, Math.round( count ) );
	const holo = Math.max( 0, Math.min( 1, appearance.iridescence ) );
	const out: number[] = new Array( n );
	for ( let i = 0; i < n; i++ ) {
		out[ i ] =
			holo * Math.pow( Math.max( 0, rake( view, i ) ), HOLO_GLINT_EXPONENT );
	}
	return out;
}
