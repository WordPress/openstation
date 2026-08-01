/**
 * Desktop Mode — Mascot renderer.
 *
 * Draws one frame of the soft body as the reference design: a pure
 * black blob wrapped in a neon "chroma" ring, with two white pill
 * eyes that follow the pointer.
 *
 * **The ribbon.** Everything is built on one resampled outline. The
 * rim's `points` particles are a *simulation* resolution — far too
 * coarse to draw with directly — so {@link buildRibbon} runs the
 * standard Chaikin-style smoothing (quadratic curves through edge
 * midpoints, rim points as controls) and samples that curve
 * `SAMPLES_PER_SEGMENT` times per rim segment, carrying an outward
 * unit normal with every sample. The result is a dense, continuous
 * centreline that no longer has any idea how many mass points it came
 * from: the physics can be coarsened without the outline going
 * faceted, and the wobble reads as a rippling curve rather than a
 * shivering polygon.
 *
 * **Why bands, not strokes.** Each pass used to be stroked segment by
 * segment so every segment could carry its own colour. That is the only
 * way to run a hue ramp around a closed, deforming path — Pixi's
 * gradients are linear and radial — but it has a tell: consecutive
 * round-capped strokes *overlap* at every joint, and under the additive
 * blending the glow passes use, double coverage is double brightness.
 * The ring came out beaded, one visible knob per rim point, and the
 * outline read as a chain rather than a tube.
 *
 * So each pass is instead a **band**: one filled cell per pair of
 * samples, spanning outward from the centreline, with adjacent cells
 * sharing their edge coordinates *exactly*. Shared edges tile with
 * neither gap nor overlap, so there is nowhere for a bright joint to
 * form and the band is continuous by construction. Per-cell colour
 * keeps the chroma sweep, and gains the room for the hologram (see
 * `chroma.ts`) — per-sample normals are exactly what a viewing-angle
 * effect needs.
 *
 * **Every cell edge is a curve, not a chord.** A cell spans two ribbon
 * samples and bulges through the one between them, which is enough to
 * pin a quadratic ({@link controlThrough}); Pixi tessellates it
 * adaptively from there. Flat-sided cells were the last source of
 * visible facets in the ring — an offset boundary 15 px out from a
 * 12-point rim shows its corners plainly — and curving them costs
 * nothing, because the cells span the same arc they always did. The
 * body fill goes further and is traced from the rim's own curve
 * directly, so the silhouette has no facets at any rim resolution.
 *
 * Four passes, back to front:
 *
 *   1. `halo`  — very wide, very faint, additively blended and
 *      (optionally) blurred. This is the light spilling onto the
 *      wallpaper.
 *   2. `bloom` — medium width, additive. The bright fringe hugging
 *      the tube.
 *   3. `body`  — the black fill. Drawn AFTER the two glow passes on
 *      purpose: it masks their inner halves, which is what makes the
 *      inside of the mascot read as black instead of a muddy purple,
 *      exactly as in the reference art.
 *   3b. `sheen` — concentric shells of faint additive colour over that
 *      fill, so the interior catches the hologram the way a
 *      holographic film over dark card does: emphatically black, with
 *      just enough colour in it to say the surface is not painted.
 *   4. `core`  — a thin, near-white stroke. The over-exposed centre
 *      of the tube, pushed hardest to white wherever the hologram's
 *      glint is sitting this frame.
 *
 * Because the body fill masks the inner half of the glow anyway, the
 * two glow bands are built almost entirely *outward* from the
 * centreline — half the geometry, and no risk of their inner edges
 * crossing each other where the outline is concave.
 */

import type { Container, Graphics } from 'pixi.js';
import { chromaRing, holoSpecular, lighten, type HoloView } from './chroma';
import type { Particle } from './environment';
import type { MascotAppearance } from './types';

/**
 * Curve samples taken per rim segment.
 *
 * Four rather than two because a band cell now spans **two** samples
 * and uses the one in between as the point its edge curves through
 * (see {@link controlThrough}). Cells still span the same arc as
 * before, so the per-frame cell count is unchanged — the extra samples
 * buy curvature, not resolution.
 */
const SAMPLES_PER_SEGMENT = 4;

/**
 * Flatness tolerance handed to Pixi's adaptive curve tessellation,
 * `0`–`0.99`; higher subdivides further.
 *
 * Above the library default because the mascot is the one thing on the
 * desk a user looks *at*. The cells span 15–45° of arc, so the curves
 * are shallow and the adaptive pass emits only a handful of points
 * even at this tolerance.
 */
const CURVE_SMOOTHNESS = 0.85;

/** One point on the smoothed outline, with its outward normal. */
export interface RibbonSample {
	x: number;
	y: number;
	/** Outward unit normal. */
	nx: number;
	ny: number;
}

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
	/**
	 * Direction the hologram's virtual light rakes across the ring,
	 * magnitude `0`–`1` for strength. Steered by the mascot's motion —
	 * see `mascot.ts`.
	 */
	tilt: { x: number; y: number };
}

/** Pixi display objects the renderer owns. */
export interface MascotLayers {
	root: Container;
	halo: Graphics;
	bloom: Graphics;
	body: Graphics;
	sheen: Graphics;
	core: Graphics;
	eyes: Graphics;
}

/**
 * The interior sheen, as fractions of the way from the outline to the
 * centroid with the alpha each shell carries.
 *
 * Flat shells stand in for a radial falloff Pixi cannot give us without
 * minting a gradient texture every frame. They are adjacent, not
 * nested, so the brightest lift anywhere inside the body is the largest
 * alpha here — and that is the whole budget. The body still has to read
 * as black; the sheen is a film over it, not a paint job.
 *
 * **A flat shell against a flat shell is a hard edge**, and left alone
 * that reads as a set of concentric contour lines drawn inside the
 * mascot — which puts a ceiling on how bright the sheen can get before
 * the banding gives it away. The layer is blurred instead (see
 * `applySheenBlur` in `mascot.ts`), which dissolves both the radial
 * steps and the angular facets, and buys the alphas below the headroom
 * to actually be visible. That is also why the shells are coarse: five
 * of them, drawn every third sample. Nothing finer survives the blur.
 *
 * The outermost shell starts a little way in so the blur spends itself
 * on the interior rather than bleeding colour out over the ring.
 *
 * The innermost shell reaches the centroid, so it is a fan of triangles
 * rather than a band.
 */
const SHEEN_SHELLS: readonly { from: number; to: number; alpha: number }[] = [
	{ from: 0.07, to: 0.22, alpha: 0.34 },
	{ from: 0.22, to: 0.4, alpha: 0.24 },
	{ from: 0.4, to: 0.6, alpha: 0.15 },
	{ from: 0.6, to: 0.8, alpha: 0.08 },
	{ from: 0.8, to: 1, alpha: 0.035 },
];

/** Midpoint of two rim points. */
function mid( a: Particle, b: Particle ): { x: number; y: number } {
	return { x: ( a.x + b.x ) / 2, y: ( a.y + b.y ) / 2 };
}

/**
 * Resample the rim into a dense, smooth, normal-carrying outline.
 *
 * Segment `i` of the smoothing curve runs from `mid( i-1, i )` through
 * the control point `rim[ i ]` to `mid( i, i+1 )`, so the tangent — and
 * with it the normal — comes from the curve's own derivative rather
 * than from the chord between mass points. A degenerate tangent (two
 * coincident rim points) falls back to the radial direction, which is
 * always defined.
 *
 * @param rim      Rim points, in layer coordinates.
 * @param centre   Body centre, used to orient the normals outward.
 * @param centre.x Centre x, in layer coordinates.
 * @param centre.y Centre y, in layer coordinates.
 * @param per      Samples per rim segment.
 */
export function buildRibbon(
	rim: readonly Particle[],
	centre: { x: number; y: number },
	per: number = SAMPLES_PER_SEGMENT,
): RibbonSample[] {
	const out: RibbonSample[] = [];
	const n = rim.length;
	if ( n < 3 ) {
		return out;
	}
	const step = Math.max( 1, Math.round( per ) );

	for ( let i = 0; i < n; i++ ) {
		const a = mid( rim[ ( i + n - 1 ) % n ], rim[ i ] );
		const c = rim[ i ];
		const b = mid( rim[ i ], rim[ ( i + 1 ) % n ] );
		for ( let k = 0; k < step; k++ ) {
			const u = k / step;
			const v = 1 - u;
			const x = v * v * a.x + 2 * u * v * c.x + u * u * b.x;
			const y = v * v * a.y + 2 * u * v * c.y + u * u * b.y;
			// Quadratic Bézier derivative, up to the factor of 2.
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
			// Perpendicular, flipped to point away from the centre.
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

/** A plain 2D point. */
interface Point {
	x: number;
	y: number;
}

/**
 * The control point of the quadratic that starts at `a`, ends at `b`,
 * and passes exactly through `m` at its midpoint.
 *
 * A quadratic evaluates to `(a + 2c + b) / 4` at `t = 0.5`, so pinning
 * that to `m` gives `c = 2m − (a + b)/2`. This is what turns three
 * sampled points into a curve rather than two straight hops, and it is
 * how every band edge in this module stops being a chord.
 */
function controlThrough( a: Point, m: Point, b: Point ): Point {
	return {
		x: 2 * m.x - ( a.x + b.x ) / 2,
		y: 2 * m.y - ( a.y + b.y ) / 2,
	};
}

/** Offset a ribbon sample along its normal. Positive is outward. */
function offset( s: RibbonSample, by: number ): Point {
	return { x: s.x + s.nx * by, y: s.y + s.ny * by };
}

/**
 * Emit one closed band cell with curved outer and inner edges.
 *
 * `*A` → `*B` are the cell's corners and `*M` the point each edge
 * bulges through. The two radial edges stay straight: they are a few
 * pixels long and run between two rings that already agree on where
 * they meet.
 *
 * The control point is symmetric under reversal, so the inner edge —
 * traced backwards to close the path — reuses the same one.
 */
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

/**
 * Fill the body as one closed path of quadratic curves.
 *
 * Traced from the rim directly rather than from the ribbon, because
 * the rim *is* the curve: segment `i` runs from `mid( i-1, i )` through
 * the control point `rim[ i ]` to `mid( i, i+1 )`, which is exactly
 * what {@link buildRibbon} samples. Handing Pixi the curve instead of
 * the samples gives a silhouette with no facets at any rim resolution,
 * for one `fill()` and `points` curve segments — cheaper *and* smoother
 * than the polygon it replaces.
 */
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

/**
 * Draw one continuous band around the outline.
 *
 * Cell `i` spans from sample `i` to sample `i + stride`, `outer` pixels
 * out from the centreline and `inner` pixels in, and **curves through**
 * the sample halfway between the two. Consecutive cells are given
 * *identical* coordinates along the edge they share, which is what
 * makes the band continuous: there is no seam to show through and no
 * overlap to double up under additive blending.
 *
 * An odd `stride` has no halfway sample to curve through and falls back
 * to straight edges.
 *
 * @param g       Target graphics, already cleared.
 * @param samples Ribbon samples.
 * @param colors  One colour per sample, from `chromaRing`.
 * @param outer   Band reach outward from the centreline, in px.
 * @param inner   Band reach inward from the centreline, in px.
 * @param alpha   Fill alpha.
 * @param stride  Samples spanned per cell. Larger is fewer, wider cells.
 */
export function fillBand(
	g: Graphics,
	samples: readonly RibbonSample[],
	colors: readonly number[],
	outer: number,
	inner: number,
	alpha: number,
	stride: number = 2,
): void {
	const m = samples.length;
	if ( m < 3 || alpha <= 0 || outer + inner <= 0 ) {
		return;
	}
	const step = Math.max( 1, Math.round( stride ) );
	const half = step % 2 === 0 ? step / 2 : 0;
	for ( let i = 0; i < m; i += step ) {
		const a = samples[ i ];
		const b = samples[ ( i + step ) % m ];
		if ( half > 0 ) {
			const c = samples[ ( i + half ) % m ];
			curvedCell(
				g,
				offset( a, outer ),
				offset( c, outer ),
				offset( b, outer ),
				offset( a, -inner ),
				offset( c, -inner ),
				offset( b, -inner ),
			);
		} else {
			g.poly( [
				a.x + a.nx * outer,
				a.y + a.ny * outer,
				b.x + b.nx * outer,
				b.y + b.ny * outer,
				b.x - b.nx * inner,
				b.y - b.ny * inner,
				a.x - a.nx * inner,
				a.y - a.ny * inner,
			] );
		}
		g.fill( { color: colors[ i % colors.length ], alpha } );
	}
}

/**
 * Wash the inside of the body with a faint holographic sheen.
 *
 * Concentric shells marching from the outline to the centroid, each
 * flat-filled per sample and each fainter than the last, standing in
 * for the radial falloff a gradient would give if Pixi could produce
 * one without a texture per frame. Additive over the near-black fill,
 * so the body stays black and merely *catches* colour — the way a
 * holographic film over dark card does.
 *
 * Cells span the widest arcs in the renderer — the shells are diffuse,
 * so they are drawn coarse — which makes them the ones that most need
 * curved edges. Each arc bulges through the sample halfway along it,
 * lerped inward by the same amount as its ends.
 *
 * The innermost shell reaches the centroid, where the cell collapses to
 * a wedge: one curved arc closed by two straight radii.
 *
 * @param g        Target graphics, already cleared.
 * @param samples  Ribbon samples.
 * @param centre   Body centroid, in layer coordinates.
 * @param centre.x Centroid x, in layer coordinates.
 * @param centre.y Centroid y, in layer coordinates.
 * @param colors   One colour per sample.
 * @param scale    Overall strength, `0` draws nothing.
 * @param stride   Samples spanned per cell.
 */
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
				// Wedge: one curved arc closed by two straight radii.
				// Routing this through `curvedCell` would hand Pixi a
				// zero-length curve between three coincident points.
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

	// Eye separation, also squashed with the body. Close-set: the
	// reference face is two small pills near the middle, not a pair
	// pushed out toward the edges.
	const gap = r * 0.28 * clamp( squashX, 0.5, 1.6 );
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
 * Cheap enough to run every tick: six `Graphics.clear()` calls plus
 * one curved cell per pair of ribbon samples per band.
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

	const samples = buildRibbon( rim, frame.centre );
	if ( samples.length < 3 ) {
		return;
	}

	const view: HoloView = {
		normals: samples,
		tilt: frame.tilt,
	};
	const colors = chromaRing(
		samples.length,
		appearance.hueDrift * frame.elapsed,
		appearance,
		view,
	);

	const w = appearance.outlineWidth;
	// A sliver of inward reach on the glow bands so the body fill
	// overlaps them instead of meeting them exactly, which would leave
	// a hairline of wallpaper showing along the seam.
	const bleed = Math.max( 1, w * 0.4 );

	// 1 + 2 — glow passes. Widths scale with the core stroke so a
	// plugin thickening the outline gets a proportionally bigger
	// bloom instead of a thin line inside a fixed halo.
	const glow = appearance.glow;
	layers.halo.clear();
	layers.bloom.clear();
	if ( glow > 0 ) {
		// Alphas run a little above what the old stroked passes used:
		// those double-covered themselves at every joint, and taking the
		// overlap away takes some brightness with it.
		//
		// The halo is blurred and nearly transparent, so it is drawn at
		// half resolution — nothing about it survives to a pixel a
		// viewer could resolve.
		fillBand( layers.halo, samples, colors, w * 3 * glow, bleed, 0.12, 4 );
		fillBand( layers.bloom, samples, colors, w * 1.4 * glow, bleed, 0.32 );
	}

	// 3 — the black body, masking the inner half of the glow. Traced
	// from the rim rather than the ribbon: the rim IS the curve the
	// ribbon samples, so handing Pixi the curve itself gives a
	// facet-free silhouette for less work than the polygon did.
	layers.body.clear();
	fillBody( layers.body, rim, appearance.bodyColor, appearance.bodyAlpha );

	// 3b — the interior sheen. Its rake is the ring's, turned a quarter
	// turn, and its hue ramp runs at a different rate: an inside that
	// simply repeated the edge would read as a blurred copy of it
	// rather than as a second surface catching the same light.
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
			),
			sheen,
		);
	}

	// 4 — the crisp, over-exposed core of the tube. The hologram's
	// glint decides how far each patch is pushed toward white, so the
	// hotspot travels along the outline instead of the whole ring
	// sitting at one uniform exposure.
	const glint = holoSpecular( samples.length, appearance, view );
	const coreColors = colors.map( ( c, i ) =>
		lighten( c, 0.3 + 0.45 * glint[ i ] ),
	);
	layers.core.clear();
	fillBand( layers.core, samples, coreColors, w * 0.5, w * 0.5, 1, 2 );

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
