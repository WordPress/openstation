import type { MioAppearance } from './types';

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

export function lighten( rgb: number, amount: number ): number {
	const t = Math.min( 1, Math.max( 0, amount ) );
	const r = ( rgb >> 16 ) & 0xff;
	const g = ( rgb >> 8 ) & 0xff;
	const b = rgb & 0xff;
	const mix = ( v: number ): number => Math.round( v + ( 255 - v ) * t );
	return ( mix( r ) << 16 ) | ( mix( g ) << 8 ) | mix( b );
}

export interface HoloNormal {
	nx: number;
	ny: number;
}

export interface HoloView {

	normals: readonly HoloNormal[];

	tilt: { x: number; y: number };
}

const HOLO_HUE_SWING = 82;

const HOLO_GRATING_SWING = 36;

const HOLO_GLINT_EXPONENT = 6;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function grating( t: number, phase: number ): number {
	return (
		0.68 * Math.sin( t * TAU * 3 + phase * DEG * 2 ) +
		0.32 * Math.sin( t * TAU * 5 - phase * DEG * 1.3 )
	);
}

function rake( view: HoloView, i: number ): number {
	const n = view.normals[ i % view.normals.length ];
	if ( ! n ) {
		return 0;
	}
	return n.nx * view.tilt.x + n.ny * view.tilt.y;
}

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

		const shifted =
			( ( ( t - ( appearance.hueAngle + spin ) / 360 ) % 1 ) + 1 ) % 1;
		const ramp = appearance.hueLoop
			? 0.5 - 0.5 * Math.cos( shifted * TAU )
			: shifted;
		let hue = appearance.hueStart + appearance.hueSpan * ramp + phase;

		const lift = 0.5 + 0.5 * Math.cos( ( t - 1 / 3 ) * Math.PI * 2 );
		let lightness = appearance.lightness * ( 0.72 + 0.28 * lift );
		let saturation = appearance.saturation;

		if ( holo > 0 && view ) {
			const d = rake( view, i );
			const ripple = grating( t, phase );
			hue += holo * ( HOLO_HUE_SWING * d + HOLO_GRATING_SWING * ripple );

			const glint = Math.pow( Math.max( 0, d ), HOLO_GLINT_EXPONENT );
			lightness += holo * ( 0.32 * glint + 0.07 * ripple );
			saturation *= 1 - Math.min( 1, holo ) * 0.45 * glint;
		}

		out[ i ] = hslToRgbInt( hue, saturation, lightness );
	}
	return out;
}

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
