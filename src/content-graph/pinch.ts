/**
 * Content Graph — pinch-to-zoom maths.
 *
 * Two fingers on the board: the camera scales by how much they moved
 * apart and pans by how much their midpoint moved, so the point of the
 * world that was under the fingers' midpoint stays under it. Pure, so
 * the scene can drive it from two pointers and a test can drive it
 * from two numbers.
 *
 * The same anchoring the wheel uses (`scene.ts`, `bindStageInput`),
 * with the anchor moving: a wheel zooms about a cursor that stays put,
 * a pinch zooms about a midpoint that drifts as the hands do.
 */

export interface Camera {
	/** World-to-screen scale. */
	scale: number;
	/** World origin's screen x, in the canvas's own pixels. */
	x: number;
	/** World origin's screen y, in the canvas's own pixels. */
	y: number;
}

export interface Point {
	x: number;
	y: number;
}

/** The two fingers at one instant, in the canvas's own pixels. */
export interface PointerPair {
	a: Point;
	b: Point;
}

export interface ZoomBounds {
	min: number;
	max: number;
}

function distance( pair: PointerPair ): number {
	return Math.hypot( pair.b.x - pair.a.x, pair.b.y - pair.a.y );
}

function midpoint( pair: PointerPair ): Point {
	return { x: ( pair.a.x + pair.b.x ) / 2, y: ( pair.a.y + pair.b.y ) / 2 };
}

/**
 * The camera after the fingers moved from `prev` to `next`.
 *
 * A pair that has not separated (both fingers on one point) cannot
 * say how much to scale, so it only pans. The scale is clamped to
 * `bounds`; when the clamp bites, the anchoring still holds for the
 * scale that was applied.
 */
export function pinchCamera(
	camera: Camera,
	prev: PointerPair,
	next: PointerPair,
	bounds: ZoomBounds,
): Camera {
	const prevDistance = distance( prev );
	const nextDistance = distance( next );
	const factor = prevDistance > 0 && nextDistance > 0 ? nextDistance / prevDistance : 1;
	const scale = Math.max( bounds.min, Math.min( bounds.max, camera.scale * factor ) );

	const from = midpoint( prev );
	const to = midpoint( next );
	// The world point under the old midpoint...
	const worldX = ( from.x - camera.x ) / camera.scale;
	const worldY = ( from.y - camera.y ) / camera.scale;
	// ...lands under the new one.
	return {
		scale,
		x: to.x - worldX * scale,
		y: to.y - worldY * scale,
	};
}
