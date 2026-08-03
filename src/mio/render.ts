/**
 * OpenStation — Mio renderer.
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
 * **How far a band reaches decides how it is built.** A band pushed a
 * few pixels off the centreline can offset along the outline's own
 * normals ({@link fillBand}). A band pushed a glow's distance cannot:
 * a normal offset folds inside-out the moment it exceeds the local
 * radius of curvature, which on the shipped `star` is 7 px. The two
 * glow passes are therefore *dilations* of the silhouette about the
 * body centre ({@link fillGlow}), a transform with no folding
 * distance at all. The tight `core` pass keeps the normal offset,
 * because a tube has to be an even width and a dilation's is not.
 *
 * **A glow also has to fall off.** Both glow passes are drawn as
 * concentric shells ramping from a peak at the outline to nothing at
 * their reach, the same device the interior sheen uses. One band at
 * one alpha is a slab with a cliff at its edge, which reads as a
 * coloured shape sitting behind Mio rather than as light coming off
 * her — and widening it only makes a bigger slab.
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
 *      inside of Mio read as black instead of a muddy purple,
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
import type { MioAppearance } from './types';

/**
 * How many points the outline is resampled to, regardless of how many
 * mass points the simulation runs.
 *
 * **This number is a colour resolution, not a geometric one.** Each
 * band cell carries one flat colour, so a cell is also one step of the
 * hue ramp — and at 24 cells the ring stops reading as a gradient and
 * starts reading as a colour wheel, in ~5° jumps the eye picks out
 * immediately at full saturation. At this density a cell spans a
 * degree or two of hue, which is below what anyone can separate.
 *
 * Geometrically it is overkill, and deliberately so: the curved cell
 * edges mean the outline was already smooth at a tenth of this. The
 * cells are correspondingly tiny, so their curves tessellate to two or
 * three points each and the extra cost is close to linear in the
 * count.
 *
 * Fixing the *total* rather than a per-segment multiplier decouples the
 * ring from `physics.points`: coarsening the simulation to nine mass
 * points no longer coarsens the gradient with it.
 */
const RIBBON_SAMPLES = 144;

/**
 * Flatness tolerance handed to Pixi's adaptive curve tessellation,
 * `0`–`0.99`; higher subdivides further.
 *
 * Above the library default because Mio is the one thing on the
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
	 * Where Mio is looking, in layer coordinates, or `null`
	 * when the pointer's position is unknown (cursor outside the
	 * document and no iframe reporting). The eyes recentre.
	 */
	gaze: { x: number; y: number } | null;
	/** 0 = eyes fully open, 1 = fully shut. */
	blink: number;
	/**
	 * Direction the hologram's virtual light rakes across the ring,
	 * magnitude `0`–`1` for strength. Steered by Mio's motion —
	 * see `mio.ts`.
	 */
	tilt: { x: number; y: number };
}

/** Pixi display objects the renderer owns. */
export interface MioLayers {
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
 * Mio — which puts a ceiling on how bright the sheen can get before
 * the banding gives it away. The layer is blurred instead (see
 * `applySheenBlur` in `mio.ts`), which dissolves both the radial
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
/**
 * Exponent on the glow's radial falloff.
 *
 * `1` is a linear ramp, which spreads the light evenly across the
 * whole reach and reads as a flat wash with a soft edge — the shape is
 * still legible, which is the thing a glow must not be. Squaring puts
 * most of the brightness in the first third and trails the rest away
 * to nothing, so what the eye finds is a bright rim fading out, with
 * no boundary anywhere.
 */
const GLOW_FALLOFF = 2;

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
 * The sample count is a *total*, not a per-segment multiplier, so the
 * ring keeps its resolution when the simulation is coarsened. It is
 * rounded up to a whole number of samples per rim segment and forced
 * even, because a band cell spans two samples and curves through the
 * one between them.
 *
 * @param rim      Rim points, in layer coordinates.
 * @param centre   Body centre, used to orient the normals outward.
 * @param centre.x Centre x, in layer coordinates.
 * @param centre.y Centre y, in layer coordinates.
 * @param total    Approximate number of samples around the whole ring.
 */
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
 * Where one edge of a band sits, for a given ribbon sample.
 *
 * The two boundaries a band is drawn between are supplied rather than
 * assumed, because the *right* way to push a boundary away from the
 * outline depends entirely on how far it is going. See
 * {@link fillBand} and {@link fillHalo}.
 */
type Boundary = ( s: RibbonSample ) => Point;

/**
 * Draw one continuous band between two boundaries around the outline.
 *
 * Cell `i` spans from sample `i` to sample `i + stride` and **curves
 * through** the sample halfway between the two. Consecutive cells are
 * given *identical* coordinates along the edge they share, which is
 * what makes the band continuous: there is no seam to show through and
 * no overlap to double up under additive blending.
 *
 * An odd `stride` has no halfway sample to curve through and falls back
 * to straight edges.
 */
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

/**
 * Draw a band a fixed number of pixels either side of the centreline.
 *
 * **Only safe while the reach stays small.** Both boundaries are the
 * outline offset along its own normals, and a normal offset folds over
 * itself as soon as it exceeds the local radius of curvature — the
 * neighbouring points on the inside of a bend cross over, and the cell
 * between them is emitted as a bowtie that fills as two triangles
 * meeting at the crossing. On a shape with real concavities (a star's
 * notches, the `blob` preset's dimple) that happens a few tens of
 * pixels out.
 *
 * That is fine for the passes that use it — `core` reaches `w * 0.5`
 * and `bloom` `w * 1.4`, both of which stay well inside the tightest
 * bend the silhouettes produce. The halo does not, and uses
 * {@link fillHalo} instead.
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

/**
 * Draw a glow pass: a wash of light spilling off the silhouette.
 *
 * **A glow is a dilated silhouette, not a fat outline.** Reaching a
 * glow's distance with {@link fillBand} does not produce a wide ring,
 * it produces a wreck. Measured against the shipped `star` at its
 * default radius, a normal offset starts folding at **7 px** — every
 * silhouette with a concavity has some bend tighter than that — and by
 * the widths these passes ask for, a quarter of the cells are
 * inside-out. Each one fills as a bowtie: two long thin triangles
 * meeting at the crossing, radiating out of the notch that produced
 * them. Blur does not repair it. Blurring an inverted cell gives a
 * soft spike.
 *
 * So a glow pass's boundaries are the outline **scaled about the
 * body's centre** rather than offset along its normals. Scaling is a
 * similarity transform: it cannot reorder the points, so the dilated
 * curve is simple at *any* factor and there is no reach at which the
 * band folds. Adjacent cells still share their edges exactly, so the
 * wash stays seamless, and the per-sample colour ramp is untouched.
 *
 * It is also the more faithful shape. A normal offset gives every part
 * of the outline the same reach; a dilation gives the parts that stick
 * out more reach than the parts that tuck in, which is what light
 * spilling off a shape actually does.
 *
 * **And it falls off.** One band at one alpha is a slab, however wide
 * and however well-shaped: flat right across, and then a cliff at the
 * outer boundary. That reads as a coloured shape *behind* Mio rather
 * than as light coming *off* her, and no blur fixes it either — a blur
 * of strength `s` softens the cliff over `s` pixels and leaves the
 * other two hundred flat. So the pass is drawn as concentric shells,
 * each fainter than the last, exactly as the interior sheen is
 * ({@link SHEEN_SHELLS}); the falloff curve is what makes it a glow.
 *
 * The alpha is taken at each shell's **midpoint** on a squared falloff,
 * so the outermost shell lands at a few thousandths and the wash
 * reaches its outer boundary already at nothing. There is no edge to
 * see because there is nothing left there to draw one with.
 *
 * **`reach` is a multiple of Mio's own radius, not a pixel count.**
 * That is what keeps the glow a property of the light rather than of
 * whatever the ring happens to be doing — and it makes the pass
 * scale-free, so the same look holds on a 16 px Mio and a 220 px one.
 * `bleed` stays in pixels, because it is not a glow measurement: it
 * exists so the body fill overlaps this pass's inner edge instead of
 * meeting it exactly, and how much overlap that takes is a fact about
 * the outline's thickness.
 *
 * @param g         Target graphics, already cleared.
 * @param samples   Ribbon samples.
 * @param centre    Body centre; the point the dilation is about.
 * @param colors    One colour per sample, from `chromaRing`.
 * @param reach     How far past the outline the wash carries, as a
 *                  multiple of the body radius.
 * @param bleed     How far inside the outline it starts, in px.
 * @param peak      Alpha at the outline, falling to nothing at `reach`.
 * @param maxShells Ceiling on the concentric steps the falloff is
 *                  drawn in; the actual count scales with the reach.
 * @param stride    Samples spanned per cell.
 */
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
	// The average distance from the centre to the outline. Measured
	// rather than taken from `appearance.radius` because the body
	// squashes, and a halo sized off the rest radius would breathe
	// out of step with the shape it is supposed to be lighting.
	let sum = 0;
	for ( const s of samples ) {
		sum += Math.hypot( s.x - centre.x, s.y - centre.y );
	}
	const mean = sum / samples.length;
	if ( ! ( mean > 1e-3 ) ) {
		return;
	}
	// Clamped at the centre: a bleed deeper than the body only happens
	// for an absurd outline width on a tiny Mio, and an inside-out
	// boundary would fold the same way a normal offset does.
	const dilate =
		( px: number ): Boundary =>
			( s ) => {
				const k = Math.max( 0, 1 + px / mean );
				return {
					x: centre.x + ( s.x - centre.x ) * k,
					y: centre.y + ( s.y - centre.y ) * k,
				};
			};

	// The reach in pixels, for this body at this moment. Shell spacing
	// is decided from it rather than from the ratio, because how fine
	// the ramp needs to be is a question about how many pixels it is
	// spread over — the same ratio on a 16 px Mio and a 220 px one are
	// not the same problem.
	const reachPx = reach * mean;
	const n = glowShells( reachPx, Math.max( 1, Math.round( maxShells ) ) );
	for ( let i = 0; i < n; i++ ) {
		// Every shell is drawn, including the last one or two that are
		// down in the thousandths. Dropping them saves a dozen cells
		// and costs the one thing the reach has to be, which is
		// honest: a wash that stops at nine tenths of what it was
		// asked for no longer scales with the body, because how many
		// shells got dropped depends on how many there were.
		const alpha = peak * Math.pow( 1 - ( i + 0.5 ) / n, GLOW_FALLOFF );
		fillBandBetween(
			g,
			samples,
			colors,
			dilate( ( ( i + 1 ) / n ) * reachPx ),
			// Only the innermost shell reaches back inside the outline;
			// the rest start where their neighbour stopped. Every shell
			// uses the same stride, so those shared boundaries are
			// computed identically and tile without a seam — the same
			// invariant that makes one band continuous.
			dilate( i === 0 ? -bleed : ( i / n ) * reachPx ),
			alpha,
			stride,
		);
	}
}

/**
 * How many shells a glow pass of a given reach is drawn in.
 *
 * A tight fringe does not need a ramp — two steps across four pixels
 * is already smoother than the display can show — and a wide wash
 * needs one badly. Roughly a step every 14 px, which is fine enough
 * that the blur (or, with the blur off, the eye) reads it as
 * continuous, then capped so the cell count cannot run away at the top
 * of the sliders.
 */
function glowShells( reach: number, max: number ): number {
	return Math.max( 2, Math.min( max, Math.round( reach / 14 ) ) );
}

/**
 * How far each glow pass carries per unit of `glow`, as a multiple of
 * the body's own radius.
 *
 * **The glow is a property of the light, not of the ring.** These used
 * to be multiples of `outlineWidth` — the reasoning being that a
 * thickened outline should not sit inside a halo scaled for a thin
 * one. In practice it made the two sliders multiply: thickening the
 * ring inflated the glow eightfold on its way from `0.5` to `24`, and
 * there was no way to ask for a fat ring with a tight glow, or a
 * hairline with a wide one. Sizing off the radius instead leaves each
 * slider meaning exactly one thing, and keeps the glow proportional to
 * Mio herself, which is the thing it is supposed to be coming off.
 *
 * The coefficients are the old defaults divided through by the shipped
 * radius, so a Mio at `glow: 1` on a default outline is unchanged.
 */
const GLOW_REACH = { halo: 0.16, bloom: 0.075 } as const;

/** Reach of each glow pass, as a multiple of the body radius. */
function glowReach( glow: number ) {
	return {
		halo: GLOW_REACH.halo * glow,
		bloom: GLOW_REACH.bloom * glow,
	};
}

/**
 * Blur strength for each glow pass, in pixels.
 *
 * **Sized off each pass's own reach, not off the outline width.** The
 * blur's job is to dissolve the steps between shells, and how far
 * apart those are is a property of the wash — so a halo reaching 216
 * px needs a wider blur than one reaching nine, whatever the ring
 * around it happens to be doing. Tying it to `outlineWidth` gave the
 * widest halo the same handful of pixels of softening as the
 * narrowest, which at that size is no softening at all.
 *
 * Twice the shell spacing: enough that consecutive steps overlap and
 * the ramp resolves as continuous.
 *
 * **The bloom is blurred too.** A flat shell against a flat shell is a
 * hard edge — the same thing that puts a ceiling on how bright the
 * interior sheen can get before its banding shows — and at the top of
 * the sliders the bloom is a hundred pixels wide in five steps. Left
 * crisp it draws five concentric contour rings inside the halo's
 * smooth one. The tube itself stays sharp regardless: that is `core`,
 * which is never filtered.
 *
 * Lives here rather than in `mio.ts` because both numbers are derived
 * from {@link glowShells}, and two places deciding how many shells
 * there are is how they come apart.
 */
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

/** Most shells the wide wash is drawn in. */
const HALO_SHELL_CAP = 10;

/**
 * Most shells the bright fringe is drawn in.
 *
 * Lower than the halo's, because this pass is drawn at the full colour
 * resolution and each of its shells costs six times a halo shell.
 */
const BLOOM_SHELL_CAP = 5;

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
 * Split out of {@link drawMio} because it is the one piece of the
 * renderer with behaviour worth asserting in a test: gaze clamping,
 * blink collapse, and squash inheritance.
 */
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
	// A sliver of inward reach on the glow bands so the body fill
	// overlaps them instead of meeting them exactly, which would leave
	// a hairline of wallpaper showing along the seam.
	const bleed = Math.max( 1, w * 0.4 );

	// Strides as a share of the live sample count rather than fixed
	// numbers, so the passes keep their relative resolution whatever
	// `points` and RIBBON_SAMPLES work out to.
	const cells = ( count: number ): number => {
		const s = Math.max( 2, Math.round( samples.length / count ) );
		return s % 2 === 0 ? s : s + 1;
	};
	// The crisp core and the bloom carry the gradient, so they run at
	// full resolution. The halo and the sheen are blurred to the point
	// that nothing finer than a dozen cells survives to a pixel.
	const fine = 2;
	const coarse = cells( 12 );

	// 1 + 2 — glow passes. Reach scales with Mio's radius and with
	// `glow` alone; see {@link GLOW_REACH} for why not with the
	// outline width.
	const glow = appearance.glow;
	layers.halo.clear();
	layers.bloom.clear();
	if ( glow > 0 ) {
		// Peaks run a little above what the old stroked passes used:
		// those double-covered themselves at every joint, and taking the
		// overlap away takes some brightness with it. They are peaks
		// now rather than flat alphas — each pass ramps from this at
		// the outline to nothing at its reach — so they also have to
		// carry the brightness the old flat fill spread across its
		// whole width.
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
				spin,
			),
			sheen,
			cells( 8 ),
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
	fillBand( layers.core, samples, coreColors, w * 0.5, w * 0.5, 1, fine );

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
