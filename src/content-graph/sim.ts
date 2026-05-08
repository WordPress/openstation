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
};

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

		// Gravity + integrate.
		const a = this.alpha;
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
				n.x += n.vx * a * dt;
				n.y += n.vy * a * dt;
			}
		}

		this.alpha *= ALPHA_DECAY;
	}
}
