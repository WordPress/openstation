/**
 * Desktop Mode — Mascot environment awareness.
 *
 * The mascot is not a decal painted over the wallpaper: it knows
 * what is on the desk. Every frame the simulation asks the shell for
 * the live collision surfaces (`wp.desktop.getWallpaperSurfaces()` —
 * window rects, widget cards, the dock edge, the shell floor),
 * converts them into the mascot layer's own coordinate space, and
 * feeds them to the soft body as solid obstacles.
 *
 * Two behaviours come out of that:
 *
 *   - **Contact.** Rim points that penetrate a rect are pushed back
 *     out along the shallowest axis, so the blob squashes onto the
 *     top edge of a window instead of sinking through it.
 *   - **Gravity gating.** Gravity is not a constant. It ramps in as
 *     a *window* (or widget card) comes within
 *     `physics.gravityRange`, and ramps back out when the desk
 *     empties around the mascot — at which point it floats. The
 *     shell floor and the dock are solid but never trigger gravity;
 *     otherwise gravity would be permanently on and the mascot would
 *     never float.
 *
 * Every function here is pure and DOM-free so the behaviour is unit
 * testable without a browser.
 */

import type { WallpaperSurface } from '../wallpapers/surfaces';

/** An axis-aligned solid rect in mascot-layer coordinates. */
export interface Obstacle {
	id: string;
	kind: WallpaperSurface[ 'kind' ];
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Minimal mutable particle shape the collision helpers operate on. */
export interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
}

/** Origin of the mascot layer in viewport coordinates. */
export interface LayerOrigin {
	left: number;
	top: number;
}

/**
 * Surface kinds that attract the mascot, and that it can be trapped
 * inside of. The shell floor and the dock are solid but inert:
 * magnetising to either would pin the mascot to the edge of the
 * screen forever, since one of them is always nearby.
 */
const MAGNET_KINDS: ReadonlySet< WallpaperSurface[ 'kind' ] > = new Set( [
	'window',
	'widget',
] );

/**
 * Convert the shell's viewport-space surfaces into layer-local
 * obstacles, dropping degenerate rects.
 *
 * Thin synthetic strips (the 1-px shell floor, the dock edge) are
 * kept as-is: they are already the shape the collision solver wants.
 */
export function collectObstacles(
	surfaces: readonly WallpaperSurface[],
	origin: LayerOrigin,
): Obstacle[] {
	const out: Obstacle[] = [];
	for ( const surface of surfaces ) {
		const r = surface.rect;
		if ( ! r || r.width <= 0 || r.height <= 0 ) {
			continue;
		}
		out.push( {
			id: surface.id,
			kind: surface.kind,
			x: r.x - origin.left,
			y: r.y - origin.top,
			width: r.width,
			height: r.height,
		} );
	}
	return out;
}

/**
 * Shortest distance from a point to a rect's boundary, `0` when the
 * point is inside.
 */
export function distanceToObstacle(
	px: number,
	py: number,
	o: Obstacle,
): number {
	const dx = Math.max( o.x - px, 0, px - ( o.x + o.width ) );
	const dy = Math.max( o.y - py, 0, py - ( o.y + o.height ) );
	return Math.hypot( dx, dy );
}

/** Closest point to `(px, py)` on a rect (the point itself if inside). */
export function closestPointOn(
	px: number,
	py: number,
	o: Obstacle,
): { x: number; y: number } {
	return {
		x: Math.min( Math.max( px, o.x ), o.x + o.width ),
		y: Math.min( Math.max( py, o.y ), o.y + o.height ),
	};
}

/** A magnet pull toward one window, as a unit direction plus a 0–1 falloff. */
export interface MagnetPull {
	/** Unit vector from the body toward the attracting surface. */
	dx: number;
	dy: number;
	/**
	 * `0` at `range`, `1` once the body is touching.
	 *
	 * Measured from {@link gap}, not from the centroid's distance —
	 * a body resting against a window has its *centroid* a whole
	 * radius away, so a centroid-based falloff would top out around
	 * 0.9 and leave a permanent sliver of idle float driving a
	 * mascot that is supposed to be sitting still.
	 */
	strength: number;
	/**
	 * Surface-to-surface distance: how far the body's edge is from
	 * the window's edge. Zero when just touching, **negative** when
	 * pressed in. This is what the magnet spring works against.
	 */
	gap: number;
}

/**
 * The pull of the nearest window, or `null` when the desk is empty
 * around the mascot.
 *
 * Windows attract rather than weigh: there is no global "down". The
 * mascot is drawn to the closest point on the nearest window's edge
 * from whatever direction it is in — above, beside, below — sticks
 * there, and squashes against it. Away from every window it floats.
 *
 * Only the *nearest* window pulls. Summing every window in range
 * looks more physical and behaves worse: between two windows the
 * forces cancel and the mascot hovers in the gap, twitching, instead
 * of committing to one of them.
 *
 * Strength is smoothstepped so approach and release read as the
 * mascot *noticing* a window rather than a switch flipping.
 *
 * @param px        Body centre X, layer-local.
 * @param py        Body centre Y, layer-local.
 * @param radius    Body rest radius, for the surface-to-surface gap.
 * @param obstacles Live obstacle set.
 * @param range     Gap at which the magnet starts to bite.
 */
export function magnetPull(
	px: number,
	py: number,
	radius: number,
	obstacles: readonly Obstacle[],
	range: number,
): MagnetPull | null {
	if ( range <= 0 ) {
		return null;
	}
	let nearest: Obstacle | null = null;
	let nearestDistance = Infinity;
	for ( const o of obstacles ) {
		if ( ! MAGNET_KINDS.has( o.kind ) ) {
			continue;
		}
		const d = distanceToObstacle( px, py, o );
		if ( d < nearestDistance ) {
			nearestDistance = d;
			nearest = o;
		}
	}
	if ( ! nearest ) {
		return null;
	}

	const gap = nearestDistance - radius;
	if ( gap >= range ) {
		return null;
	}

	const t = 1 - Math.max( gap, 0 ) / range;
	const strength = t * t * ( 3 - 2 * t );

	const target = closestPointOn( px, py, nearest );
	const dx = target.x - px;
	const dy = target.y - py;
	const len = Math.hypot( dx, dy );
	if ( len < 1e-3 ) {
		// The centre is exactly on the surface — no direction to pull
		// in. The contact solver and, if we're engulfed,
		// `findEscape()` take over from here.
		return { dx: 0, dy: 0, strength, gap };
	}
	return { dx: dx / len, dy: dy / len, strength, gap };
}

/**
 * Merge every window that overlaps `seed`, transitively, into one
 * bounding rect.
 *
 * A tiled or stacked group of windows is one obstacle as far as the
 * mascot is concerned. Ejecting from a single window in the middle
 * of a tiled row would drop the mascot straight into its neighbour,
 * and the next frame would eject it again — a pinball loop across
 * the desk. Escaping the *cluster* leaves it beside the group.
 *
 * @param seed      The rect to grow from.
 * @param obstacles Live obstacle set.
 * @param pad       Slack (px) when testing overlap; closes the
 *                  hairline gaps between snapped windows so a tiled
 *                  pair merges instead of reading as two.
 */
export function clusterBounds(
	seed: Obstacle,
	obstacles: readonly Obstacle[],
	pad = 8,
): { x: number; y: number; width: number; height: number } {
	let minX = seed.x;
	let minY = seed.y;
	let maxX = seed.x + seed.width;
	let maxY = seed.y + seed.height;

	const remaining = obstacles.filter(
		( o ) => MAGNET_KINDS.has( o.kind ) && o !== seed,
	);
	let grew = true;
	while ( grew ) {
		grew = false;
		for ( let i = remaining.length - 1; i >= 0; i-- ) {
			const o = remaining[ i ];
			const overlaps =
				o.x < maxX + pad &&
				o.x + o.width > minX - pad &&
				o.y < maxY + pad &&
				o.y + o.height > minY - pad;
			if ( ! overlaps ) {
				continue;
			}
			minX = Math.min( minX, o.x );
			minY = Math.min( minY, o.y );
			maxX = Math.max( maxX, o.x + o.width );
			maxY = Math.max( maxY, o.y + o.height );
			remaining.splice( i, 1 );
			grew = true;
		}
	}

	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * How deep the body's centre has to be inside a window before we
 * call it trapped, as a fraction of the body radius.
 *
 * The obvious test — "is the centre inside a window?" — is far too
 * eager. A mascot magnet-stuck to a corner has the contact solver
 * pushing its rim toward two faces at once, and the centroid dips a
 * few pixels past the edge as a matter of course. With a bare
 * inside-test that reads as trapped and the mascot teleports away
 * from a corner it was perfectly happy resting on.
 *
 * Genuine engulfment puts the centre at least half a body deep,
 * usually far more (windows are hundreds of pixels across). Three
 * quarters of a radius sits comfortably between the two.
 */
const TRAPPED_DEPTH_FACTOR = 0.75;

/**
 * Where to teleport a mascot that a window has opened on top of, or
 * `null` when it isn't trapped.
 *
 * Contact is not trapped — the mascot is *supposed* to rest against
 * windows, corners included. Trapped means its centre is buried
 * {@link TRAPPED_DEPTH_FACTOR} of a body deep inside one, which only
 * happens when geometry appears or moves over it. The contact solver
 * can't recover from that: rim points on opposite sides of the blob
 * get pushed toward opposite faces and the silhouette tears itself
 * apart.
 *
 * The escape target is the midpoint of the nearest side of the
 * window *cluster*, offset outward by the body radius. Midpoints,
 * not corners, so the mascot lands somewhere it can actually rest;
 * the cluster rather than the single window so a tiled group doesn't
 * bounce it from one window to the next.
 *
 * Candidates that would leave the layer are dropped. If every side
 * is off-screen (a maximised window), the mascot goes to the centre
 * of the largest free margin instead — and if there isn't one, the
 * layer centre, which at least is not inside a broken state.
 *
 * @param px            Body centre X, layer-local.
 * @param py            Body centre Y, layer-local.
 * @param radius        Body rest radius.
 * @param obstacles     Live obstacle set.
 * @param bounds        Layer size.
 * @param bounds.width  Layer width.
 * @param bounds.height Layer height.
 */
export function findEscape(
	px: number,
	py: number,
	radius: number,
	obstacles: readonly Obstacle[],
	bounds: { width: number; height: number },
): { x: number; y: number } | null {
	const minDepth = radius * TRAPPED_DEPTH_FACTOR;
	let trappedIn: Obstacle | null = null;
	let deepest = minDepth;
	for ( const o of obstacles ) {
		if ( ! MAGNET_KINDS.has( o.kind ) ) {
			continue;
		}
		// Distance from the centre to the nearest face — how far it
		// would have to travel to get out the easy way. Negative or
		// zero means the centre isn't inside at all.
		const depth = Math.min(
			px - o.x,
			o.x + o.width - px,
			py - o.y,
			o.y + o.height - py,
		);
		if ( depth > deepest ) {
			deepest = depth;
			trappedIn = o;
		}
	}
	if ( ! trappedIn ) {
		return null;
	}

	const cluster = clusterBounds( trappedIn, obstacles );
	const margin = radius + 8;
	const midX = cluster.x + cluster.width / 2;
	const midY = cluster.y + cluster.height / 2;

	const candidates = [
		{ x: midX, y: cluster.y - margin },
		{ x: midX, y: cluster.y + cluster.height + margin },
		{ x: cluster.x - margin, y: midY },
		{ x: cluster.x + cluster.width + margin, y: midY },
	].filter(
		( c ) =>
			c.x >= radius &&
			c.y >= radius &&
			c.x <= bounds.width - radius &&
			c.y <= bounds.height - radius,
	);

	if ( candidates.length > 0 ) {
		let best = candidates[ 0 ];
		let bestDistance = Infinity;
		for ( const c of candidates ) {
			const d = Math.hypot( c.x - px, c.y - py );
			if ( d < bestDistance ) {
				bestDistance = d;
				best = c;
			}
		}
		return best;
	}

	// Nowhere outside the cluster fits — a maximised or oversized
	// window. Fall back to the widest strip of desk left over on any
	// side, then to the layer centre.
	const gaps = [
		{ size: cluster.y, x: midX, y: cluster.y / 2 },
		{
			size: bounds.height - ( cluster.y + cluster.height ),
			x: midX,
			y: ( cluster.y + cluster.height + bounds.height ) / 2,
		},
		{ size: cluster.x, x: cluster.x / 2, y: midY },
		{
			size: bounds.width - ( cluster.x + cluster.width ),
			x: ( cluster.x + cluster.width + bounds.width ) / 2,
			y: midY,
		},
	].sort( ( a, b ) => b.size - a.size );

	const widest = gaps[ 0 ];
	if ( widest && widest.size >= radius ) {
		return { x: widest.x, y: widest.y };
	}
	return { x: bounds.width / 2, y: bounds.height / 2 };
}

/**
 * Push `p` out of every obstacle it penetrates and bleed its
 * velocity accordingly.
 *
 * Resolution is per-obstacle along the shallowest penetration axis —
 * the standard AABB response. It is deliberately not a swept test:
 * the mascot moves at desk speeds, the sub-step is 1/240 s, and
 * tunnelling through a 1-px floor strip is prevented by clamping the
 * body to the layer bounds separately.
 *
 * @param p           Particle, mutated in place.
 * @param obstacles   Live obstacle set.
 * @param restitution Fraction of normal velocity reflected, 0–1.
 * @param friction    Fraction of tangential velocity retained, 0–1.
 * @return `true` when at least one contact was resolved.
 */
export function resolveObstacleCollisions(
	p: Particle,
	obstacles: readonly Obstacle[],
	restitution: number,
	friction: number,
): boolean {
	let touched = false;
	for ( const o of obstacles ) {
		const right = o.x + o.width;
		const bottom = o.y + o.height;
		if ( p.x <= o.x || p.x >= right || p.y <= o.y || p.y >= bottom ) {
			continue;
		}
		const fromLeft = p.x - o.x;
		const fromRight = right - p.x;
		const fromTop = p.y - o.y;
		const fromBottom = bottom - p.y;
		const min = Math.min( fromLeft, fromRight, fromTop, fromBottom );
		touched = true;

		if ( min === fromTop ) {
			p.y = o.y;
			if ( p.vy > 0 ) {
				p.vy = -p.vy * restitution;
			}
			p.vx *= friction;
		} else if ( min === fromBottom ) {
			p.y = bottom;
			if ( p.vy < 0 ) {
				p.vy = -p.vy * restitution;
			}
			p.vx *= friction;
		} else if ( min === fromLeft ) {
			p.x = o.x;
			if ( p.vx > 0 ) {
				p.vx = -p.vx * restitution;
			}
			p.vy *= friction;
		} else {
			p.x = right;
			if ( p.vx < 0 ) {
				p.vx = -p.vx * restitution;
			}
			p.vy *= friction;
		}
	}
	return touched;
}

/**
 * Keep a particle inside the layer. The mascot may hang off an edge
 * visually, but its rim points never leave the canvas — otherwise a
 * throw at the viewport edge would lose the mascot for good.
 *
 * @param p           Particle, mutated in place.
 * @param width       Layer width.
 * @param height      Layer height.
 * @param restitution Fraction of normal velocity reflected, 0–1.
 * @param friction    Fraction of tangential velocity retained, 0–1.
 * @return `true` when the particle was against an edge.
 */
export function clampToBounds(
	p: Particle,
	width: number,
	height: number,
	restitution: number,
	friction: number,
): boolean {
	let touched = false;
	if ( p.x < 0 ) {
		p.x = 0;
		if ( p.vx < 0 ) {
			p.vx = -p.vx * restitution;
		}
		p.vy *= friction;
		touched = true;
	} else if ( p.x > width ) {
		p.x = width;
		if ( p.vx > 0 ) {
			p.vx = -p.vx * restitution;
		}
		p.vy *= friction;
		touched = true;
	}
	if ( p.y < 0 ) {
		p.y = 0;
		if ( p.vy < 0 ) {
			p.vy = -p.vy * restitution;
		}
		p.vx *= friction;
		touched = true;
	} else if ( p.y > height ) {
		p.y = height;
		if ( p.vy > 0 ) {
			p.vy = -p.vy * restitution;
		}
		p.vx *= friction;
		touched = true;
	}
	return touched;
}
