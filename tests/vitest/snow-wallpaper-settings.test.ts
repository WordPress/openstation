import { describe, expect, test } from 'vitest';
import {
	backdropCss,
	sanitizeSnowSettings,
	SNOW_DEFAULTS,
	SNOW_LIMITS,
} from '../../src/plugins/snow-wallpaper/settings';

describe( 'sanitizeSnowSettings', () => {
	test( 'empty / missing input falls back to defaults', () => {
		expect( sanitizeSnowSettings( undefined ) ).toEqual( SNOW_DEFAULTS );
		expect( sanitizeSnowSettings( {} ) ).toEqual( SNOW_DEFAULTS );
	} );

	test( 'keeps well-formed values', () => {
		expect(
			sanitizeSnowSettings( {
				wind: 40,
				particleCount: 900,
				flakeSize: 12,
				background: '#123ABC',
			} ),
		).toEqual( {
			wind: 40,
			particleCount: 900,
			flakeSize: 12,
			background: '#123abc',
		} );
	} );

	test( 'clamps out-of-range numbers into limits', () => {
		const clean = sanitizeSnowSettings( {
			wind: 9999,
			particleCount: 1,
			flakeSize: -4,
		} );
		expect( clean.wind ).toBe( SNOW_LIMITS.wind.max );
		expect( clean.particleCount ).toBe( SNOW_LIMITS.particleCount.min );
		expect( clean.flakeSize ).toBe( SNOW_LIMITS.flakeSize.min );
	} );

	test( 'drops malformed values back to defaults', () => {
		const clean = sanitizeSnowSettings( {
			wind: 'gusty',
			particleCount: NaN,
			flakeSize: null,
			background: 'not-a-color',
		} );
		expect( clean ).toEqual( SNOW_DEFAULTS );
	} );

	test( 'rounds fractional particle counts', () => {
		expect( sanitizeSnowSettings( { particleCount: 500.6 } ).particleCount ).toBe( 501 );
	} );
} );

describe( 'backdropCss', () => {
	test( 'default background reproduces the canonical gradient exactly', () => {

		expect( backdropCss( SNOW_DEFAULTS.background ) ).toBe(
			'linear-gradient(180deg, #0c1a36 0%, #1d355e 55%, #425d8a 100%)',
		);
	} );

	test( 'derives lighter stops from a custom base', () => {
		const css = backdropCss( '#301a0c' );
		const stops = css.match( /#[0-9a-f]{6}/g );
		expect( css ).toMatch( /^linear-gradient\(180deg, #301a0c 0%, / );
		expect( stops ).toHaveLength( 3 );

		const luma = ( hex: string ): number =>
			parseInt( hex.slice( 1, 3 ), 16 ) +
			parseInt( hex.slice( 3, 5 ), 16 ) +
			parseInt( hex.slice( 5, 7 ), 16 );
		const [ base, mid, bottom ] = stops as string[];
		expect( luma( mid ) ).toBeGreaterThan( luma( base ) );
		expect( luma( bottom ) ).toBeGreaterThan( luma( mid ) );
	} );

	test( 'extreme bases stay clamped and well-formed', () => {
		for ( const base of [ '#000000', '#ffffff', '#ff0000' ] ) {
			const css = backdropCss( base );
			expect( css.match( /#[0-9a-f]{6}/g ) ).toHaveLength( 3 );
		}
	} );
} );
