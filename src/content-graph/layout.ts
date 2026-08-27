/**
 * Content Graph — layout helpers shared by the scene.
 *
 * Pure functions (no Pixi, no DOM) for the three decisions that
 * settle where a board lands on screen, kept out of `scene.ts` so
 * they can be pinned by tests without a renderer:
 *
 *   - **seeding** — where nodes start before the first simulation
 *     step;
 *   - **settling** — how many steps the sim runs before first paint;
 *   - **framing** — the camera transform that fits a set of points.
 *
 * Why a sparse board used to look broken: nodes were seeded at random
 * polar positions, the warm-up ran only ~30 steps, and the camera then
 * framed those positions. The sim kept cooling for several seconds
 * after first paint, gravity pulled the cluster's off-origin centroid
 * toward the world origin, and a two-node board drifted out of the
 * frame the camera had just been given. On a large board the random
 * centroid is already close to the origin and the drift is invisible;
 * on a small one it is most of the screen.
 *
 * @public
 */

export interface Point {
	x: number;
	y: number;
}

/**
 * Boards with at most this many nodes are seeded deterministically:
 * a single node at the origin, a pair side by side, and otherwise an
 * even ring. The centroid is the origin by construction, so gravity
 * has nothing to drag, and the same site produces the same board on
 * every open.
 */
export const SMALL_BOARD_MAX_NODES = 12;

/**
 * Boards with at most this many nodes are run to rest before the
 * first paint. Settling is O(n²) per step and takes ~570 steps from a
 * cold reheat; at 80 nodes that is a few milliseconds, well under one
 * frame. Beyond it the previous short warm-up applies and the layout
 * finishes settling on screen, as it always did.
 */
export const SETTLE_ON_LOAD_MAX_NODES = 80;

/**
 * Hard cap on the settle loop. `ForceSim` reaches `isSettled` in
 * about 570 steps from alpha 1; the cap is a backstop against a sim
 * that never cools (a future force without decay), not a tuning knob.
 */
export const SETTLE_ON_LOAD_MAX_STEPS = 700;

/**
 * Radius of the seed ring for a small board. Grows with the count so
 * the ring starts near the spacing the repulsion/gravity balance
 * settles on (~123 units per node for a pair) instead of collapsing
 * inward and re-expanding on screen.
 */
function ringRadius( count: number ): number {
	return 120 + 18 * count;
}

/**
 * Random polar seed for a node joining an already-laid-out board
 * (a post type switched back on). Matches the historical spread so a
 * newcomer lands somewhere in the periphery and gets pulled in.
 */
export function randomSeed( random: () => number = Math.random ): Point {
	const angle = random() * Math.PI * 2;
	const r = 150 + random() * 250;
	return { x: Math.cos( angle ) * r, y: Math.sin( angle ) * r };
}

/**
 * Seed positions for a board laid out from scratch.
 *
 * Small boards (see {@link SMALL_BOARD_MAX_NODES}) are placed on an
 * even ring starting at the left, so a pair reads as two cards side
 * by side rather than stacked. Larger boards keep the random spread
 * but are recentred so the centroid sits on the origin — the only
 * property the camera actually depends on.
 *
 * @param count  Number of nodes.
 * @param random Random source, injectable for tests.
 */
export function seedPositions(
	count: number,
	random: () => number = Math.random,
): Point[] {
	if ( count <= 0 ) {
		return [];
	}
	if ( count === 1 ) {
		return [ { x: 0, y: 0 } ];
	}
	if ( count <= SMALL_BOARD_MAX_NODES ) {
		const r = ringRadius( count );
		const out: Point[] = [];
		for ( let i = 0; i < count; i++ ) {
			const angle = Math.PI + ( i * Math.PI * 2 ) / count;
			out.push( {
				x: Math.cos( angle ) * r,
				y: Math.sin( angle ) * r,
			} );
		}
		return out;
	}
	const out: Point[] = [];
	let sx = 0;
	let sy = 0;
	for ( let i = 0; i < count; i++ ) {
		const p = randomSeed( random );
		out.push( p );
		sx += p.x;
		sy += p.y;
	}
	const cx = sx / count;
	const cy = sy / count;
	for ( const p of out ) {
		p.x -= cx;
		p.y -= cy;
	}
	return out;
}

/**
 * The short warm-start: enough synchronous steps to collapse the
 * chaotic opening frames, cheap enough for a board of any size, and
 * short enough that the layout is still visibly settling on screen.
 * Used for large boards, and for every board where nodes are joining
 * a layout the user is already looking at.
 */
export const JOIN_WARMUP_STEPS = 90;

/**
 * Upper bound on synchronous warm-up steps before the first paint of
 * a board laid out from scratch. The caller stops early once the sim
 * reports `isSettled`.
 */
export function warmupStepLimit( count: number ): number {
	if ( count <= SETTLE_ON_LOAD_MAX_NODES ) {
		return SETTLE_ON_LOAD_MAX_STEPS;
	}
	return JOIN_WARMUP_STEPS;
}

export interface Viewport {
	width: number;
	height: number;
}

export interface FrameOptions {
	/** World-space padding added on every side of the bounds. */
	padding: number;
	minScale: number;
	maxScale: number;
}

export interface CameraTarget {
	scale: number;
	x: number;
	y: number;
}

/**
 * Camera transform that centres `points` in `viewport` at the largest
 * scale (within the clamp) that keeps every point plus `padding`
 * inside. Returns `null` when there is nothing to frame or the
 * viewport has no size yet — a detached or not-yet-laid-out host
 * reports 0×0, and framing against it would park the board in the
 * top-left corner at minimum zoom.
 */
export function frameBounds(
	points: Iterable< Point >,
	viewport: Viewport,
	opts: FrameOptions,
): CameraTarget | null {
	if ( viewport.width <= 0 || viewport.height <= 0 ) {
		return null;
	}
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for ( const p of points ) {
		if ( p.x < minX ) {
			minX = p.x;
		}
		if ( p.y < minY ) {
			minY = p.y;
		}
		if ( p.x > maxX ) {
			maxX = p.x;
		}
		if ( p.y > maxY ) {
			maxY = p.y;
		}
	}
	if ( minX === Infinity ) {
		return null;
	}
	const w = maxX - minX + opts.padding * 2;
	const h = maxY - minY + opts.padding * 2;
	const sx = viewport.width / w;
	const sy = viewport.height / h;
	const scale = Math.max(
		opts.minScale,
		Math.min( opts.maxScale, Math.min( sx, sy ) ),
	);
	const cx = ( minX + maxX ) / 2;
	const cy = ( minY + maxY ) / 2;
	return {
		scale,
		x: viewport.width / 2 - cx * scale,
		y: viewport.height / 2 - cy * scale,
	};
}
