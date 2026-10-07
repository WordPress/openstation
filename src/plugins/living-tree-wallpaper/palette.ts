import { hash32 } from './rng';

const BASE_HUE = 105;
const BASE_HUE_IDENTITY_SPREAD = 24;

function clamp01( v: number ): number {
	return Math.min( 1, Math.max( 0, v ) );
}

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

export function canopyHue( siteKey: string ): number {
	const identity = hash32( siteKey );
	return (
		BASE_HUE -
		BASE_HUE_IDENTITY_SPREAD / 2 +
		( identity % ( BASE_HUE_IDENTITY_SPREAD + 1 ) )
	);
}

export function leafColor( hue: number, health01: number, ageDays: number ): number {
	const health = clamp01( health01 );

	const effectiveHue = health >= 0.7 ? hue : 20 + ( hue - 20 ) * ( health / 0.7 );
	let s = 0.3 + 0.42 * health;
	let l = 0.32 + 0.18 * health;

	const dryness = clamp01( ( ageDays - 730 ) / 2920 );
	s *= 1 - 0.55 * dryness;
	l -= 0.06 * dryness;
	return hslToRgb( effectiveHue, clamp01( s ), clamp01( l ) );
}
