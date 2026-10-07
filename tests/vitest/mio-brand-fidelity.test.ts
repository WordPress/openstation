import { describe, expect, test } from 'vitest';
import { chromaRing } from '../../src/mio/chroma';
import { MIO_DEFAULTS } from '../../src/mio/config';

const MIOMESH = [
	{ name: 'Pulse #F252FC', rgb: 0xf252fc, hue: 296.5 },
	{ name: '#AA67FF', rgb: 0xaa67ff, hue: 266.4 },
	{ name: '#A580FF', rgb: 0xa580ff, hue: 257.5 },
	{ name: '#4B3EFF', rgb: 0x4b3eff, hue: 244.0 },
] as const;

const VOID = 0x0c0b0f;
const STARLIGHT = 0xfffbff;

function hsl( int: number ): { h: number; s: number; l: number } {
	const r = ( ( int >> 16 ) & 255 ) / 255;
	const g = ( ( int >> 8 ) & 255 ) / 255;
	const b = ( int & 255 ) / 255;
	const max = Math.max( r, g, b );
	const min = Math.min( r, g, b );
	const d = max - min;
	let h = 0;
	if ( d ) {
		if ( max === r ) {
			h = ( ( g - b ) / d ) % 6;
		} else if ( max === g ) {
			h = ( b - r ) / d + 2;
		} else {
			h = ( r - g ) / d + 4;
		}
		h *= 60;
		if ( h < 0 ) {
			h += 360;
		}
	}
	const l = ( max + min ) / 2;
	return { h, s: d ? d / ( 1 - Math.abs( 2 * l - 1 ) ) : 0, l };
}

function ring( samples = 360 ): number[] {
	return chromaRing( samples, 0, MIO_DEFAULTS.appearance );
}

function hueAt( degrees: number ): number {
	const r = ring( 360 );
	return hsl( r[ ( ( degrees % 360 ) + 360 ) % 360 ] ).h;
}

describe( 'Mio wears the brand', () => {
	test( 'the ring sweeps exactly Miomesh, end to end', () => {
		const hues = ring().map( ( c ) => hsl( c ).h );
		const lo = Math.min( ...hues );
		const hi = Math.max( ...hues );

		expect( hi ).toBeCloseTo( MIOMESH[ 0 ].hue, 0 );
		expect( lo ).toBeCloseTo( MIOMESH[ 3 ].hue, 0 );
	} );

	test( 'and does not overshoot it at either end', () => {

		const hues = ring().map( ( c ) => hsl( c ).h );
		for ( const h of hues ) {
			expect( h ).toBeLessThanOrEqual( MIOMESH[ 0 ].hue + 0.6 );
			expect( h ).toBeGreaterThanOrEqual( MIOMESH[ 3 ].hue - 0.6 );
		}
	} );

	test( 'every Miomesh stop appears somewhere on the ring', () => {
		const hues = ring().map( ( c ) => hsl( c ).h );
		for ( const stop of MIOMESH ) {
			const nearest = Math.min(
				...hues.map( ( h ) => Math.abs( h - stop.hue ) ),
			);
			expect( nearest, stop.name ).toBeLessThan( 1 );
		}
	} );

	test( 'Pulse sits on the upper-left shoulder, blue on the lower-right', () => {

		expect( hueAt( 225 ) ).toBeCloseTo( MIOMESH[ 0 ].hue, 0 );
		expect( hueAt( 45 ) ).toBeCloseTo( MIOMESH[ 3 ].hue, 0 );

		expect( hueAt( 180 ) ).toBeGreaterThan( hueAt( 0 ) );
	} );

	test( 'the ring is never darker than Miomesh at its brightest', () => {

		const brightest = Math.max( ...MIOMESH.map( ( s ) => hsl( s.rgb ).l ) );
		const lit = Math.max( ...ring().map( ( c ) => hsl( c ).l ) );
		expect( lit ).toBeCloseTo( brightest, 2 );
	} );

	test( 'saturation is full, as every Miomesh stop is', () => {
		const sats = ring().map( ( c ) => hsl( c ).s );
		expect( Math.min( ...sats ) ).toBeCloseTo( 1, 2 );
	} );

	test( 'the flat colours are named palette colours', () => {

		expect( MIO_DEFAULTS.appearance.bodyColor ).toBe( VOID );
		expect( MIO_DEFAULTS.appearance.eyeColor ).toBe( STARLIGHT );

		expect( MIO_DEFAULTS.appearance.linerColor ).toBe( STARLIGHT );
	} );

	test( 'and the inner line the artwork draws is really there', () => {

		expect( MIO_DEFAULTS.appearance.linerWidth ).toBeGreaterThan( 0 );
	} );

	test( 'the shipped look really is the flat gradient, not the hologram', () => {

		expect( MIO_DEFAULTS.appearance.iridescence ).toBe( 0 );
		expect( MIO_DEFAULTS.appearance.hueDrift ).toBe( 0 );
		expect( MIO_DEFAULTS.appearance.hueSpin ).toBe( 0 );

		expect( MIO_DEFAULTS.appearance.hueLoop ).toBe( true );
	} );
} );
