/**
 * OpenStation — the camera-shutter reveal.
 *
 * ## The mechanism
 *
 * Six equilateral triangles, apex at the centre, arranged like the
 * wedges of a board game's wheel: together they tile a hexagon that
 * covers the window. Each then slides **tangentially** — perpendicular
 * to its own bisector — all six in the same rotational sense.
 *
 * The whole behaviour falls out of that one choice, and it is worth
 * spelling out because it is what makes the effect simple:
 *
 * Two neighbouring wedges share an edge. Sliding wedge *i* offsets
 * that edge along its normal by `cos( 30° ) × d`; sliding wedge *i+1*
 * offsets the very same edge by `cos( 30° ) × d` as well, because its
 * own slide direction sits 60° away and the cosine is symmetric about
 * the normal. The two offsets are **equal**, so the wedges stay flush
 * against each other for the whole travel — they never gap and never
 * pile up.
 *
 * What does open is the middle. Every apex leaves the centre along a
 * different tangent, so the six of them spread onto a circle and a
 * hexagonal aperture grows between them, centred and uniform, its
 * inradius exactly `cos( 30° ) × d`. The seams, still joined, are now
 * offset chords rather than radii — the pinwheel a real shutter makes.
 *
 * ## Why SVG, and why translation only
 *
 * A lens iris has a **cyclic** overlap: every leaf over the next, the
 * last back under the first. Paint order is linear and cannot express
 * a cycle. Rendering the wedges as `<path>` elements sidesteps it
 * entirely — each carries its own stroke, so every seam draws itself
 * regardless of what sits on top, and a `<mask>` built from the same
 * paths keeps those strokes from bleeding into the aperture they form.
 *
 * Nothing restacks and nothing is re-clipped per frame: the animation
 * is one `translate` per wedge, which stays on the compositor and is
 * deterministic under any duration the user picks.
 */

import type { WindowRevealRenderContext, WindowRevealRendered } from './types';

/** Wedges in the mechanism. Six equilateral triangles make a hexagon. */
const WEDGES = 6;

/**
 * The SVG user space. A square viewBox stretched over the window body
 * with `preserveAspectRatio="none"`: the mechanism takes on the
 * window's aspect, which is the price of guaranteeing it covers a
 * rectangle of any shape. Coverage is not negotiable — a gap shows
 * page content before the reveal has started.
 */
const VIEW = 100;
const CENTRE = VIEW / 2;

/**
 * Circumradius of the closed hexagon, which for this construction is
 * also each triangle's side.
 *
 * Far larger than the window it covers. The wedges have to keep
 * covering everything outside the aperture for the whole travel, and
 * being oversized costs nothing — the viewBox clips the excess.
 */
const WEDGE_RADIUS = 200;

/**
 * How far each wedge slides, in viewBox units.
 *
 * The aperture's inradius is `cos( 30° ) × slide`, and it has to clear
 * the window's corners at ~70.71 for the reveal to finish with nothing
 * left covering the page: `cos( 30° ) × 90 ≈ 77.9`, with margin.
 */
const WEDGE_SLIDE = 90;

/**
 * Per-wedge tones, descending around the mechanism as if each lay in
 * the shade of the one before it.
 *
 * All six distinct, and deliberately not a symmetric "lit from above"
 * ramp: a mirrored ramp gives two pairs of wedges the same tone, and a
 * seam between two equal tones is invisible — that part of the
 * mechanism flattens into one region.
 */
const WEDGE_SHADES = [
	'#5c5c6d',
	'#525261',
	'#484855',
	'#3e3e49',
	'#34343d',
	'#2a2a31',
];

/** Seam colour. Darker than every wedge, so each edge reads. */
const SEAM_COLOR = '#101014';

/** Seam width, in device pixels — see `vector-effect` below. */
const SEAM_WIDTH = 1.25;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Monotonic id source, so two open windows never share a mask. */
let uid = 0;

/** Trim to three decimals — these strings are read in devtools. */
function round( n: number ): number {
	return Math.round( n * 1000 ) / 1000;
}

/**
 * Bearing of wedge `index`'s first vertex. The `- 90°` puts a vertex
 * straight up, which reads better than an edge straight up.
 *
 * @internal
 */
function wedgeBearing( index: number ): number {
	return ( index / WEDGES ) * Math.PI * 2 - Math.PI / 2;
}

/**
 * Unit vector along which wedge `index` slides: perpendicular to its
 * own bisector, so the wedge moves sideways rather than outward.
 *
 * @internal
 */
function slideVector( index: number ): { x: number; y: number } {
	const bisector = wedgeBearing( index ) + Math.PI / WEDGES;
	const tangent = bisector + Math.PI / 2;
	return { x: Math.cos( tangent ), y: Math.sin( tangent ) };
}

/**
 * The three corners of wedge `index` in its closed position: the
 * centre, and two points a full radius out, 60° apart.
 *
 * @internal
 */
function wedgeCorners( index: number ): [ number, number ][] {
	const a = wedgeBearing( index );
	const b = wedgeBearing( index + 1 );
	return [
		[ CENTRE, CENTRE ],
		[
			CENTRE + Math.cos( a ) * WEDGE_RADIUS,
			CENTRE + Math.sin( a ) * WEDGE_RADIUS,
		],
		[
			CENTRE + Math.cos( b ) * WEDGE_RADIUS,
			CENTRE + Math.sin( b ) * WEDGE_RADIUS,
		],
	];
}

/**
 * Whether wedge `index` covers the point `( x, y )` at openness `t`.
 *
 * Exported for tests only, and computed rather than read back off the
 * DOM: the invariants worth asserting — full cover when closed, every
 * corner clear when open, an aperture that grows from the centre —
 * are geometric facts about the mechanism, not facts about markup.
 *
 * @internal
 */
export function _obturatorCoversForTests(
	index: number,
	t: number,
	x: number,
	y: number,
): boolean {
	const slide = slideVector( index );
	const dx = slide.x * WEDGE_SLIDE * t;
	const dy = slide.y * WEDGE_SLIDE * t;
	const [ p0, p1, p2 ] = wedgeCorners( index ).map(
		( [ cx, cy ] ) => [ cx + dx, cy + dy ] as [ number, number ],
	);

	// Same-side test. A point is in the triangle when it sits on the
	// same side of all three edges.
	//
	// The tolerance is load-bearing, not defensive rounding: two wedges
	// SHARE an edge, so every point along a seam is genuinely on the
	// boundary of both. Testing against exact zero puts those points in
	// neither — the ray straight up out of the centre, for one — and
	// the mechanism would report a hairline gap where it is in fact
	// flush. Cross products here run to ~1e4, so 1e-6 is far above the
	// floating-point noise and far below anything real.
	const EPSILON = 1e-6;
	const side = (
		a: [ number, number ],
		b: [ number, number ],
	): number =>
		( b[ 0 ] - a[ 0 ] ) * ( y - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( x - a[ 0 ] );
	const s0 = side( p0, p1 );
	const s1 = side( p1, p2 );
	const s2 = side( p2, p0 );
	return (
		( s0 >= -EPSILON && s1 >= -EPSILON && s2 >= -EPSILON ) ||
		( s0 <= EPSILON && s1 <= EPSILON && s2 <= EPSILON )
	);
}

/**
 * Build one `<path>` for a wedge.
 *
 * Inside the mask a wedge is pure coverage — white, no stroke. Outside
 * it carries its own tone and seam.
 *
 * @internal
 */
function wedgeElement( index: number, masked: boolean ): SVGPathElement {
	const corners = wedgeCorners( index );
	const path = document.createElementNS( SVG_NS, 'path' );
	path.setAttribute(
		'd',
		`M ${ corners
			.map( ( [ x, y ] ) => `${ round( x ) } ${ round( y ) }` )
			.join( ' L ' ) } Z`,
	);
	if ( masked ) {
		path.setAttribute( 'fill', '#fff' );
	} else {
		path.setAttribute( 'fill', WEDGE_SHADES[ index % WEDGE_SHADES.length ] );
		path.setAttribute( 'stroke', SEAM_COLOR );
		path.setAttribute( 'stroke-width', String( SEAM_WIDTH ) );
		// The viewBox is stretched to the window's aspect, which would
		// stretch the seam with it — thick on one axis, a hairline on
		// the other. This keeps it constant in device pixels.
		path.setAttribute( 'vector-effect', 'non-scaling-stroke' );
		path.setAttribute( 'stroke-linejoin', 'round' );
	}
	return path;
}

/**
 * Render the camera-shutter reveal.
 *
 * Returns the covering element plus a `play` that slides every wedge
 * from closed to open. Wired up as the `render` of the `obturator`
 * reveal; see `WindowRevealDef.render`.
 *
 * @public
 */
export function renderObturator(): WindowRevealRendered {
	const maskId = `os-iris-${ ++uid }`;

	const svg = document.createElementNS( SVG_NS, 'svg' );
	svg.setAttribute( 'viewBox', `0 0 ${ VIEW } ${ VIEW }` );
	// Stretch rather than fit: the mechanism has to cover the window
	// whatever its proportions.
	svg.setAttribute( 'preserveAspectRatio', 'none' );
	svg.setAttribute( 'aria-hidden', 'true' );
	svg.style.width = '100%';
	svg.style.height = '100%';
	svg.style.display = 'block';

	// The mask is the wedges' union — it is what keeps each seam from
	// bleeding into the aperture the wedges form. The seam belongs to
	// the mechanism, not to the page showing through it.
	const defs = document.createElementNS( SVG_NS, 'defs' );
	const mask = document.createElementNS( SVG_NS, 'mask' );
	mask.setAttribute( 'id', maskId );
	const maskGroup = document.createElementNS( SVG_NS, 'g' );

	const group = document.createElementNS( SVG_NS, 'g' );
	group.setAttribute( 'mask', `url(#${ maskId })` );

	// Every wedge exists twice — once as coverage inside the mask, once
	// as the visible wedge — and both copies slide together, so the
	// mask tracks the mechanism exactly.
	const moving: { el: SVGPathElement; index: number }[] = [];
	for ( let i = 0; i < WEDGES; i++ ) {
		const inMask = wedgeElement( i, true );
		const visible = wedgeElement( i, false );
		maskGroup.appendChild( inMask );
		group.appendChild( visible );
		moving.push( { el: inMask, index: i }, { el: visible, index: i } );
	}

	mask.appendChild( maskGroup );
	defs.appendChild( mask );
	svg.appendChild( defs );
	svg.appendChild( group );

	const host = document.createElement( 'div' );
	host.appendChild( svg );

	return {
		element: host,
		play: ( ctx: WindowRevealRenderContext ): Animation[] =>
			moving.map( ( { el, index } ) => {
				const slide = slideVector( index );
				const dx = round( slide.x * WEDGE_SLIDE );
				const dy = round( slide.y * WEDGE_SLIDE );
				return el.animate(
					[
						{ transform: 'translate( 0px, 0px )' },
						{ transform: `translate( ${ dx }px, ${ dy }px )` },
					],
					{
						duration: ctx.duration,
						easing: ctx.easing,
						delay: ctx.delay,
						// `both` holds the mechanism shut through the
						// delay, so it does not ease open underneath the
						// spinner still fading out.
						fill: 'both',
					},
				);
			} ),
	};
}
