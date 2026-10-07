import type { Container, Graphics } from 'pixi.js';
import { chromaRing, holoSpecular, lighten, type HoloView } from './chroma';
import type { Particle } from './environment';
import type { MioAppearance } from './types';

const RIBBON_SAMPLES = 144;

const CURVE_SMOOTHNESS = 0.85;

export interface RibbonSample {
	x: number;
	y: number;

	nx: number;
	ny: number;
}

export interface RenderFrame {

	rim: readonly Particle[];

	centre: { x: number; y: number };

	radius: number;

	elapsed: number;

	gaze: { x: number; y: number } | null;

	blink: number;

	faceTilt?: number;

	tilt: { x: number; y: number };
}

export interface MioLayers {
	root: Container;
	halo: Graphics;
	bloom: Graphics;
	body: Graphics;
	sheen: Graphics;
	liner: Graphics;
	core: Graphics;
	eyes: Graphics;
}

const GLOW_FALLOFF = 2;

const SHEEN_SHELLS: readonly { from: number; to: number; alpha: number }[] = [
	{ from: 0.07, to: 0.22, alpha: 0.34 },
	{ from: 0.22, to: 0.4, alpha: 0.24 },
	{ from: 0.4, to: 0.6, alpha: 0.15 },
	{ from: 0.6, to: 0.8, alpha: 0.08 },
	{ from: 0.8, to: 1, alpha: 0.035 },
];

function mid( a: Particle, b: Particle ): { x: number; y: number } {
	return { x: ( a.x + b.x ) / 2, y: ( a.y + b.y ) / 2 };
}

export function buildRibbon(
	rim: readonly Particle[],
	centre: { x: number; y: number },
	total: number = RIBBON_SAMPLES,
): RibbonSample[] {
	const out: RibbonSample[] = [];
	const n = rim.length;
	if ( n < 3 ) {
		return out;
	}
	const wanted = Math.max( 2, Math.ceil( Math.max( 1, total ) / n ) );
	const step = wanted % 2 === 0 ? wanted : wanted + 1;

	for ( let i = 0; i < n; i++ ) {
		const a = mid( rim[ ( i + n - 1 ) % n ], rim[ i ] );
		const c = rim[ i ];
		const b = mid( rim[ i ], rim[ ( i + 1 ) % n ] );
		for ( let k = 0; k < step; k++ ) {
			const u = k / step;
			const v = 1 - u;
			const x = v * v * a.x + 2 * u * v * c.x + u * u * b.x;
			const y = v * v * a.y + 2 * u * v * c.y + u * u * b.y;

			let tx = v * ( c.x - a.x ) + u * ( b.x - c.x );
			let ty = v * ( c.y - a.y ) + u * ( b.y - c.y );
			let len = Math.hypot( tx, ty );
			if ( len < 1e-6 ) {
				tx = x - centre.x;
				ty = y - centre.y;
				len = Math.hypot( tx, ty ) || 1;
				out.push( { x, y, nx: tx / len, ny: ty / len } );
				continue;
			}

			let nx = -ty / len;
			let ny = tx / len;
			if ( nx * ( x - centre.x ) + ny * ( y - centre.y ) < 0 ) {
				nx = -nx;
				ny = -ny;
			}
			out.push( { x, y, nx, ny } );
		}
	}
	return out;
}

interface Point {
	x: number;
	y: number;
}

function controlThrough( a: Point, m: Point, b: Point ): Point {
	return {
		x: 2 * m.x - ( a.x + b.x ) / 2,
		y: 2 * m.y - ( a.y + b.y ) / 2,
	};
}

function offset( s: RibbonSample, by: number ): Point {
	return { x: s.x + s.nx * by, y: s.y + s.ny * by };
}

function curvedCell(
	g: Graphics,
	outerA: Point,
	outerM: Point,
	outerB: Point,
	innerA: Point,
	innerM: Point,
	innerB: Point,
): void {
	const co = controlThrough( outerA, outerM, outerB );
	const ci = controlThrough( innerA, innerM, innerB );
	g.moveTo( outerA.x, outerA.y );
	g.quadraticCurveTo( co.x, co.y, outerB.x, outerB.y, CURVE_SMOOTHNESS );
	g.lineTo( innerB.x, innerB.y );
	g.quadraticCurveTo( ci.x, ci.y, innerA.x, innerA.y, CURVE_SMOOTHNESS );
	g.closePath();
}

export function fillBody(
	g: Graphics,
	rim: readonly Particle[],
	color: number,
	alpha: number,
): void {
	const n = rim.length;
	if ( n < 3 || alpha <= 0 ) {
		return;
	}
	const first = mid( rim[ n - 1 ], rim[ 0 ] );
	g.moveTo( first.x, first.y );
	for ( let i = 0; i < n; i++ ) {
		const control = rim[ i ];
		const next = mid( rim[ i ], rim[ ( i + 1 ) % n ] );
		g.quadraticCurveTo(
			control.x,
			control.y,
			next.x,
			next.y,
			CURVE_SMOOTHNESS,
		);
	}
	g.closePath();
	g.fill( { color, alpha } );
}

type Boundary = ( s: RibbonSample ) => Point;

function fillBandBetween(
	g: Graphics,
	samples: readonly RibbonSample[],
	colors: readonly number[],
	outer: Boundary,
	inner: Boundary,
	alpha: number,
	stride: number,
): void {
	const m = samples.length;
	const step = Math.max( 1, Math.round( stride ) );
	const half = step % 2 === 0 ? step / 2 : 0;
	for ( let i = 0; i < m; i += step ) {
		const a = samples[ i ];
		const b = samples[ ( i + step ) % m ];
		if ( half > 0 ) {
			const c = samples[ ( i + half ) % m ];
			curvedCell(
				g,
				outer( a ),
				outer( c ),
				outer( b ),
				inner( a ),
				inner( c ),
				inner( b ),
			);
		} else {
			const oa = outer( a );
			const ob = outer( b );
			const ia = inner( a );
			const ib = inner( b );
			g.poly( [ oa.x, oa.y, ob.x, ob.y, ib.x, ib.y, ia.x, ia.y ] );
		}
		g.fill( { color: colors[ i % colors.length ], alpha } );
	}
}

export function fillBand(
	g: Graphics,
	samples: readonly RibbonSample[],
	colors: readonly number[],
	outer: number,
	inner: number,
	alpha: number,
	stride: number = 2,
): void {
	if ( samples.length < 3 || alpha <= 0 || outer + inner <= 0 ) {
		return;
	}
	fillBandBetween(
		g,
		samples,
		colors,
		( s ) => offset( s, outer ),
		( s ) => offset( s, -inner ),
		alpha,
		stride,
	);
}

export function fillLiner(
	g: Graphics,
	samples: readonly RibbonSample[],
	color: number,
	width: number,
	outline: number,
	stride: number = 2,
): void {
	if ( width <= 0 ) {
		return;
	}
	fillBand(
		g,
		samples,
		[ color ],
		-outline * 0.5,
		outline * 0.5 + width,
		1,
		stride,
	);
}

export function fillGlow(
	g: Graphics,
	samples: readonly RibbonSample[],
	centre: Point,
	colors: readonly number[],
	reach: number,
	bleed: number,
	peak: number,
	maxShells: number,
	stride: number = 2,
): void {
	if ( samples.length < 3 || peak <= 0 || reach <= 0 ) {
		return;
	}

	let sum = 0;
	for ( const s of samples ) {
		sum += Math.hypot( s.x - centre.x, s.y - centre.y );
	}
	const mean = sum / samples.length;
	if ( ! ( mean > 1e-3 ) ) {
		return;
	}

	const dilate =
		( px: number ): Boundary =>
			( s ) => {
				const k = Math.max( 0, 1 + px / mean );
				return {
					x: centre.x + ( s.x - centre.x ) * k,
					y: centre.y + ( s.y - centre.y ) * k,
				};
			};

	const reachPx = reach * mean;
	const n = glowShells( reachPx, Math.max( 1, Math.round( maxShells ) ) );
	for ( let i = 0; i < n; i++ ) {
		const alpha = peak * Math.pow( 1 - ( i + 0.5 ) / n, GLOW_FALLOFF );
		fillBandBetween(
			g,
			samples,
			colors,
			dilate( ( ( i + 1 ) / n ) * reachPx ),

			dilate( i === 0 ? -bleed : ( i / n ) * reachPx ),
			alpha,
			stride,
		);
	}
}

function glowShells( reach: number, max: number ): number {
	return Math.max( 2, Math.min( max, Math.round( reach / 14 ) ) );
}

const GLOW_REACH = { halo: 0.16, bloom: 0.075 } as const;

function glowReach( glow: number ) {
	return {
		halo: GLOW_REACH.halo * glow,
		bloom: GLOW_REACH.bloom * glow,
	};
}

export function glowBlurStrength(
	radius: number,
	glow: number,
): { halo: number; bloom: number } {
	const reach = glowReach( glow );
	const spacing = ( ratio: number, max: number ): number => {
		const px = ratio * radius;
		return Math.max( 2, ( px / glowShells( px, max ) ) * 2 );
	};
	return {
		halo: spacing( reach.halo, HALO_SHELL_CAP ),
		bloom: spacing( reach.bloom, BLOOM_SHELL_CAP ),
	};
}

const HALO_SHELL_CAP = 10;

const BLOOM_SHELL_CAP = 5;

export function fillSheen(
	g: Graphics,
	samples: readonly RibbonSample[],
	centre: { x: number; y: number },
	colors: readonly number[],
	scale: number,
	stride: number = 6,
): void {
	const m = samples.length;
	if ( m < 3 || scale <= 0 ) {
		return;
	}
	const step = Math.max( 1, Math.round( stride ) );
	const half = step % 2 === 0 ? step / 2 : 0;
	const at = ( s: RibbonSample, t: number ): Point => ( {
		x: s.x + ( centre.x - s.x ) * t,
		y: s.y + ( centre.y - s.y ) * t,
	} );

	for ( const shell of SHEEN_SHELLS ) {
		for ( let i = 0; i < m; i += step ) {
			const a = samples[ i ];
			const b = samples[ ( i + step ) % m ];
			const c = half > 0 ? samples[ ( i + half ) % m ] : null;
			const outerA = at( a, shell.from );
			const outerB = at( b, shell.from );
			const innerA = shell.to >= 1 ? centre : at( a, shell.to );
			const innerB = shell.to >= 1 ? centre : at( b, shell.to );

			if ( c && shell.to >= 1 ) {
				const arc = controlThrough( outerA, at( c, shell.from ), outerB );
				g.moveTo( outerA.x, outerA.y );
				g.quadraticCurveTo(
					arc.x,
					arc.y,
					outerB.x,
					outerB.y,
					CURVE_SMOOTHNESS,
				);
				g.lineTo( centre.x, centre.y );
				g.closePath();
			} else if ( c ) {
				curvedCell(
					g,
					outerA,
					at( c, shell.from ),
					outerB,
					innerA,
					at( c, shell.to ),
					innerB,
				);
			} else if ( shell.to >= 1 ) {
				g.poly( [ outerA.x, outerA.y, outerB.x, outerB.y, centre.x, centre.y ] );
			} else {
				g.poly( [
					outerA.x,
					outerA.y,
					outerB.x,
					outerB.y,
					innerB.x,
					innerB.y,
					innerA.x,
					innerA.y,
				] );
			}
			g.fill( {
				color: colors[ i % colors.length ],
				alpha: shell.alpha * scale,
			} );
		}
	}
}

function rimBounds( rim: readonly Particle[] ): {
	width: number;
	height: number;
} {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for ( const p of rim ) {
		if ( p.x < minX ) {
			minX = p.x;
		}
		if ( p.x > maxX ) {
			maxX = p.x;
		}
		if ( p.y < minY ) {
			minY = p.y;
		}
		if ( p.y > maxY ) {
			maxY = p.y;
		}
	}
	return { width: maxX - minX, height: maxY - minY };
}

export function eyeLayout(
	frame: RenderFrame,
	appearance: MioAppearance,
): {
	left: { x: number; y: number };
	right: { x: number; y: number };
	width: number;
	height: number;
} {
	const r = frame.radius;
	const { width: bw, height: bh } = rimBounds( frame.rim );

	const squashX = 1 + 0.35 * ( bw / ( 2 * r ) - 1 );
	const squashY = 1 + 0.35 * ( bh / ( 2 * r ) - 1 );

	const height = r * appearance.eyeScale * clamp( squashY, 0.4, 1.6 );
	const width = height * 0.46;

	let gx = 0;
	let gy = 0;
	if ( frame.gaze ) {
		const dx = frame.gaze.x - frame.centre.x;
		const dy = frame.gaze.y - frame.centre.y;
		const dist = Math.hypot( dx, dy );
		if ( dist > 1e-3 ) {
			const reach = Math.min( 1, dist / ( r * 3 ) );
			gx = ( dx / dist ) * reach * r * 0.16;
			gy = ( dy / dist ) * reach * r * 0.13;
		}
	}

	const gap = r * 0.28 * clamp( squashX, 0.5, 1.6 );

	const cy = -r * 0.02 + gy;
	const tilt = frame.faceTilt ?? 0;
	const cos = Math.cos( tilt );
	const sin = Math.sin( tilt );
	const eye = ( x: number ) => ( {
		x: frame.centre.x + x * cos - cy * sin,
		y: frame.centre.y + x * sin + cy * cos,
	} );
	return {
		left: eye( -gap + gx ),
		right: eye( gap + gx ),
		width,
		height: height * ( 1 - clamp( frame.blink, 0, 1 ) * 0.94 ),
	};
}

function clamp( v: number, lo: number, hi: number ): number {
	return Math.min( hi, Math.max( lo, v ) );
}

export function drawMio(
	layers: MioLayers,
	frame: RenderFrame,
	appearance: MioAppearance,
): void {
	const { rim } = frame;
	if ( rim.length < 3 ) {
		return;
	}

	const samples = buildRibbon( rim, frame.centre );
	if ( samples.length < 3 ) {
		return;
	}

	const view: HoloView = {
		normals: samples,
		tilt: frame.tilt,
	};
	const spin = appearance.hueSpin * frame.elapsed;
	const colors = chromaRing(
		samples.length,
		appearance.hueDrift * frame.elapsed,
		appearance,
		view,
		spin,
	);

	const w = appearance.outlineWidth;

	const bleed = Math.max( 1, w * 0.4 );

	const cells = ( count: number ): number => {
		const s = Math.max( 2, Math.round( samples.length / count ) );
		return s % 2 === 0 ? s : s + 1;
	};

	const fine = 2;
	const coarse = cells( 12 );

	const glow = appearance.glow;
	layers.halo.clear();
	layers.bloom.clear();
	if ( glow > 0 ) {
		const reach = glowReach( glow );
		fillGlow(
			layers.halo,
			samples,
			frame.centre,
			colors,
			reach.halo,
			bleed,
			0.2,
			HALO_SHELL_CAP,
			coarse,
		);
		fillGlow(
			layers.bloom,
			samples,
			frame.centre,
			colors,
			reach.bloom,
			bleed,
			0.4,
			BLOOM_SHELL_CAP,
			fine,
		);
	}

	layers.body.clear();
	fillBody( layers.body, rim, appearance.bodyColor, appearance.bodyAlpha );

	layers.sheen.clear();
	const sheen = Math.min( 1, Math.max( 0, appearance.iridescence ) );
	if ( sheen > 0 ) {
		fillSheen(
			layers.sheen,
			samples,
			frame.centre,
			chromaRing(
				samples.length,
				appearance.hueDrift * frame.elapsed * 0.6 + 140,
				appearance,
				{
					normals: samples,
					tilt: { x: -frame.tilt.y, y: frame.tilt.x },
				},
				spin,
			),
			sheen,
			cells( 8 ),
		);
	}

	layers.liner.clear();
	fillLiner(
		layers.liner,
		samples,
		appearance.linerColor,
		appearance.linerWidth,
		w,
		fine,
	);

	const glint = holoSpecular( samples.length, appearance, view );
	const coreColors = colors.map( ( c, i ) =>
		lighten( c, 0.3 + 0.45 * glint[ i ] ),
	);
	layers.core.clear();
	fillBand( layers.core, samples, coreColors, w * 0.5, w * 0.5, 1, fine );

	const eyes = eyeLayout( frame, appearance );
	layers.eyes.clear();
	if ( eyes.height > 0.5 ) {
		for ( const eye of [ eyes.left, eyes.right ] ) {
			layers.eyes.roundRect(
				eye.x - eyes.width / 2,
				eye.y - eyes.height / 2,
				eyes.width,
				eyes.height,
				Math.min( eyes.width, eyes.height ) / 2,
			);
		}
		layers.eyes.fill( { color: appearance.eyeColor, alpha: 1 } );
	}
}
