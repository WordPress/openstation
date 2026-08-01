/**
 * Mascot configuration — the chroma palette maths and the sanitizer
 * that stands between an untrusted PHP/plugin config and the
 * simulation.
 */
import { describe, expect, test } from 'vitest';
import {
	chromaRing,
	holoSpecular,
	hslToRgbInt,
	lighten,
	type HoloView,
} from '../../src/mascot/chroma';
import { MASCOT_DEFAULTS, sanitizeMascotConfig } from '../../src/mascot/config';

describe( 'hslToRgbInt', () => {
	test( 'maps the primaries', () => {
		expect( hslToRgbInt( 0, 1, 0.5 ) ).toBe( 0xff0000 );
		expect( hslToRgbInt( 120, 1, 0.5 ) ).toBe( 0x00ff00 );
		expect( hslToRgbInt( 240, 1, 0.5 ) ).toBe( 0x0000ff );
		expect( hslToRgbInt( 300, 1, 0.5 ) ).toBe( 0xff00ff );
	} );

	test( 'wraps hue', () => {
		expect( hslToRgbInt( -60, 1, 0.5 ) ).toBe( hslToRgbInt( 300, 1, 0.5 ) );
		expect( hslToRgbInt( 480, 1, 0.5 ) ).toBe( hslToRgbInt( 120, 1, 0.5 ) );
	} );

	test( 'clamps saturation and lightness', () => {
		expect( hslToRgbInt( 200, 5, 2 ) ).toBe( 0xffffff );
		expect( hslToRgbInt( 200, -5, -2 ) ).toBe( 0x000000 );
	} );
} );

describe( 'lighten', () => {
	test( '0 is a no-op and 1 is white', () => {
		expect( lighten( 0x336699, 0 ) ).toBe( 0x336699 );
		expect( lighten( 0x336699, 1 ) ).toBe( 0xffffff );
	} );

	test( 'blends channel-wise', () => {
		expect( lighten( 0x000000, 0.5 ) ).toBe( 0x808080 );
	} );
} );

describe( 'chromaRing', () => {
	test( 'returns one colour per segment', () => {
		expect( chromaRing( 24, 0, MASCOT_DEFAULTS.appearance ) ).toHaveLength( 24 );
	} );

	test( 'sweeps hue around the ring', () => {
		const ring = chromaRing( 8, 0, MASCOT_DEFAULTS.appearance );
		expect( new Set( ring ).size ).toBeGreaterThan( 1 );
	} );

	test( 'phase rotates the ramp rather than recolouring it', () => {
		const app = { ...MASCOT_DEFAULTS.appearance, hueSpan: -360, lightness: 0.5 };
		const base = chromaRing( 8, 0, app );
		// One full span of phase brings the ramp back to itself.
		const wrapped = chromaRing( 8, -360, app );
		expect( wrapped ).toEqual( base );
	} );

	test( 'a zero-span ring is monochrome', () => {
		const flat = chromaRing( 6, 0, {
			...MASCOT_DEFAULTS.appearance,
			hueSpan: 0,
			// Kill the lit-side lightness hump so only hue is in play.
			lightness: 0.5,
		} );
		// Lightness still varies around the ring by design, so compare
		// hue families rather than exact values: every entry should be
		// some tint of the same magenta.
		for ( const rgb of flat ) {
			const r = ( rgb >> 16 ) & 0xff;
			const g = ( rgb >> 8 ) & 0xff;
			const b = rgb & 0xff;
			expect( g ).toBeLessThan( r );
			expect( g ).toBeLessThan( b );
		}
	} );
} );

describe( 'the hologram', () => {
	/** Outward normals of `n` evenly spaced samples on a circle. */
	function view( n: number, tilt: { x: number; y: number } ): HoloView {
		const normals = [];
		for ( let i = 0; i < n; i++ ) {
			const a = ( i / n ) * Math.PI * 2;
			normals.push( { nx: Math.cos( a ), ny: Math.sin( a ) } );
		}
		return { normals, tilt };
	}

	test( 'no view is the plain chroma ramp', () => {
		const app = MASCOT_DEFAULTS.appearance;
		expect( chromaRing( 16, 0, app ) ).toEqual(
			chromaRing( 16, 0, app, undefined ),
		);
	} );

	test( 'zero iridescence opts out even with a view', () => {
		const app = { ...MASCOT_DEFAULTS.appearance, iridescence: 0 };
		expect( chromaRing( 16, 0, app, view( 16, { x: 1, y: 0 } ) ) ).toEqual(
			chromaRing( 16, 0, app ),
		);
	} );

	test( 'turning the rake recolours the ring', () => {
		const app = MASCOT_DEFAULTS.appearance;
		const east = chromaRing( 24, 0, app, view( 24, { x: 1, y: 0 } ) );
		const north = chromaRing( 24, 0, app, view( 24, { x: 0, y: -1 } ) );
		// Same frame, same phase, same geometry — only the viewing angle
		// moved, and a hologram that doesn't answer that isn't one.
		expect( north ).not.toEqual( east );
	} );

	test( 'the glint tracks the rake and nothing else', () => {
		const app = MASCOT_DEFAULTS.appearance;
		const spec = holoSpecular( 24, app, view( 24, { x: 1, y: 0 } ) );
		// Sample 0 faces due east, straight into the rake.
		expect( spec[ 0 ] ).toBeGreaterThan( 0.5 );
		// The far side faces away, so it cannot glint at all.
		expect( spec[ 12 ] ).toBe( 0 );
		for ( const s of spec ) {
			expect( s ).toBeGreaterThanOrEqual( 0 );
			expect( s ).toBeLessThanOrEqual( 1 );
		}
	} );

	test( 'a weaker rake is a weaker effect everywhere', () => {
		const app = MASCOT_DEFAULTS.appearance;
		const strong = holoSpecular( 24, app, view( 24, { x: 1, y: 0 } ) );
		const weak = holoSpecular( 24, app, view( 24, { x: 0.3, y: 0 } ) );
		expect( weak[ 0 ] ).toBeLessThan( strong[ 0 ] );
	} );
} );

describe( 'sanitizeMascotConfig', () => {
	test( 'a missing config is the reference design', () => {
		expect( sanitizeMascotConfig( undefined ) ).toEqual( MASCOT_DEFAULTS );
		expect( sanitizeMascotConfig( null ) ).toEqual( MASCOT_DEFAULTS );
		expect( sanitizeMascotConfig( 'nope' ) ).toEqual( MASCOT_DEFAULTS );
		expect( sanitizeMascotConfig( [] ) ).toEqual( MASCOT_DEFAULTS );
	} );

	test( 'merges a partial override', () => {
		const out = sanitizeMascotConfig( { appearance: { radius: 80 } } );
		expect( out.appearance.radius ).toBe( 80 );
		expect( out.appearance.hueStart ).toBe(
			MASCOT_DEFAULTS.appearance.hueStart,
		);
		expect( out.physics ).toEqual( MASCOT_DEFAULTS.physics );
	} );

	test( 'clamps hostile numbers instead of rejecting them', () => {
		const out = sanitizeMascotConfig( {
			appearance: { radius: -400, glow: 999 },
			physics: { points: 100000, magnetStrength: -50, idleWobble: 9 },
		} );
		expect( out.appearance.radius ).toBe( 16 );
		expect( out.appearance.glow ).toBe( 3 );
		expect( out.physics.points ).toBe( 128 );
		expect( out.physics.magnetStrength ).toBe( 0 );
		expect( out.physics.idleWobble ).toBe( 0.4 );
	} );

	test( 'ignores non-numeric junk', () => {
		const out = sanitizeMascotConfig( {
			appearance: { radius: 'huge', eyeScale: null },
			physics: { damping: {} },
		} as never );
		expect( out.appearance.radius ).toBe( MASCOT_DEFAULTS.appearance.radius );
		expect( out.appearance.eyeScale ).toBe(
			MASCOT_DEFAULTS.appearance.eyeScale,
		);
		expect( out.physics.damping ).toBe( MASCOT_DEFAULTS.physics.damping );
	} );

	test( 'accepts CSS hex colours as well as ints', () => {
		expect(
			sanitizeMascotConfig( { appearance: { bodyColor: '#ff8800' } } as never )
				.appearance.bodyColor,
		).toBe( 0xff8800 );
		expect(
			sanitizeMascotConfig( { appearance: { eyeColor: 'f0a' } } as never )
				.appearance.eyeColor,
		).toBe( 0xff00aa );
		expect(
			sanitizeMascotConfig( { appearance: { eyeColor: 'not-a-colour' } } as never )
				.appearance.eyeColor,
		).toBe( MASCOT_DEFAULTS.appearance.eyeColor );
	} );

	test( 'the stretch limits can never cross', () => {
		// Unsatisfiable limits would make the relaxation pass
		// oscillate between the two bounds forever. The ranges are
		// disjoint around 1 — a floor is at most the rest length, a
		// ceiling at least it — so no input can invert them.
		for ( const attempt of [
			{ minStretch: 0.8, maxStretch: 0.4 },
			{ minStretch: 3, maxStretch: 1.2 },
			{ minStretch: 1, maxStretch: 1 },
		] ) {
			const out = sanitizeMascotConfig( { physics: attempt } );
			expect( out.physics.minStretch ).toBeLessThanOrEqual(
				out.physics.maxStretch,
			);
		}
	} );

	test( 'stretch limits clamp into their own ranges', () => {
		const out = sanitizeMascotConfig( {
			physics: { minStretch: -5, maxStretch: 99, limitIterations: 40 },
		} );
		expect( out.physics.minStretch ).toBe( 0.1 );
		expect( out.physics.maxStretch ).toBe( 4 );
		expect( out.physics.limitIterations ).toBe( 8 );
	} );

	test( 'rounds the rim resolution to an integer', () => {
		expect(
			sanitizeMascotConfig( { physics: { points: 33.7 } } ).physics.points,
		).toBe( 34 );
	} );

	test( 'layers over a caller-supplied base', () => {
		const base = sanitizeMascotConfig( { appearance: { radius: 90 } } );
		const out = sanitizeMascotConfig( { physics: { magnetStrength: 100 } }, base );
		expect( out.appearance.radius ).toBe( 90 );
		expect( out.physics.magnetStrength ).toBe( 100 );
	} );
} );
