/**
 * Desktop Mode — clip-path shape builders for window reveals.
 *
 * Pure string math, no DOM. Every builder returns a `clip-path` value
 * for the OPAQUE COVERING SURFACE, not for the content: a reveal is
 * expressed as "what is still covered", and the animation shrinks that
 * region to nothing.
 *
 * ## Why holes are wound backwards instead of using `evenodd`
 *
 * Several reveals (iris, curtain, blinds) need the surface to be a box
 * with a growing hole punched in it. `polygon()` describes a SINGLE
 * subpath, so a hole has to be bridged: trace the outer ring, return to
 * its first point, trace the hole, return to the outer ring's first
 * point again. Each bridge segment is then travelled twice in opposite
 * directions and contributes nothing.
 *
 * That leaves the fill rule. `polygon( evenodd, … )` would also work,
 * but the fill rule is part of the interpolation contract — two values
 * with different rules do not animate — and the keyword form has a
 * longer tail of engine quirks. Winding the hole rings COUNTER to the
 * outer ring makes the holes work under the default `nonzero` rule, so
 * every value we emit is a plain `polygon( … )` with nothing extra to
 * keep in sync between the two endpoints.
 *
 * ## Why the vertex count is fixed per reveal
 *
 * `polygon()` values only interpolate when they have the same number of
 * vertices. Each builder below takes the animated dimension as its only
 * argument and holds its ring structure constant, so calling it twice
 * always yields an interpolable pair. That is the invariant the whole
 * module exists to protect — see `shapes.test.ts`, which asserts it for
 * every built-in.
 */

/** A ring vertex in percentage units of the clipped box. */
export type RevealPoint = readonly [ number, number ];

/**
 * Outer ring: the full window body, wound clockwise in screen
 * coordinates (x right, y down). Every hole below is wound
 * counter-clockwise against it.
 *
 * @internal
 */
const OUTER: readonly RevealPoint[] = [
	[ 0, 0 ],
	[ 100, 0 ],
	[ 100, 100 ],
	[ 0, 100 ],
];

/**
 * Number of segments approximating the iris circle. 48 keeps the
 * polygon visually round at full-screen window sizes while staying far
 * below any value where the string length would matter.
 *
 * @internal
 */
const IRIS_SEGMENTS = 48;

/**
 * Iris radius (in % of each axis) at which the hole has certainly
 * cleared every corner. A corner sits at ~70.71% from the centre along
 * both axes; 80 leaves margin for the inscribed-polygon error.
 *
 * @internal
 */
const IRIS_MAX_RADIUS = 80;

/** Number of slats in the blinds reveal. @internal */
const BLIND_SLATS = 6;

/**
 * Number of slats in the vertical-slats reveal. Higher than the
 * horizontal count because windows are wider than they are tall, so
 * the same slat count would read as much coarser bands.
 *
 * @internal
 */
const VERTICAL_SLATS = 8;

/**
 * Blades in the camera-shutter aperture. Six is the count a real
 * mechanical iris most often has, and a hexagon reads as unmistakably
 * *mechanical* next to the smooth `iris` circle — which is the whole
 * reason both exist.
 *
 * @internal
 */
const OBTURATOR_BLADES = 6;

/**
 * Degrees the aperture rotates as it opens. A real iris's blades
 * pivot rather than simply sliding outward, and the twist is what
 * sells it; without it the shape is just a growing hexagon.
 *
 * @internal
 */
const OBTURATOR_SPIN_DEG = 32;

/** Mosaic grid — columns × rows of tiles that open together. @internal */
const MOSAIC_COLS = 4;
const MOSAIC_ROWS = 3;

/**
 * Number of arc vertices approximating the radar sweep's sector. The
 * sector spans up to a full turn, so the segments are coarser than the
 * iris circle's for the same count — 64 keeps the leading arc smooth
 * at the end of the sweep, where it is longest.
 *
 * @internal
 */
const RADAR_SEGMENTS = 64;

/**
 * Radius of the radar sector and the diamond, in % units. Both have
 * straight edges running out to a corner, so they need more reach than
 * the iris's circle: a diamond must satisfy `|dx| + |dy| >= 100` to
 * contain a corner, not `sqrt( dx² + dy² ) >= 70.71`.
 *
 * @internal
 */
const CORNER_REACH = 105;

/**
 * How far holes overshoot the box on the axis they span fully. Keeps
 * the hole edge off the outer ring's edge, where a coincident boundary
 * can leave a hairline of surface behind on fractional-pixel window
 * sizes.
 *
 * @internal
 */
const OVERSHOOT = 2;

/**
 * Format a percentage with at most three decimals and no trailing
 * zeros, so generated values stay readable in devtools.
 *
 * @internal
 */
function pct( n: number ): string {
	return `${ Math.round( n * 1000 ) / 1000 }%`;
}

/**
 * Reverse a ring's winding. Holes are authored in the natural
 * (clockwise) direction and flipped here, which reads better than
 * hand-writing every hole backwards.
 *
 * @internal
 */
function reverse( ring: readonly RevealPoint[] ): readonly RevealPoint[] {
	return ring.slice().reverse();
}

/**
 * An axis-aligned rectangle ring, clockwise in screen coordinates.
 *
 * @internal
 */
function rect( x0: number, y0: number, x1: number, y1: number ): readonly RevealPoint[] {
	return [
		[ x0, y0 ],
		[ x1, y0 ],
		[ x1, y1 ],
		[ x0, y1 ],
	];
}

/**
 * A circle approximated as a clockwise ring of `segments` vertices.
 *
 * Radius is applied in percentage units on BOTH axes, so the shape
 * follows the window's aspect ratio — an ellipse in a wide window. That
 * is deliberate: a true circle would open at wildly different speeds
 * horizontally and vertically depending on how the user sized the
 * window.
 *
 * @internal
 */
function circle(
	cx: number,
	cy: number,
	r: number,
	segments: number,
): readonly RevealPoint[] {
	const out: RevealPoint[] = [];
	for ( let i = 0; i < segments; i++ ) {
		const angle = ( i / segments ) * Math.PI * 2;
		out.push( [ cx + Math.cos( angle ) * r, cy + Math.sin( angle ) * r ] );
	}
	return out;
}

/**
 * Build a `polygon()` value from an outer ring plus zero or more hole
 * rings, bridging each hole back to the outer ring's first vertex so
 * the whole thing stays one subpath under the default `nonzero` fill
 * rule.
 *
 * Vertex count is `outer.length + 1 + sum( hole.length + 2 )` — a pure
 * function of the ring STRUCTURE, never of the coordinates, which is
 * what makes two calls with different dimensions interpolable.
 *
 * @param outer Outer ring, clockwise.
 * @param holes Hole rings, each already wound counter-clockwise.
 * @return A `clip-path`-ready `polygon( … )` value.
 */
export function polygonWithHoles(
	outer: readonly RevealPoint[],
	holes: readonly ( readonly RevealPoint[] )[] = [],
): string {
	const parts: string[] = [];
	const push = ( p: RevealPoint ): void => {
		parts.push( `${ pct( p[ 0 ] ) } ${ pct( p[ 1 ] ) }` );
	};

	for ( const p of outer ) {
		push( p );
	}
	if ( holes.length > 0 ) {
		// Close the outer ring explicitly — every bridge departs from
		// and returns to this vertex.
		push( outer[ 0 ] );
		for ( const hole of holes ) {
			for ( const p of hole ) {
				push( p );
			}
			push( hole[ 0 ] );
			push( outer[ 0 ] );
		}
	}

	return `polygon( ${ parts.join( ', ' ) } )`;
}

/**
 * Surface for the **iris** reveal: the full box with a circular hole of
 * radius `r` (in % units) at its centre.
 *
 * @param r Hole radius, 0 (fully covered) to {@link IRIS_MAX_RADIUS}.
 */
export function irisSurface( r: number ): string {
	return polygonWithHoles( OUTER, [
		reverse( circle( 50, 50, r, IRIS_SEGMENTS ) ),
	] );
}

/**
 * Surface for the **curtain** reveal: the full box with a full-height
 * hole of half-width `halfWidth` at its centre, so the surface reads as
 * two panels parting.
 *
 * @param halfWidth Half the hole's width, 0 (fully covered) to 52.
 */
export function curtainSurface( halfWidth: number ): string {
	return polygonWithHoles( OUTER, [
		reverse(
			rect( 50 - halfWidth, -OVERSHOOT, 50 + halfWidth, 100 + OVERSHOOT ),
		),
	] );
}

/**
 * Surface for the **blinds** reveal: the full box with
 * {@link BLIND_SLATS} full-width holes, each `height` tall and pinned
 * to the top of its band, so the surface reads as slats retracting
 * upward.
 *
 * @param height Hole height in % units, 0 (fully covered) to one band.
 */
export function blindsSurface( height: number ): string {
	const band = 100 / BLIND_SLATS;
	const holes: ( readonly RevealPoint[] )[] = [];
	for ( let i = 0; i < BLIND_SLATS; i++ ) {
		const top = i * band;
		holes.push(
			reverse(
				rect( -OVERSHOOT, top, 100 + OVERSHOOT, top + height ),
			),
		);
	}
	return polygonWithHoles( OUTER, holes );
}

/**
 * Surface for the **shutter** reveal: the full box with a full-width
 * hole of half-height `halfHeight` at its centre — the vertical mirror
 * of {@link curtainSurface}.
 *
 * @param halfHeight Half the hole's height, 0 (fully covered) to 52.
 */
export function shutterSurface( halfHeight: number ): string {
	return polygonWithHoles( OUTER, [
		reverse(
			rect( -OVERSHOOT, 50 - halfHeight, 100 + OVERSHOOT, 50 + halfHeight ),
		),
	] );
}

/**
 * Surface for the **slats** reveal: {@link VERTICAL_SLATS} full-height
 * holes, each `width` wide and pinned to the leading edge of its band —
 * the vertical mirror of {@link blindsSurface}.
 *
 * @param width Hole width in % units, 0 (fully covered) to one band.
 */
export function slatsSurface( width: number ): string {
	const band = 100 / VERTICAL_SLATS;
	const holes: ( readonly RevealPoint[] )[] = [];
	for ( let i = 0; i < VERTICAL_SLATS; i++ ) {
		const left = i * band;
		holes.push(
			reverse( rect( left, -OVERSHOOT, left + width, 100 + OVERSHOOT ) ),
		);
	}
	return polygonWithHoles( OUTER, holes );
}

/**
 * Surface for the **diamond** reveal: the full box with a rhombus hole
 * of radius `r` at its centre.
 *
 * @param r Hole radius along each axis, 0 to {@link CORNER_REACH}.
 */
export function diamondSurface( r: number ): string {
	return polygonWithHoles( OUTER, [
		reverse( [
			[ 50, 50 - r ],
			[ 50 + r, 50 ],
			[ 50, 50 + r ],
			[ 50 - r, 50 ],
		] ),
	] );
}

/**
 * Surface for the **mosaic** reveal: a
 * {@link MOSAIC_COLS} × {@link MOSAIC_ROWS} grid of rectangular holes,
 * each opening from the centre of its own cell so the content arrives
 * as tiles rather than as a single edge.
 *
 * @param scale Hole size as a fraction of its cell, 0 to slightly
 *              above 1 (so neighbouring tiles overlap at the end).
 */
export function mosaicSurface( scale: number ): string {
	const cellW = 100 / MOSAIC_COLS;
	const cellH = 100 / MOSAIC_ROWS;
	const holes: ( readonly RevealPoint[] )[] = [];
	for ( let row = 0; row < MOSAIC_ROWS; row++ ) {
		for ( let col = 0; col < MOSAIC_COLS; col++ ) {
			const cx = col * cellW + cellW / 2;
			const cy = row * cellH + cellH / 2;
			const halfW = ( cellW / 2 ) * scale;
			const halfH = ( cellH / 2 ) * scale;
			holes.push(
				reverse(
					rect( cx - halfW, cy - halfH, cx + halfW, cy + halfH ),
				),
			);
		}
	}
	return polygonWithHoles( OUTER, holes );
}

/**
 * Surface for the **radar** reveal: the full box with a circular
 * SECTOR hole opening clockwise from twelve o'clock, like a radar
 * sweep.
 *
 * The hole is the centre point plus {@link RADAR_SEGMENTS} arc
 * vertices. The vertex count is constant no matter the angle — at
 * `0` every arc vertex collapses onto the twelve-o'clock ray and the
 * sector has no area, which is what makes a zero-angle start
 * interpolable with a full-turn end.
 *
 * @param angleDeg Sector angle in degrees, 0 (fully covered) to 360.
 */
export function radarSurface( angleDeg: number ): string {
	const start = -Math.PI / 2; // twelve o'clock
	const sweep = ( angleDeg / 180 ) * Math.PI;
	const arc: RevealPoint[] = [ [ 50, 50 ] ];
	for ( let i = 0; i < RADAR_SEGMENTS; i++ ) {
		const angle = start + ( i / ( RADAR_SEGMENTS - 1 ) ) * sweep;
		arc.push( [
			50 + Math.cos( angle ) * CORNER_REACH,
			50 + Math.sin( angle ) * CORNER_REACH,
		] );
	}
	return polygonWithHoles( OUTER, [ reverse( arc ) ] );
}

/**
 * Surface for the **camera shutter** reveal: the full box with a
 * regular-polygon hole that both grows and rotates, like the blades of
 * a mechanical iris pivoting open.
 *
 * The hexagon's inscribed radius at full size is `cos( 30° ) × 105 ≈
 * 91%`, comfortably past the ~70.71% a corner sits at, so the aperture
 * clears the whole window rather than leaving wedges behind.
 *
 * @param t Openness, 0 (fully covered) to 1 (fully open).
 */
export function obturatorSurface( t: number ): string {
	const radius = t * CORNER_REACH;
	const spin = ( t * OBTURATOR_SPIN_DEG * Math.PI ) / 180;
	const ring: RevealPoint[] = [];
	for ( let i = 0; i < OBTURATOR_BLADES; i++ ) {
		const angle =
			spin - Math.PI / 2 + ( i / OBTURATOR_BLADES ) * Math.PI * 2;
		ring.push( [
			50 + Math.cos( angle ) * radius,
			50 + Math.sin( angle ) * radius,
		] );
	}
	return polygonWithHoles( OUTER, [ reverse( ring ) ] );
}

/**
 * Matched `{ from, to }` pair for the **camera shutter** reveal.
 */
export function obturatorPair(): { from: string; to: string } {
	return { from: obturatorSurface( 0 ), to: obturatorSurface( 1 ) };
}

/**
 * Matched `{ from, to }` pair for the **iris** reveal.
 */
export function irisPair(): { from: string; to: string } {
	return { from: irisSurface( 0 ), to: irisSurface( IRIS_MAX_RADIUS ) };
}

/**
 * Matched `{ from, to }` pair for the **curtain** reveal. The end
 * half-width overshoots 50 so the two panels are fully off-box rather
 * than meeting the edge exactly.
 */
export function curtainPair(): { from: string; to: string } {
	return { from: curtainSurface( 0 ), to: curtainSurface( 52 ) };
}

/**
 * Matched `{ from, to }` pair for the **blinds** reveal. The end height
 * slightly exceeds one band so consecutive slats overlap instead of
 * leaving a hairline between them.
 */
export function blindsPair(): { from: string; to: string } {
	return {
		from: blindsSurface( 0 ),
		to: blindsSurface( 100 / BLIND_SLATS + 0.5 ),
	};
}

/**
 * Matched `{ from, to }` pair for the **shutter** reveal.
 */
export function shutterPair(): { from: string; to: string } {
	return { from: shutterSurface( 0 ), to: shutterSurface( 52 ) };
}

/**
 * Matched `{ from, to }` pair for the **slats** reveal. Same
 * one-band-plus-a-hair end as {@link blindsPair}, for the same
 * no-hairline reason.
 */
export function slatsPair(): { from: string; to: string } {
	return {
		from: slatsSurface( 0 ),
		to: slatsSurface( 100 / VERTICAL_SLATS + 0.5 ),
	};
}

/**
 * Matched `{ from, to }` pair for the **diamond** reveal.
 */
export function diamondPair(): { from: string; to: string } {
	return { from: diamondSurface( 0 ), to: diamondSurface( CORNER_REACH ) };
}

/**
 * Matched `{ from, to }` pair for the **mosaic** reveal. Tiles end
 * slightly larger than their cell so neighbours overlap rather than
 * leaving a grid of seams.
 */
export function mosaicPair(): { from: string; to: string } {
	return { from: mosaicSurface( 0 ), to: mosaicSurface( 1.04 ) };
}

/**
 * Matched `{ from, to }` pair for the **radar** reveal.
 */
export function radarPair(): { from: string; to: string } {
	return { from: radarSurface( 0 ), to: radarSurface( 360 ) };
}

/**
 * Matched `{ from, to }` pair for the **rise** reveal — the surface's
 * bottom edge travels up, so the content arrives from below.
 */
export function risePair(): { from: string; to: string } {
	return { from: 'inset( 0% 0% 0% 0% )', to: 'inset( 0% 0% 100% 0% )' };
}

/**
 * Matched `{ from, to }` pair for the **sweep** reveal — a straight
 * edge travelling from the leading edge of the window to the trailing
 * one. `inset()` rather than `polygon()`: it is the shape function the
 * value is actually describing, and it interpolates on its own terms.
 *
 * Physical left-to-right in both writing directions. An RTL-aware
 * variant would need the engine to know the window's resolved
 * direction, which is not a decision the shape layer can make.
 */
export function sweepPair(): { from: string; to: string } {
	return { from: 'inset( 0% 0% 0% 0% )', to: 'inset( 0% 0% 0% 100% )' };
}

/**
 * Matched `{ from, to }` pair for the **diagonal** reveal — a slanted
 * band sweeping off the trailing edge. Four vertices at both ends, and
 * every `to` coordinate sits at or beyond 100%, so the box is fully
 * uncovered when it lands.
 */
export function diagonalPair(): { from: string; to: string } {
	return {
		from: polygonWithHoles( [
			[ -60, 0 ],
			[ 100, 0 ],
			[ 100, 100 ],
			[ 0, 100 ],
		] ),
		to: polygonWithHoles( [
			[ 100, 0 ],
			[ 260, 0 ],
			[ 260, 100 ],
			[ 160, 100 ],
		] ),
	};
}
