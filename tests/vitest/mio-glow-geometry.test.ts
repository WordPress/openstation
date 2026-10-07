import { describe, expect, test } from 'vitest';
import {
	buildRibbon,
	fillGlow,
	glowBlurStrength,
	type RibbonSample,
} from '../../src/mio/render';

const TAU = Math.PI * 2;

function starDeviation( phase: number ): number {
	return 0.58 * ( Math.pow( Math.max( 0, Math.cos( 5 * phase ) ), 3 ) - 0.3125 );
}

const CENTRE = { x: 300, y: 300 };

function starSamples( radius = 56 ): RibbonSample[] {
	const rim = [];
	for ( let i = 0; i < 40; i++ ) {
		const a = ( i / 40 ) * TAU;
		const r = radius * ( 1 + starDeviation( a ) );
		rim.push( {
			x: CENTRE.x + Math.cos( a ) * r,
			y: CENTRE.y + Math.sin( a ) * r,
		} );
	}
	return buildRibbon( rim as never, CENTRE, 144 );
}

function foldedFraction(
	samples: readonly RibbonSample[],
	place: ( s: RibbonSample ) => { x: number; y: number },
): number {
	let bad = 0;
	for ( let i = 0; i < samples.length; i++ ) {
		const a = samples[ i ];
		const b = samples[ ( i + 1 ) % samples.length ];
		const pa = place( a );
		const pb = place( b );
		const dot =
			( b.x - a.x ) * ( pb.x - pa.x ) + ( b.y - a.y ) * ( pb.y - pa.y );
		if ( dot < 0 ) {
			bad++;
		}
	}
	return bad / samples.length;
}

const byNormal =
	( px: number ) =>
	( s: RibbonSample ) => ( { x: s.x + s.nx * px, y: s.y + s.ny * px } );

function byDilation( samples: readonly RibbonSample[], px: number ) {
	let sum = 0;
	for ( const s of samples ) {
		sum += Math.hypot( s.x - CENTRE.x, s.y - CENTRE.y );
	}
	const k = 1 + px / ( sum / samples.length );
	return ( s: RibbonSample ) => ( {
		x: CENTRE.x + ( s.x - CENTRE.x ) * k,
		y: CENTRE.y + ( s.y - CENTRE.y ) * k,
	} );
}

const SETTINGS = [
	{ w: 3, glow: 1 },
	{ w: 3, glow: 3 },
	{ w: 8, glow: 1 },
	{ w: 8, glow: 3 },
	{ w: 14, glow: 3 },
	{ w: 24, glow: 3 },
];

describe( 'Mio glow geometry', () => {
	test( 'a normal offset really does fold on the shipped star', () => {

		const samples = starSamples();
		expect( foldedFraction( samples, byNormal( 6 ) ) ).toBe( 0 );
		expect( foldedFraction( samples, byNormal( 42 ) ) ).toBeGreaterThan(
			0.2,
		);
	} );

	test( 'no glow-pass boundary folds, at any setting the panel allows', () => {
		const samples = starSamples();
		for ( const { w, glow } of SETTINGS ) {
			for ( const reach of [ w * 3 * glow, w * 1.4 * glow ] ) {
				expect(
					foldedFraction( samples, byDilation( samples, reach ) ),
					`reach ${ reach }px (outlineWidth ${ w }, glow ${ glow })`,
				).toBe( 0 );
			}
		}
	} );

	test( 'the inner bleed does not fold either', () => {

		const samples = starSamples();
		for ( const w of [ 3, 8, 14, 24 ] ) {
			const bleed = Math.max( 1, w * 0.4 );
			expect(
				foldedFraction( samples, byDilation( samples, -bleed ) ),
				`bleed ${ bleed }px`,
			).toBe( 0 );
		}
	} );

	test( 'a dilated boundary holds up on a squashed body too', () => {

		const samples = starSamples( 20 );
		expect(
			foldedFraction( samples, byDilation( samples, 24 * 3 * 3 ) ),
		).toBe( 0 );
	} );
} );

function recorder() {
	const alphas: number[] = [];
	const anchors: { outer: number[]; inner: number[] }[] = [];
	let pending: number[][] = [];
	const g = {
		moveTo: ( x: number, y: number ) => {
			pending = [ [ x, y ] ];
			return g;
		},
		quadraticCurveTo: ( _cx: number, _cy: number, x: number, y: number ) => {
			pending.push( [ x, y ] );
			return g;
		},
		lineTo: () => g,
		closePath: () => {

			anchors.push( {
				outer: pending[ 0 ] ?? [],
				inner: pending[ 2 ] ?? [],
			} );
			return g;
		},
		poly: () => g,
		fill: ( style: { alpha: number } ) => {
			alphas.push( style.alpha );
			return g;
		},
	};
	return { g, alphas, anchors };
}

describe( 'Mio glow falloff', () => {

	const SLIDER: { w: number; glow: number; radius: number }[] = [];
	for ( const w of [ 0.5, 3, 24 ] ) {
		for ( const glow of [ 0.1, 1, 6, 20 ] ) {
			for ( const radius of [ 16, 56, 220 ] ) {
				SLIDER.push( { w, glow, radius } );
			}
		}
	}

	function halo( w: number, glow: number, radius = 56 ) {
		const samples = starSamples( radius );
		const colors = samples.map( () => 0xffffff );
		const rec = recorder();
		fillGlow(
			rec.g as never,
			samples,
			CENTRE,
			colors,

			0.16 * glow,
			Math.max( 1, w * 0.4 ),
			0.2,
			10,
			12,
		);

		return [ ...new Set( rec.alphas ) ];
	}

	test( 'the ramp does not depend on the outline width', () => {

		for ( const glow of [ 0.1, 1, 6, 20 ] ) {
			const hairline = halo( 0.5, glow );
			for ( const w of [ 3, 8, 14, 24 ] ) {
				expect( halo( w, glow ), `glow=${ glow } w=${ w }` ).toEqual(
					hairline,
				);
			}
		}
	} );

	test( 'the wash reaches the same multiple of the body at every size', () => {

		function spread( reach: number, radius: number ): number {
			const samples = starSamples( radius );
			const colors = samples.map( () => 0xffffff );
			const rec = recorder();
			fillGlow( rec.g as never, samples, CENTRE, colors, reach, 1, 0.2, 10, 12 );
			const from = ( p: number[] ) =>
				Math.hypot( p[ 0 ] - CENTRE.x, p[ 1 ] - CENTRE.y );
			const mean =
				samples.reduce(
					( a, s ) => a + Math.hypot( s.x - CENTRE.x, s.y - CENTRE.y ),
					0,
				) / samples.length;
			return (
				rec.anchors.reduce( ( a, c ) => Math.max( a, from( c.outer ) ), 0 ) /
				mean
			);
		}

		for ( const reach of [ 0.16, 1, 3.2 ] ) {
			const reference = spread( reach, 56 );
			for ( const radius of [ 16, 220 ] ) {
				expect(
					spread( reach, radius ),
					`reach=${ reach } r=${ radius }`,
				).toBeCloseTo( reference, 6 );
			}

			expect( reference ).toBeGreaterThan( 1 );
		}
		expect( spread( 3.2, 56 ) ).toBeGreaterThan( spread( 0.16, 56 ) * 3 );
	} );

	test( 'the alpha falls monotonically, never flat', () => {

		for ( const { w, glow, radius } of SLIDER ) {
			const steps = halo( w, glow, radius );
			const at = `w=${ w } glow=${ glow } r=${ radius }`;
			expect( steps.length, at ).toBeGreaterThan( 1 );
			for ( let i = 1; i < steps.length; i++ ) {
				expect( steps[ i ], `${ at } step ${ i }` ).toBeLessThan(
					steps[ i - 1 ],
				);
			}
		}
	} );

	test( 'the ramp reaches its edge at nothing, at every setting', () => {

		for ( const { w, glow, radius } of SLIDER ) {
			const steps = halo( w, glow, radius );
			const faintest = steps[ steps.length - 1 ];
			expect(
				faintest,
				`w=${ w } glow=${ glow } r=${ radius } ends at ${ faintest }`,
			).toBeLessThanOrEqual( 0.2 / 8 );
		}
	} );

	test( 'shells tile exactly — no seam between steps', () => {

		const samples = starSamples();
		const colors = samples.map( () => 0xffffff );
		const rec = recorder();
		const stride = 12;

		fillGlow( rec.g as never, samples, CENTRE, colors, 2, 5, 0.2, 10, stride );

		const perShell = Math.ceil( samples.length / stride );
		const shells = rec.anchors.length / perShell;
		expect( Number.isInteger( shells ) ).toBe( true );
		expect( shells ).toBeGreaterThan( 2 );
		for ( let s = 1; s < shells; s++ ) {
			for ( let i = 0; i < perShell; i++ ) {
				const inner = rec.anchors[ s * perShell + i ].inner;
				const outer = rec.anchors[ ( s - 1 ) * perShell + i ].outer;
				expect( inner, `shell ${ s } cell ${ i }` ).toEqual( outer );
			}
		}
	} );

	test( 'the blur is sized off each pass, not off the outline', () => {

		const narrow = glowBlurStrength( 56, 1 );
		const wide = glowBlurStrength( 56, 20 );
		expect( wide.halo ).toBeGreaterThan( narrow.halo * 3 );

		expect( narrow.bloom ).toBeGreaterThan( 0 );
		expect( wide.bloom ).toBeGreaterThan( narrow.bloom * 3 );

		expect( glowBlurStrength( 220, 6 ).halo ).toBeGreaterThan(
			glowBlurStrength( 16, 6 ).halo,
		);

		expect( glowBlurStrength( 16, 0.1 ).halo ).toBeGreaterThanOrEqual( 2 );
	} );
} );
