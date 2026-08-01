/**
 * Desktop Mode — Mascot chroma ring.
 *
 * The mascot's outline is not one colour: hue sweeps around the
 * perimeter (magenta at the crown, through violet, into blue at the
 * heel) and the whole sweep rotates slowly, which is what gives the
 * ring its "chroma" shimmer instead of reading as a flat neon tube.
 *
 * The renderer strokes the rim segment-by-segment, asking this
 * module for one colour per segment. Keeping the colour maths here —
 * pure, no Pixi — means the palette is unit-testable and a plugin can
 * reuse it to match the mascot's ring in its own UI.
 */

/* eslint-disable no-bitwise -- Pixi takes colours as packed 24-bit
 * ints; shifting channels in and out is the native representation,
 * not a clever trick. */

import type { MascotAppearance } from './types';

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
 * Build the per-segment colour ramp for one frame.
 *
 * Index `i` is the colour of the rim segment starting at rim point
 * `i`, walking the ring from its crown. `phase` rotates the whole
 * ramp — the caller passes `appearance.hueDrift * elapsedSeconds`.
 *
 * Lightness is modulated across the sweep (brightest a third of the
 * way round, dimmest opposite it) so the ring reads as lit from one
 * side rather than uniformly emissive.
 *
 * @param count      Number of segments — the rim resolution.
 * @param phase      Hue rotation in degrees.
 * @param appearance Mascot appearance settings.
 */
export function chromaRing(
	count: number,
	phase: number,
	appearance: MascotAppearance,
): number[] {
	const n = Math.max( 1, Math.round( count ) );
	const out: number[] = new Array( n );
	for ( let i = 0; i < n; i++ ) {
		const t = i / n;
		const hue = appearance.hueStart + appearance.hueSpan * t + phase;
		// Cosine hump peaking at t = 1/3 — the "lit side" of the ring.
		const lift = 0.5 + 0.5 * Math.cos( ( t - 1 / 3 ) * Math.PI * 2 );
		const lightness = appearance.lightness * ( 0.72 + 0.28 * lift );
		out[ i ] = hslToRgbInt( hue, appearance.saturation, lightness );
	}
	return out;
}
