/**
 * Desktop Mode — Mascot renderer.
 *
 * Draws one frame of the soft body as the reference design: a pure
 * black blob wrapped in a neon "chroma" ring, with two white pill
 * eyes that follow the pointer.
 *
 * **How the neon is built.** Four stroked passes over the same
 * smoothed rim path, back to front:
 *
 *   1. `halo`  — very wide, very faint, additively blended and
 *      (optionally) blurred. This is the light spilling onto the
 *      wallpaper.
 *   2. `bloom` — medium width, additive. The bright fringe hugging
 *      the tube.
 *   3. `body`  — the black fill. Drawn AFTER the two glow passes on
 *      purpose: it masks their inner halves, which is what makes the
 *      inside of the mascot read as pure black instead of a muddy
 *      purple, exactly as in the reference art.
 *   4. `core`  — a thin, near-white stroke. The over-exposed centre
 *      of the tube.
 *
 * Every pass is stroked **segment by segment** so each one can carry
 * its own colour from {@link chromaRing}: that per-segment hue sweep
 * is the "chroma" in chroma ring. Pixi has gradient fills, but only
 * linear and radial ones — neither can run a hue ramp around a
 * closed, deforming path.
 *
 * The rim path itself is smoothed with quadratic curves through edge
 * midpoints (the standard Chaikin-style trick): rim points become
 * control points, so a 40-point polygon renders as a continuous
 * curve with no visible facets, and the soft-body wobble reads as a
 * rippling outline rather than a shivering polygon.
 */

import type { Container, Graphics } from 'pixi.js';
import { chromaRing, lighten } from './chroma';
import type { Particle } from './environment';
import type { MascotAppearance } from './types';

/** Everything one frame of drawing needs. */
export interface RenderFrame {
	/** Rim points, in layer coordinates. */
	rim: readonly Particle[];
	/** Body centre, in layer coordinates. */
	centre: { x: number; y: number };
	/** Rest radius, for eye scaling. */
	radius: number;
	/** Seconds since mount — drives the hue drift and the blink. */
	elapsed: number;
	/**
	 * Where the mascot is looking, in layer coordinates, or `null`
	 * when the pointer's position is unknown (cursor outside the
	 * document and no iframe reporting). The eyes recentre.
	 */
	gaze: { x: number; y: number } | null;
	/** 0 = eyes fully open, 1 = fully shut. */
	blink: number;
}

/** Pixi display objects the renderer owns. */
export interface MascotLayers {
	root: Container;
	halo: Graphics;
	bloom: Graphics;
	body: Graphics;
	core: Graphics;
	eyes: Graphics;
}

/** Midpoint of two rim points. */
function mid( a: Particle, b: Particle ): { x: number; y: number } {
	return { x: ( a.x + b.x ) / 2, y: ( a.y + b.y ) / 2 };
}

/**
 * Trace the smoothed rim into `g` as one closed path.
 *
 * Used for the fill. The stroked passes walk the same curve one
 * segment at a time — see {@link strokeChroma}.
 */
export function traceBody( g: Graphics, rim: readonly Particle[] ): void {
	const n = rim.length;
	if ( n < 3 ) {
		return;
	}
	const first = mid( rim[ n - 1 ], rim[ 0 ] );
	g.moveTo( first.x, first.y );
	for ( let i = 0; i < n; i++ ) {
		const control = rim[ i ];
		const next = mid( rim[ i ], rim[ ( i + 1 ) % n ] );
		g.quadraticCurveTo( control.x, control.y, next.x, next.y );
	}
	g.closePath();
}

/**
 * Stroke the rim segment by segment, each with its own colour.
 *
 * @param g      Target graphics, already cleared.
 * @param rim    Rim points.
 * @param colors One colour per segment, from {@link chromaRing}.
 * @param width  Stroke width.
 * @param alpha  Stroke alpha.
 */
function strokeChroma(
	g: Graphics,
	rim: readonly Particle[],
	colors: readonly number[],
	width: number,
	alpha: number,
): void {
	const n = rim.length;
	if ( n < 3 || width <= 0 || alpha <= 0 ) {
		return;
	}
	for ( let i = 0; i < n; i++ ) {
		const from = mid( rim[ ( i + n - 1 ) % n ], rim[ i ] );
		const to = mid( rim[ i ], rim[ ( i + 1 ) % n ] );
		g.moveTo( from.x, from.y );
		g.quadraticCurveTo( rim[ i ].x, rim[ i ].y, to.x, to.y );
		g.stroke( {
			color: colors[ i % colors.length ],
			width,
			alpha,
			cap: 'round',
			join: 'round',
		} );
	}
}

/** Axis-aligned extent of the rim. */
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

/**
 * Where the eyes sit and how they are deformed this frame.
 *
 * Split out of {@link drawMascot} because it is the one piece of the
 * renderer with behaviour worth asserting in a test: gaze clamping,
 * blink collapse, and squash inheritance.
 */
export function eyeLayout(
	frame: RenderFrame,
	appearance: MascotAppearance,
): {
	left: { x: number; y: number };
	right: { x: number; y: number };
	width: number;
	height: number;
} {
	const r = frame.radius;
	const { width: bw, height: bh } = rimBounds( frame.rim );

	// Inherit a fraction of the body's squash so the face deforms
	// with the blob instead of floating rigidly inside it.
	const squashX = 1 + 0.35 * ( bw / ( 2 * r ) - 1 );
	const squashY = 1 + 0.35 * ( bh / ( 2 * r ) - 1 );

	const height = r * appearance.eyeScale * clamp( squashY, 0.4, 1.6 );
	const width = height * 0.46;

	// Gaze: offset toward the pointer, clamped to an ellipse well
	// inside the body so the eyes can never slide off the face.
	let gx = 0;
	let gy = 0;
	if ( frame.gaze ) {
		const dx = frame.gaze.x - frame.centre.x;
		const dy = frame.gaze.y - frame.centre.y;
		const dist = Math.hypot( dx, dy );
		if ( dist > 1e-3 ) {
			// Saturating response: a pointer just outside the body
			// already produces most of the look; further away barely
			// changes it, the way real eyes work.
			const reach = Math.min( 1, dist / ( r * 3 ) );
			gx = ( dx / dist ) * reach * r * 0.16;
			gy = ( dy / dist ) * reach * r * 0.13;
		}
	}

	// Eye separation, also squashed with the body.
	const gap = r * 0.34 * clamp( squashX, 0.5, 1.6 );
	// Sit the pair slightly above the geometric centre — the
	// reference face reads as looking out, not down.
	const cy = frame.centre.y - r * 0.02 + gy;
	return {
		left: { x: frame.centre.x - gap + gx, y: cy },
		right: { x: frame.centre.x + gap + gx, y: cy },
		width,
		height: height * ( 1 - clamp( frame.blink, 0, 1 ) * 0.94 ),
	};
}

function clamp( v: number, lo: number, hi: number ): number {
	return Math.min( hi, Math.max( lo, v ) );
}

/**
 * Draw one frame into the supplied layers.
 *
 * Cheap enough to run every tick: five `Graphics.clear()` calls plus
 * ~4n short path segments for a 40-point rim.
 */
export function drawMascot(
	layers: MascotLayers,
	frame: RenderFrame,
	appearance: MascotAppearance,
): void {
	const { rim } = frame;
	if ( rim.length < 3 ) {
		return;
	}

	const colors = chromaRing(
		rim.length,
		appearance.hueDrift * frame.elapsed,
		appearance,
	);

	// 1 + 2 — glow passes. Widths scale with the core stroke so a
	// plugin thickening the outline gets a proportionally bigger
	// bloom instead of a thin line inside a fixed halo.
	const glow = appearance.glow;
	layers.halo.clear();
	layers.bloom.clear();
	if ( glow > 0 ) {
		strokeChroma(
			layers.halo,
			rim,
			colors,
			appearance.outlineWidth * 5.5 * glow,
			0.1,
		);
		strokeChroma(
			layers.bloom,
			rim,
			colors,
			appearance.outlineWidth * 2.4 * glow,
			0.28,
		);
	}

	// 3 — the black body, masking the inner half of the glow.
	layers.body.clear();
	traceBody( layers.body, rim );
	layers.body.fill( {
		color: appearance.bodyColor,
		alpha: appearance.bodyAlpha,
	} );

	// 4 — the crisp, over-exposed core of the tube.
	layers.core.clear();
	strokeChroma(
		layers.core,
		rim,
		colors.map( ( c ) => lighten( c, 0.45 ) ),
		appearance.outlineWidth,
		1,
	);

	// Face.
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
