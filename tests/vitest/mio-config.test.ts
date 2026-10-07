import { describe, expect, test } from 'vitest';
import {
	chromaRing,
	holoSpecular,
	hslToRgbInt,
	lighten,
	type HoloView,
} from '../../src/mio/chroma';
import { MIO_DEFAULTS, sanitizeMioConfig } from '../../src/mio/config';

function hueOf( r: number, g: number, b: number ): number {
	const max = Math.max( r, g, b );
	const min = Math.min( r, g, b );
	const c = max - min;
	if ( 0 === c ) {
		return -1;
	}
	let h: number;
	if ( max === r ) {
		h = ( ( g - b ) / c ) % 6;
	} else if ( max === g ) {
		h = ( b - r ) / c + 2;
	} else {
		h = ( r - g ) / c + 4;
	}
	return ( ( h * 60 ) % 360 + 360 ) % 360;
}

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
		expect( chromaRing( 24, 0, MIO_DEFAULTS.appearance ) ).toHaveLength( 24 );
	} );

	test( 'sweeps hue around the ring', () => {
		const ring = chromaRing( 8, 0, MIO_DEFAULTS.appearance );
		expect( new Set( ring ).size ).toBeGreaterThan( 1 );
	} );

	test( 'phase rotates the ramp rather than recolouring it', () => {
		const app = { ...MIO_DEFAULTS.appearance, hueSpan: -360, lightness: 0.5 };
		const base = chromaRing( 8, 0, app );

		const wrapped = chromaRing( 8, -360, app );
		expect( wrapped ).toEqual( base );
	} );

	test( 'a zero-span ring is monochrome', () => {
		const flat = chromaRing( 6, 0, {
			...MIO_DEFAULTS.appearance,
			hueSpan: 0,

			lightness: 0.5,
		} );

		const hues = flat.map( ( rgb ) =>
			hueOf( ( rgb >> 16 ) & 0xff, ( rgb >> 8 ) & 0xff, rgb & 0xff ),
		);
		for ( const h of hues ) {

			expect( Math.abs( h - hues[ 0 ] ) ).toBeLessThan( 1 );
		}
	} );
} );

describe( 'the looping gradient', () => {

	function hues( ring: number[] ): number[] {
		return ring.map( ( rgb ) =>
			hueOf( ( rgb >> 16 ) & 0xff, ( rgb >> 8 ) & 0xff, rgb & 0xff ),
		);
	}

	function worstStep( ring: number[] ): number {
		const h = hues( ring );
		let worst = 0;
		for ( let i = 0; i < h.length; i++ ) {
			const a = h[ i ];
			const b = h[ ( i + 1 ) % h.length ];

			const d = Math.abs( ( ( a - b + 540 ) % 360 ) - 180 );
			worst = Math.max( worst, d );
		}
		return worst;
	}

	test( 'a straight ramp leaves a seam where the ring meets itself', () => {

		const straight = chromaRing( 64, 0, {
			...MIO_DEFAULTS.appearance,
			hueLoop: false,
			hueSpan: -79,
			iridescence: 0,
		} );
		expect( worstStep( straight ) ).toBeGreaterThan( 60 );
	} );

	test( 'looping removes it — every step is a small one', () => {
		const looped = chromaRing( 64, 0, {
			...MIO_DEFAULTS.appearance,
			hueLoop: true,
			hueSpan: -79,
			iridescence: 0,
		} );

		expect( worstStep( looped ) ).toBeLessThan( 6 );
	} );

	test( 'the shipped default is seamless', () => {
		expect( worstStep( chromaRing( 64, 0, MIO_DEFAULTS.appearance ) ) )
			.toBeLessThan( 6 );
	} );

	test( 'the loop is a mirror: both ends of the ring agree', () => {
		const ring = chromaRing( 64, 0, {
			...MIO_DEFAULTS.appearance,
			hueAngle: 0,
			iridescence: 0,
		} );

		const h = hues( ring );
		expect( Math.abs( h[ 0 ] - h[ h.length - 1 ] ) ).toBeLessThan( 6 );

		expect( Math.abs( h[ 0 ] - h[ 32 ] ) ).toBeCloseTo(
			Math.abs( MIO_DEFAULTS.appearance.hueSpan ),
			0,
		);
	} );

	test( 'the loop turns smoothly — no crease where the sweep reverses', () => {

		const n = 180;
		const h = hues(
			chromaRing( n, 0, {
				...MIO_DEFAULTS.appearance,
				hueLoop: true,
				hueSpan: -200,
				iridescence: 0,
			} ),
		);
		const step = ( i: number ): number => {
			const a = h[ i % n ];
			const b = h[ ( i + 1 ) % n ];

			return ( ( b - a + 540 ) % 360 ) - 180;
		};
		let worstBend = 0;
		let totalStep = 0;
		for ( let i = 0; i < n; i++ ) {
			worstBend = Math.max( worstBend, Math.abs( step( i + 1 ) - step( i ) ) );
			totalStep += Math.abs( step( i ) );
		}
		expect( worstBend ).toBeLessThan( totalStep / n );
	} );

	test( 'hueAngle rotates where the extremes land', () => {
		const base = { ...MIO_DEFAULTS.appearance, iridescence: 0 };
		const at0 = hues( chromaRing( 64, 0, { ...base, hueAngle: 0 } ) );
		const at90 = hues( chromaRing( 64, 0, { ...base, hueAngle: 90 } ) );

		expect( Math.abs( at90[ 16 ] - at0[ 0 ] ) ).toBeLessThan( 0.5 );
	} );

	test( 'a still ring is genuinely still', () => {

		const app = MIO_DEFAULTS.appearance;
		expect( app.hueDrift ).toBe( 0 );
		expect( chromaRing( 32, app.hueDrift * 12, app ) ).toEqual(
			chromaRing( 32, app.hueDrift * 900, app ),
		);
	} );
} );

describe( 'the hologram', () => {

	const HOLO = { ...MIO_DEFAULTS.appearance, iridescence: 0.85 };

	function view( n: number, tilt: { x: number; y: number } ): HoloView {
		const normals = [];
		for ( let i = 0; i < n; i++ ) {
			const a = ( i / n ) * Math.PI * 2;
			normals.push( { nx: Math.cos( a ), ny: Math.sin( a ) } );
		}
		return { normals, tilt };
	}

	test( 'no view is the plain chroma ramp', () => {
		const app = MIO_DEFAULTS.appearance;
		expect( chromaRing( 16, 0, app ) ).toEqual(
			chromaRing( 16, 0, app, undefined ),
		);
	} );

	test( 'zero iridescence opts out even with a view', () => {
		const app = { ...MIO_DEFAULTS.appearance, iridescence: 0 };
		expect( chromaRing( 16, 0, app, view( 16, { x: 1, y: 0 } ) ) ).toEqual(
			chromaRing( 16, 0, app ),
		);
	} );

	test( 'turning the rake recolours the ring', () => {
		const app = HOLO;
		const east = chromaRing( 24, 0, app, view( 24, { x: 1, y: 0 } ) );
		const north = chromaRing( 24, 0, app, view( 24, { x: 0, y: -1 } ) );

		expect( north ).not.toEqual( east );
	} );

	test( 'the glint tracks the rake and nothing else', () => {
		const app = HOLO;
		const spec = holoSpecular( 24, app, view( 24, { x: 1, y: 0 } ) );

		expect( spec[ 0 ] ).toBeGreaterThan( 0.5 );

		expect( spec[ 12 ] ).toBe( 0 );
		for ( const s of spec ) {
			expect( s ).toBeGreaterThanOrEqual( 0 );
			expect( s ).toBeLessThanOrEqual( 1 );
		}
	} );

	test( 'a weaker rake is a weaker effect everywhere', () => {
		const app = HOLO;
		const strong = holoSpecular( 24, app, view( 24, { x: 1, y: 0 } ) );
		const weak = holoSpecular( 24, app, view( 24, { x: 0.3, y: 0 } ) );
		expect( weak[ 0 ] ).toBeLessThan( strong[ 0 ] );
	} );
} );

describe( 'sanitizeMioConfig', () => {
	test( 'a missing config is the reference design', () => {
		expect( sanitizeMioConfig( undefined ) ).toEqual( MIO_DEFAULTS );
		expect( sanitizeMioConfig( null ) ).toEqual( MIO_DEFAULTS );
		expect( sanitizeMioConfig( 'nope' ) ).toEqual( MIO_DEFAULTS );
		expect( sanitizeMioConfig( [] ) ).toEqual( MIO_DEFAULTS );
	} );

	test( 'merges a partial override', () => {
		const out = sanitizeMioConfig( { appearance: { radius: 80 } } );
		expect( out.appearance.radius ).toBe( 80 );
		expect( out.appearance.hueStart ).toBe(
			MIO_DEFAULTS.appearance.hueStart,
		);
		expect( out.physics ).toEqual( MIO_DEFAULTS.physics );
	} );

	test( 'clamps hostile numbers instead of rejecting them', () => {
		const out = sanitizeMioConfig( {
			appearance: { radius: -400, glow: 999 },
			physics: { points: 100000, magnetStrength: -50, idleWobble: 9 },
		} );
		expect( out.appearance.radius ).toBe( 16 );
		expect( out.appearance.glow ).toBe( 20 );
		expect( out.physics.points ).toBe( 128 );
		expect( out.physics.magnetStrength ).toBe( 0 );
		expect( out.physics.idleWobble ).toBe( 0.4 );
	} );

	test( 'ignores non-numeric junk', () => {
		const out = sanitizeMioConfig( {
			appearance: { radius: 'huge', eyeScale: null },
			physics: { damping: {} },
		} as never );
		expect( out.appearance.radius ).toBe( MIO_DEFAULTS.appearance.radius );
		expect( out.appearance.eyeScale ).toBe(
			MIO_DEFAULTS.appearance.eyeScale,
		);
		expect( out.physics.damping ).toBe( MIO_DEFAULTS.physics.damping );
	} );

	test( 'accepts CSS hex colours as well as ints', () => {
		expect(
			sanitizeMioConfig( { appearance: { bodyColor: '#ff8800' } } as never )
				.appearance.bodyColor,
		).toBe( 0xff8800 );
		expect(
			sanitizeMioConfig( { appearance: { eyeColor: 'f0a' } } as never )
				.appearance.eyeColor,
		).toBe( 0xff00aa );
		expect(
			sanitizeMioConfig( { appearance: { eyeColor: 'not-a-colour' } } as never )
				.appearance.eyeColor,
		).toBe( MIO_DEFAULTS.appearance.eyeColor );
	} );

	test( 'the stretch limits can never cross', () => {

		for ( const attempt of [
			{ minStretch: 0.8, maxStretch: 0.4 },
			{ minStretch: 3, maxStretch: 1.2 },
			{ minStretch: 1, maxStretch: 1 },
		] ) {
			const out = sanitizeMioConfig( { physics: attempt } );
			expect( out.physics.minStretch ).toBeLessThanOrEqual(
				out.physics.maxStretch,
			);
		}
	} );

	test( 'stretch limits clamp into their own ranges', () => {
		const out = sanitizeMioConfig( {
			physics: { minStretch: -5, maxStretch: 99, limitIterations: 40 },
		} );
		expect( out.physics.minStretch ).toBe( 0.1 );
		expect( out.physics.maxStretch ).toBe( 4 );
		expect( out.physics.limitIterations ).toBe( 8 );
	} );

	test( 'rounds the rim resolution to an integer', () => {
		expect(
			sanitizeMioConfig( { physics: { points: 33.7 } } ).physics.points,
		).toBe( 34 );

		expect(
			sanitizeMioConfig( { physics: { shapeLobes: 3.4 } } ).physics
				.shapeLobes,
		).toBe( 3 );
		expect(
			sanitizeMioConfig( { physics: { shapeLobes: 99, shapeAmount: 9 } } )
				.physics,
		).toMatchObject( { shapeLobes: 8, shapeAmount: 1.4 } );
	} );

	test( 'layers over a caller-supplied base', () => {
		const base = sanitizeMioConfig( { appearance: { radius: 90 } } );
		const out = sanitizeMioConfig( { physics: { magnetStrength: 100 } }, base );
		expect( out.appearance.radius ).toBe( 90 );
		expect( out.physics.magnetStrength ).toBe( 100 );
	} );
} );
