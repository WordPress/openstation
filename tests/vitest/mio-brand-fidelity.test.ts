/**
 * Mio's shipped colours are the brand's.
 *
 * Mio is the mascot, so its default look is not a taste decision that
 * happens to be in a config file — it is the same contract
 * `variables.css` has with the palette, expressed in HSL because the
 * ring is generated rather than declared.
 *
 * The source of truth is **Miomesh**, Mio's own gradient in the
 * OpenStation brand guidelines (`assets/miomesh.svg`, and the
 * `mioGrad` the mascot on that page is stroked with):
 *
 * ```xml
 * <linearGradient id="mioGrad" x1="0%" y1="10%" x2="90%" y2="100%">
 *   <stop offset="0%"   stop-color="#f252fc"/>
 *   <stop offset="48%"  stop-color="#aa67ff"/>
 *   <stop offset="71%"  stop-color="#a580ff"/>
 *   <stop offset="100%" stop-color="#4b3eff"/>
 * </linearGradient>
 * ```
 *
 * What had drifted, and why each one needed a test rather than a
 * comment:
 *
 *   - The endpoints were `#EF42E8 → #5E8BFF`, neither of which is a
 *     brand colour. The ring overshot Pulse by 6° into hotter magenta
 *     and ran 21° past `#4B3EFF` into a blue nothing in the palette
 *     reaches. Every *interior* colour was right, so a spot check of
 *     "is there magenta and blue in it" passed the whole time.
 *   - `hueAngle` put Pulse on the lower right. `mioGrad` starts on the
 *     upper left. The gradient ran backwards.
 *   - `lightness` was `0.66`, which is the ring's brightest point, not
 *     its average — so the ring rendered `0.475`–`0.661` against
 *     Miomesh's `0.622`–`0.751`. All of it darker than the darkest
 *     stop of the gradient it reproduces.
 *   - The eyes were `#ffffff` and the body `#000000`. Neither is in
 *     the palette; Starlight and Void are.
 *
 * The hue assertions run against `chromaRing` rather than against the
 * config values, because `hueStart` / `hueSpan` / `hueAngle` are
 * inputs to a raised-cosine mirror and it is the colours that come out
 * of it that have to match.
 */
import { describe, expect, test } from 'vitest';
import { chromaRing } from '../../src/mio/chroma';
import { MIO_DEFAULTS } from '../../src/mio/config';

/** The Miomesh stops, in gradient order. */
const MIOMESH = [
	{ name: 'Pulse #F252FC', rgb: 0xf252fc, hue: 296.5 },
	{ name: '#AA67FF', rgb: 0xaa67ff, hue: 266.4 },
	{ name: '#A580FF', rgb: 0xa580ff, hue: 257.5 },
	{ name: '#4B3EFF', rgb: 0x4b3eff, hue: 244.0 },
] as const;

/** Named palette colours Mio uses flat. */
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

/** The shipped ring, hologram off — the flat gradient Miomesh is. */
function ring( samples = 360 ): number[] {
	return chromaRing( samples, 0, MIO_DEFAULTS.appearance );
}

/**
 * Ribbon sample `i` sits at screen angle `(i / n) × 360` clockwise
 * from 3 o'clock: rim point `i` is at `cx + cos(a)·r, cy + sin(a)·r`,
 * and `y` grows downward.
 */
function hueAt( degrees: number ): number {
	const r = ring( 360 );
	return hsl( r[ ( ( degrees % 360 ) + 360 ) % 360 ] ).h;
}

describe( 'Mio wears the brand', () => {
	test( 'the ring sweeps exactly Miomesh, end to end', () => {
		const hues = ring().map( ( c ) => hsl( c ).h );
		const lo = Math.min( ...hues );
		const hi = Math.max( ...hues );

		// Pulse at one end, #4B3EFF at the other. Within a degree —
		// below what anyone can separate, and above the rounding in a
		// 24-bit round trip.
		expect( hi ).toBeCloseTo( MIOMESH[ 0 ].hue, 0 );
		expect( lo ).toBeCloseTo( MIOMESH[ 3 ].hue, 0 );
	} );

	test( 'and does not overshoot it at either end', () => {
		// The failure the endpoints had: every colour *inside* Miomesh
		// was present, so "is there magenta and blue" passed while the
		// ring ran into hues the palette does not contain.
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
		// `mioGrad` runs (0%,10%) → (90%,100%): its first stop is at the
		// upper left and its last at the lower right. The default used
		// to have this the other way round.
		expect( hueAt( 225 ) ).toBeCloseTo( MIOMESH[ 0 ].hue, 0 );
		expect( hueAt( 45 ) ).toBeCloseTo( MIOMESH[ 3 ].hue, 0 );
		// Which is to say: magenta on the left half, blue on the right.
		expect( hueAt( 180 ) ).toBeGreaterThan( hueAt( 0 ) );
	} );

	test( 'the ring is never darker than Miomesh at its brightest', () => {
		// `lightness` is the *brightest* point — `chromaRing` rides a
		// cosine hump from 0.72x to 1x over it — so the lit side of the
		// ring should reach the gradient's brightest stop.
		const brightest = Math.max( ...MIOMESH.map( ( s ) => hsl( s.rgb ).l ) );
		const lit = Math.max( ...ring().map( ( c ) => hsl( c ).l ) );
		expect( lit ).toBeCloseTo( brightest, 2 );
	} );

	test( 'saturation is full, as every Miomesh stop is', () => {
		const sats = ring().map( ( c ) => hsl( c ).s );
		expect( Math.min( ...sats ) ).toBeCloseTo( 1, 2 );
	} );

	test( 'the flat colours are named palette colours', () => {
		// Not `#000000` and `#ffffff`. Neither is in the palette; the
		// brand's own mascot draws its eyes in Starlight, and is drawn
		// over Void.
		expect( MIO_DEFAULTS.appearance.bodyColor ).toBe( VOID );
		expect( MIO_DEFAULTS.appearance.eyeColor ).toBe( STARLIGHT );
	} );

	test( 'the shipped look really is the flat gradient, not the hologram', () => {
		// Miomesh has no iridescence and no drift. If either shipped
		// on, the assertions above would be measuring a moving target
		// and would start passing or failing by frame.
		expect( MIO_DEFAULTS.appearance.iridescence ).toBe( 0 );
		expect( MIO_DEFAULTS.appearance.hueDrift ).toBe( 0 );
		expect( MIO_DEFAULTS.appearance.hueSpin ).toBe( 0 );
		// And the sweep closes on itself — Miomesh is a line, a ring is
		// not, and `hueLoop` is what reconciles them.
		expect( MIO_DEFAULTS.appearance.hueLoop ).toBe( true );
	} );
} );
