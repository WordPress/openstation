/**
 * Mio's glow passes never fold inside-out.
 *
 * **The bug this pins.** Both glow passes used to be drawn by
 * `fillBand`, which places a boundary by offsetting each ribbon sample
 * along its own outward normal. A normal offset is only simple while
 * it stays inside the local radius of curvature; past that, the points
 * on the inside of a bend cross over each other and the cell between
 * them is emitted as a bowtie, which fills as two long thin triangles
 * meeting at the crossing.
 *
 * On the shipped `star` at its default radius that happens at **7 px**,
 * and the glow passes ask for many times that — a quarter of the halo's
 * cells were inside-out at ordinary settings, and the spikes radiating
 * out of every notch were those triangles. Blur cannot repair it: a
 * blurred inverted cell is a soft spike.
 *
 * `fillGlowBand` dilates the silhouette about the body centre instead.
 * Scaling is a similarity transform, so the boundary stays simple at
 * any factor and there is no reach at which it folds.
 *
 * The test measures the geometry directly rather than trusting the
 * call site: it walks each boundary and asks whether consecutive
 * points still run the same way round the shape as the outline they
 * came from. A reversal is a fold.
 */
import { describe, expect, test } from 'vitest';
import {
	buildRibbon,
	fillGlow,
	glowBlurStrength,
	type RibbonSample,
} from '../../src/mio/render';

const TAU = Math.PI * 2;

/** The shipped `star` deviation, from `soft-body.ts`. */
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

/**
 * Fraction of steps along a boundary that run backwards relative to
 * the outline — i.e. the fraction of cells that fill as bowties.
 */
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

/** The boundary `fillBand` would place — offset along the normal. */
const byNormal =
	( px: number ) =>
	( s: RibbonSample ) => ( { x: s.x + s.nx * px, y: s.y + s.ny * px } );

/** The boundary `fillGlowBand` places — dilated about the centre. */
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

/** Every `(outlineWidth, glow)` pair the panel's sliders can produce. */
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
		// The premise. If this ever stops holding — a smoother star, a
		// denser ribbon — the dilation is no longer load-bearing and the
		// tests below are measuring nothing.
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
		// Dilating inward is the same transform with a factor below 1,
		// and is clamped at the centre so it can never invert.
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
		// The reach is derived from the *measured* mean radius, not the
		// rest radius, so a body mid-squash still gets a halo sized to
		// the shape it currently is.
		const samples = starSamples( 20 );
		expect(
			foldedFraction( samples, byDilation( samples, 24 * 3 * 3 ) ),
		).toBe( 0 );
	} );
} );

/**
 * Records the slice of `Graphics` a glow pass touches, keeping the
 * alpha of every fill and the anchors of every cell.
 */
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
			// moveTo(outerA) … curve→outerB, line→innerB, curve→innerA.
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
	// Everything the panel's sliders can reach, at the ends and through
	// the middle. `outlineWidth` is in here only to prove it no longer
	// moves the glow: reach is a multiple of the radius and a function
	// of `glow` alone, so the same `glow` at 0.5 px and 24 px of ring
	// has to produce the same ramp.
	const SLIDER: { w: number; glow: number; radius: number }[] = [];
	for ( const w of [ 0.5, 3, 24 ] ) {
		for ( const glow of [ 0.1, 1, 6, 20 ] ) {
			for ( const radius of [ 16, 56, 220 ] ) {
				SLIDER.push( { w, glow, radius } );
			}
		}
	}

	/** Draw one halo pass and hand back what Pixi would have been given. */
	function halo( w: number, glow: number, radius = 56 ) {
		const samples = starSamples( radius );
		const colors = samples.map( () => 0xffffff );
		const rec = recorder();
		fillGlow(
			rec.g as never,
			samples,
			CENTRE,
			colors,
			// `GLOW_REACH.halo` per unit glow — a multiple of the body
			// radius, with no `outlineWidth` in it.
			0.16 * glow,
			Math.max( 1, w * 0.4 ),
			0.2,
			10,
			12,
		);
		// One alpha per cell; every cell in a shell shares one.
		return [ ...new Set( rec.alphas ) ];
	}

	test( 'the ramp does not depend on the outline width', () => {
		// The bug this pins: the two sliders used to multiply. Reach was
		// a multiple of `outlineWidth`, so thickening the ring inflated
		// the glow eightfold on its way from 0.5 px to 24 px, and there
		// was no way to ask for a fat ring with a tight glow.
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
		// Reach is scale-free, so a 16 px Mio and a 220 px one wear the
		// same glow in proportion to themselves. Only the shell count
		// moves with size, because how fine the ramp has to be is a
		// question about pixels, not about proportion — which is why
		// this asserts the geometry rather than the alphas.
		/** How far the drawn wash gets, as a multiple of the body. */
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
			// And the reach itself is what moves it: more `glow`, more
			// spread, in proportion.
			expect( reference ).toBeGreaterThan( 1 );
		}
		expect( spread( 3.2, 56 ) ).toBeGreaterThan( spread( 0.16, 56 ) * 3 );
	} );

	test( 'the alpha falls monotonically, never flat', () => {
		// A single flat band is what the halo used to be, and it is the
		// whole defect: flat right across, then a cliff at the edge —
		// which reads as a coloured shape behind Mio rather than as
		// light coming off her.
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
		// The invariant that makes it a glow. A ramp truncated while
		// still visible has a cliff at the truncation, which is the
		// thing the falloff exists to remove — so the faintest shell
		// drawn has to be a small fraction of the peak, including where
		// `MIN_VISIBLE_ALPHA` cuts the tail short.
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
		// Each shell's inner boundary is its neighbour's outer one.
		// Computed independently, so this is the same anti-seam
		// invariant one band relies on: a mismatch is a hairline of
		// wallpaper showing through the middle of the glow.
		const samples = starSamples();
		const colors = samples.map( () => 0xffffff );
		const rec = recorder();
		const stride = 12;
		// Two radii of reach — enough to be drawn in many shells.
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
		// Tying it to `outlineWidth` gave the widest halo the same few
		// pixels of softening as the narrowest — no softening at all at
		// that size. It grows with the reach, and the reach is a
		// function of the radius and `glow`, so the signature no longer
		// has an outline width in it to get this wrong with.
		const narrow = glowBlurStrength( 56, 1 );
		const wide = glowBlurStrength( 56, 20 );
		expect( wide.halo ).toBeGreaterThan( narrow.halo * 3 );
		// Both passes are blurred: the bloom is a ramp too, and flat
		// shells left crisp draw contour rings inside the halo.
		expect( narrow.bloom ).toBeGreaterThan( 0 );
		expect( wide.bloom ).toBeGreaterThan( narrow.bloom * 3 );
		// A bigger Mio wears a proportionally bigger blur.
		expect( glowBlurStrength( 220, 6 ).halo ).toBeGreaterThan(
			glowBlurStrength( 16, 6 ).halo,
		);
		// Never zero, however tight the look.
		expect( glowBlurStrength( 16, 0.1 ).halo ).toBeGreaterThanOrEqual( 2 );
	} );
} );
