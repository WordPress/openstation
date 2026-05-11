/**
 * Content Graph — force-directed layout.
 *
 * Hand-rolled spring simulation, no d3-force dependency. Driven each
 * frame by `Pixi.Ticker`. The forces are deliberately mild so the
 * graph settles into a readable layout in a couple of seconds and
 * stays stable when the user drags a node — over-tuned forces give
 * the "vibrating gel" effect we want to avoid.
 *
 * Forces:
 *   - **Repulsion** between every pair of nodes (Coulomb-ish, falls
 *     off as 1/r²). O(n²) — fine up to ~500 nodes; Barnes-Hut can be
 *     dropped in later by replacing only this loop.
 *   - **Spring** along every edge — Hooke's law toward `SPRING_LEN`.
 *   - **Gravity** toward the world origin so disconnected components
 *     don't drift to infinity.
 *
 * Integration: explicit Euler with velocity damping. Cooling is
 * handled by `alpha`, which decays each tick and gates motion via
 * `velocity *= alpha`. When alpha falls under a threshold the sim is
 * considered settled and the ticker is parked until the user shakes
 * it (drag, filter change, focus).
 *
 * @public
 * @since 0.8.2
 */

import type { GraphEdge, GraphNode } from './types';

export interface SimOptions {
	repulsion: number;
	springK: number;
	springLen: number;
	gravity: number;
	damping: number;
	/**
	 * Strength coefficient for the per-cluster centroid attractor
	 * force introduced in 0.9.0. `0` disables the force entirely
	 * (Constellation lens behavior). Galaxy lens sets this nonzero
	 * via `setForceConfig({ attractorStrength })`.
	 *
	 * @since 0.9.0
	 */
	attractorStrength: number;
}

export const DEFAULT_SIM_OPTIONS: SimOptions = {
	// Tuned to mirror Obsidian's airy graph: longer springs, weaker
	// gravity, stronger repulsion, so disconnected components drift
	// to the periphery instead of pancaking onto the connected core.
	// Repulsion is intentionally generous, on a real-world dataset
	// like Obsidian's vault you'd see most nodes isolated from the
	// connected core, and we want them spread out enough that the
	// initial fit doesn't crush every label on top of every other.
	repulsion: 26000,
	springK: 0.04,
	springLen: 200,
	gravity: 0.0035,
	damping: 0.86,
	attractorStrength: 0,
};

/**
 * A `ClusterMembership` maps each node id to the cluster keys it
 * belongs to. Multi-membership pulls the node toward each centroid
 * proportionally; the emergent settle position is the (force-weighted)
 * average. The reserved key `'__uncategorized__'` is used by
 * `setClusters()` callers to flag nodes with no in-scope memberships
 * so they form a single Uncategorized galaxy.
 *
 * @since 0.9.0
 */
export type ClusterMembership = Map< number, string[] >;

const ALPHA_DECAY = 0.992;
const ALPHA_MIN = 0.01;
const ALPHA_REHEAT = 1;
// Hard cap on per-step velocity so a few densely-packed nodes can't
// produce an explosive position jump in one frame. Tuned so the sim
// still feels responsive — at alpha=1 the per-frame travel cap is
// 12px, plenty for visible motion, far short of "nodes flying off".
const MAX_VELOCITY = 12;

export class ForceSim {
	public nodes: GraphNode[];
	public edges: GraphEdge[];
	public opts: SimOptions;
	/**
	 * When set, the position-update step is gated by a smoothstep
	 * falloff around this point: nodes within `dragInfluenceRadius`
	 * integrate at full per-frame alpha, nodes beyond it integrate at
	 * zero. Keeps the visible ripple of a drag local to the dragged
	 * node's neighborhood instead of cascading through every spring
	 * chain to the far edge of the graph.
	 */
	public dragOrigin: { x: number; y: number } | null = null;
	public dragInfluenceRadius = 500;
	/**
	 * Per-node cluster membership. `null` disables the cluster-attractor
	 * force entirely (Constellation lens). When non-null, the
	 * tick loop derives per-cluster centroids from current member
	 * positions and pulls each member toward its centroid(s).
	 *
	 * @since 0.9.0
	 */
	private clusterMembership: ClusterMembership | null = null;
	private alpha = ALPHA_REHEAT;

	constructor(
		nodes: GraphNode[],
		edges: GraphEdge[],
		opts: SimOptions = DEFAULT_SIM_OPTIONS,
	) {
		this.nodes = nodes;
		this.edges = edges;
		this.opts = opts;
	}

	/**
	 * Mutate force-config flags in place. Used by the lens-switch path
	 * (`GraphScene.setLens()`) so transitioning between Constellation
	 * and Galaxy doesn't require recreating the sim.
	 *
	 * @since 0.9.0
	 */
	setForceConfig( patch: Partial< SimOptions > ): void {
		this.opts = { ...this.opts, ...patch };
	}

	/**
	 * Replace the cluster membership map (or null it out to disable
	 * the cluster-attractor force).
	 *
	 * @since 0.9.0
	 */
	setClusters( membership: ClusterMembership | null ): void {
		this.clusterMembership = membership;
	}

	reheat( value = ALPHA_REHEAT, kick = true ): void {
		this.alpha = Math.max( this.alpha, value );
		if ( ! kick ) {
			return;
		}
		// At equilibrium every force balances to ~zero and velocities
		// have been fully damped, so just bumping alpha produces no
		// visible motion — the position update `n.x += n.vx * alpha`
		// stays at zero. Inject a small random kick proportional to
		// `value` so the cluster visibly re-settles. Pass `kick=false`
		// for the very first reheat (initial layout), where the random
		// initial positions already produce plenty of natural motion
		// from the unbalanced forces alone.
		const kickStrength = value * 3;
		for ( const n of this.nodes ) {
			if ( n.pinned ) {
				continue;
			}
			n.vx += ( Math.random() - 0.5 ) * kickStrength;
			n.vy += ( Math.random() - 0.5 ) * kickStrength;
		}
	}

	get isSettled(): boolean {
		return this.alpha < ALPHA_MIN;
	}

	/**
	 * One simulation step. `dt` defaults to 1 (one frame at the
	 * `Pixi.Ticker`'s native pace); pass a tick's `deltaTime` to
	 * compensate for frame skips.
	 */
	step( dt = 1 ): void {
		if ( this.isSettled ) {
			return;
		}

		const { repulsion, springK, springLen, gravity, damping } = this.opts;
		const nodes = this.nodes;
		const len = nodes.length;

		// Repulsion.
		for ( let i = 0; i < len; i++ ) {
			const a = nodes[ i ];
			for ( let j = i + 1; j < len; j++ ) {
				const b = nodes[ j ];
				let dx = a.x - b.x;
				let dy = a.y - b.y;
				let d2 = dx * dx + dy * dy;
				if ( d2 < 0.01 ) {
					// Co-located, give them a deterministic kick.
					dx = ( i - j ) * 0.5;
					dy = ( i + j ) * 0.5;
					d2 = dx * dx + dy * dy;
				}
				const f = repulsion / d2;
				const d = Math.sqrt( d2 );
				const fx = ( dx / d ) * f;
				const fy = ( dy / d ) * f;
				const wa = a.pinned ? 0 : 1;
				const wb = b.pinned ? 0 : 1;
				a.vx += fx * wa;
				a.vy += fy * wa;
				b.vx -= fx * wb;
				b.vy -= fy * wb;
			}
		}

		// Spring.
		for ( const e of this.edges ) {
			const dx = e.to.x - e.from.x;
			const dy = e.to.y - e.from.y;
			const d = Math.sqrt( dx * dx + dy * dy ) || 0.0001;
			const f = ( d - springLen ) * springK;
			const fx = ( dx / d ) * f;
			const fy = ( dy / d ) * f;
			if ( ! e.from.pinned ) {
				e.from.vx += fx;
				e.from.vy += fy;
			}
			if ( ! e.to.pinned ) {
				e.to.vx -= fx;
				e.to.vy -= fy;
			}
		}

		// Cluster attractor (Galaxy lens). Computes per-cluster
		// centroids from current member positions, then pulls each
		// non-pinned node toward the (equally-weighted) average of
		// the centroids of clusters it belongs to. Multi-cluster
		// nodes settle between centroids by emergent force balance.
		// Disabled when membership is null OR strength is zero.
		const membership = this.clusterMembership;
		const attractorStrength = this.opts.attractorStrength;
		if ( membership && attractorStrength > 0 ) {
			const centroids = new Map<
				string,
				{ sx: number; sy: number; n: number }
			>();
			for ( const n of nodes ) {
				const keys = membership.get( n.id );
				if ( ! keys ) {
					continue;
				}
				for ( const k of keys ) {
					const c = centroids.get( k );
					if ( c ) {
						c.sx += n.x;
						c.sy += n.y;
						c.n += 1;
					} else {
						centroids.set( k, { sx: n.x, sy: n.y, n: 1 } );
					}
				}
			}
			for ( const n of nodes ) {
				if ( n.pinned ) {
					continue;
				}
				const keys = membership.get( n.id );
				if ( ! keys || keys.length === 0 ) {
					continue;
				}
				let tx = 0;
				let ty = 0;
				let count = 0;
				for ( const k of keys ) {
					const c = centroids.get( k );
					if ( ! c || c.n === 0 ) {
						continue;
					}
					tx += c.sx / c.n;
					ty += c.sy / c.n;
					count += 1;
				}
				if ( count === 0 ) {
					continue;
				}
				tx /= count;
				ty /= count;
				n.vx += ( tx - n.x ) * attractorStrength;
				n.vy += ( ty - n.y ) * attractorStrength;
			}
		}

		// Gravity + integrate.
		const a = this.alpha;
		const drag = this.dragOrigin;
		const dragR = this.dragInfluenceRadius;
		const dragR2 = dragR * dragR;
		for ( const n of nodes ) {
			if ( ! n.pinned ) {
				n.vx -= n.x * gravity;
				n.vy -= n.y * gravity;
				n.vx *= damping;
				n.vy *= damping;
				// Clamp velocity so a momentary force spike (e.g.
				// initial layout where many densely-packed nodes
				// briefly push hard on each other) can't shoot a
				// node halfway across the canvas in one frame.
				if ( n.vx > MAX_VELOCITY ) {
					n.vx = MAX_VELOCITY;
				} else if ( n.vx < -MAX_VELOCITY ) {
					n.vx = -MAX_VELOCITY;
				}
				if ( n.vy > MAX_VELOCITY ) {
					n.vy = MAX_VELOCITY;
				} else if ( n.vy < -MAX_VELOCITY ) {
					n.vy = -MAX_VELOCITY;
				}
				let nodeAlpha = a;
				if ( drag ) {
					const ddx = n.x - drag.x;
					const ddy = n.y - drag.y;
					const dd2 = ddx * ddx + ddy * ddy;
					if ( dd2 >= dragR2 ) {
						nodeAlpha = 0;
					} else {
						// Smoothstep ramp: full alpha at the drag
						// origin, easing to zero at the radius edge.
						const t = 1 - Math.sqrt( dd2 ) / dragR;
						nodeAlpha *= t * t * ( 3 - 2 * t );
					}
				}
				n.x += n.vx * nodeAlpha * dt;
				n.y += n.vy * nodeAlpha * dt;
			}
		}

		this.alpha *= ALPHA_DECAY;
	}
}
