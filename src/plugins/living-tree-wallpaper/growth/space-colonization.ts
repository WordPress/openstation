/**
 * The Living Tree — Space Colonization growth simulator.
 *
 * The morphology engine (Runions et al., 2007). Starts with a single root
 * node at the origin and a cloud of auxin attractors inside the envelope;
 * each iteration grows the skeleton toward the attractors, biased upward
 * by tropism so growth reads bottom→top. Terminates when attractors are
 * exhausted, growth stalls, or the age-derived node cap is hit. See
 * `docs/living-tree-algorithm.md` §A.5.
 *
 * **Determinism contract:** `step( budget )` runs up to `budget` *whole*
 * SCA iterations — an iteration is atomic (every eligible node spawns,
 * then kills happen). Pacing (how many iterations per frame) therefore
 * never changes the final skeleton, only how fast it appears. This is
 * what lets `growthRate` derive from vigour while the topology invariant
 * (same age + seed → same skeleton) holds.
 *
 * @since 0.9.4
 */

import { sampleAttractors } from './envelope';
import type { BranchNode, Envelope, GrowthConfig, Vec2 } from '../types';

export class GrowthSimulator {
	/** The growing skeleton. Read by the mesh builder + leaf placer. */
	public readonly nodes: BranchNode[] = [];

	/** Live auxin sources; consumed as the skeleton reaches them. */
	private attractors: Vec2[];

	/** Children spawned per node — drives depth (level) bookkeeping. */
	private readonly childCount: number[] = [];

	/** True once growth has terminated. */
	private finished = false;

	/**
	 * @param env The envelope bounding growth + supplying the attractors.
	 * @param cfg Growth tuning (segment length, influence/kill radii, …).
	 * @param rng Seeded PRNG — every stochastic choice draws from here.
	 */
	constructor(
		private readonly env: Envelope,
		private readonly cfg: GrowthConfig,
		private readonly rng: () => number,
	) {
		this.attractors = sampleAttractors( env, env.attractorBudget, rng );
		this.addNode( { x: 0, y: 0 }, null, 0, { x: 0, y: -1 } );
	}

	/** Whether growth has terminated. */
	public get done(): boolean {
		return this.finished;
	}

	/**
	 * Advance growth by up to `budget` whole SCA iterations.
	 *
	 * @param budget Iterations to run this frame (≥1).
	 */
	public step( budget: number ): void {
		for ( let i = 0; i < Math.max( 1, Math.floor( budget ) ); i++ ) {
			if ( this.finished ) {
				return;
			}
			this.iterate();
		}
	}

	/** One atomic SCA iteration: associate → spawn → kill. */
	private iterate(): void {
		if ( this.attractors.length === 0 || this.nodes.length >= this.cfg.maxNodes ) {
			this.finished = true;
			return;
		}

		const { influenceRadius, killRadius, segLen, jitter, tropism, droop } = this.cfg;

		// 1. Each attractor associates with its nearest node within the
		// influence radius; accumulate pull vectors per node. Squared
		// distances in the scan; one sqrt for the winner only.
		const pullX = new Float64Array( this.nodes.length );
		const pullY = new Float64Array( this.nodes.length );
		const pulls = new Int32Array( this.nodes.length );
		const influenceSq = influenceRadius * influenceRadius;
		for ( const a of this.attractors ) {
			let best = -1;
			let bestDSq = influenceSq;
			for ( let n = 0; n < this.nodes.length; n++ ) {
				const p = this.nodes[ n ].pos;
				const dx = a.x - p.x;
				const dy = a.y - p.y;
				const dSq = dx * dx + dy * dy;
				if ( dSq < bestDSq ) {
					bestDSq = dSq;
					best = n;
				}
			}
			if ( best >= 0 ) {
				const p = this.nodes[ best ].pos;
				const d = Math.max( 1e-6, Math.sqrt( bestDSq ) );
				pullX[ best ] += ( a.x - p.x ) / d;
				pullY[ best ] += ( a.y - p.y ) / d;
				pulls[ best ]++;
			}
		}

		// 2. Every pulled node spawns one child toward its averaged
		// direction, with jitter + upward tropism + tip droop.
		const spawnedFrom: number[] = [];
		const nodeCountBefore = this.nodes.length;
		for ( let n = 0; n < nodeCountBefore; n++ ) {
			if ( pulls[ n ] === 0 ) {
				continue;
			}
			if ( this.nodes.length >= this.cfg.maxNodes ) {
				break;
			}
			const parent = this.nodes[ n ];
			const isFork = this.childCount[ n ] > 0;
			const childDepth = parent.depth + ( isFork ? 1 : 0 );
			if ( childDepth > this.env.maxDepth ) {
				continue;
			}

			let dx = pullX[ n ] / pulls[ n ] + ( this.rng() - 0.5 ) * jitter;
			let dy = pullY[ n ] / pulls[ n ] + ( this.rng() - 0.5 ) * jitter - tropism;
			// Deep, thin extremities droop a touch under gravity.
			dy += droop * ( parent.depth / Math.max( 1, this.env.maxDepth ) );
			let len = Math.max( 1e-6, Math.hypot( dx, dy ) );
			dx /= len;
			dy /= len;
			// Anti-dive clamp: late in growth only low leftover attractors
			// remain and branches start chasing them DOWNWARD. Real limbs
			// sag gently; they don't plunge. Allow a mild downward slope,
			// damp anything steeper hard.
			if ( dy > 0.2 ) {
				dy = 0.2 + ( dy - 0.2 ) * 0.25;
				len = Math.max( 1e-6, Math.hypot( dx, dy ) );
				dx /= len;
				dy /= len;
			}

			this.addNode(
				{ x: parent.pos.x + dx * segLen, y: parent.pos.y + dy * segLen },
				n,
				childDepth,
				{ x: dx, y: dy },
			);
			spawnedFrom.push( n );
		}

		// 3. Kill attractors the NEW nodes reached (older nodes already had
		// their chance in earlier iterations).
		if ( spawnedFrom.length > 0 ) {
			const killSq = killRadius * killRadius;
			const newNodes = this.nodes.slice( nodeCountBefore );
			this.attractors = this.attractors.filter( ( a ) => {
				for ( const node of newNodes ) {
					const dx = a.x - node.pos.x;
					const dy = a.y - node.pos.y;
					if ( dx * dx + dy * dy < killSq ) {
						return false;
					}
				}
				return true;
			} );
			return;
		}

		// Stalled: no attractor is reachable yet. Extend the highest tip
		// toward the nearest attractor (this is what grows the bare trunk
		// through the crown gap). If even that is illegal, we're done.
		this.extendTowardNearest();
	}

	/** Trunk bootstrap: grow the highest tip toward the nearest attractor. */
	private extendTowardNearest(): void {
		if ( this.nodes.length >= this.cfg.maxNodes ) {
			this.finished = true;
			return;
		}
		// Highest (smallest y) tip node.
		let tip = 0;
		for ( let n = 0; n < this.nodes.length; n++ ) {
			if ( this.childCount[ n ] === 0 && this.nodes[ n ].pos.y < this.nodes[ tip ].pos.y ) {
				tip = n;
			}
		}
		const from = this.nodes[ tip ];
		let nearest: Vec2 | null = null;
		let nearestD = Infinity;
		for ( const a of this.attractors ) {
			const d = Math.hypot( a.x - from.pos.x, a.y - from.pos.y );
			if ( d < nearestD ) {
				nearestD = d;
				nearest = a;
			}
		}
		if ( ! nearest || from.depth > this.env.maxDepth ) {
			this.finished = true;
			return;
		}
		// A leftover attractor steeply BELOW the canopy is unreachable
		// without diving. Prune it instead of chain-chasing it — chasing
		// is what produced both plunging limbs and long bare chains.
		if ( ( nearest.y - from.pos.y ) / nearestD > 0.45 ) {
			const dead = nearest;
			this.attractors = this.attractors.filter( ( a ) => a !== dead );
			return;
		}
		const jitterAmount = this.cfg.jitter * 0.5;
		let dx = ( nearest.x - from.pos.x ) / nearestD + ( this.rng() - 0.5 ) * jitterAmount;
		let dy = ( nearest.y - from.pos.y ) / nearestD - this.cfg.tropism;
		let len = Math.max( 1e-6, Math.hypot( dx, dy ) );
		dx /= len;
		dy /= len;
		// Same anti-dive clamp as the main spawn path.
		if ( dy > 0.2 ) {
			dy = 0.2 + ( dy - 0.2 ) * 0.25;
			len = Math.max( 1e-6, Math.hypot( dx, dy ) );
			dx /= len;
			dy /= len;
		}
		this.addNode(
			{
				x: from.pos.x + dx * this.cfg.segLen,
				y: from.pos.y + dy * this.cfg.segLen,
			},
			tip,
			from.depth,
			{ x: dx, y: dy },
		);
	}

	private addNode(
		pos: Vec2,
		parent: number | null,
		depth: number,
		direction: Vec2,
	): void {
		this.nodes.push( {
			id: this.nodes.length,
			pos,
			parent,
			depth,
			radius: 1,
			compliance: 0,
			direction,
		} );
		this.childCount.push( 0 );
		if ( parent !== null ) {
			this.childCount[ parent ]++;
		}
	}

	/** Terminal (childless) node indices — where leaves want to live. */
	public tips(): number[] {
		const out: number[] = [];
		for ( let n = 0; n < this.nodes.length; n++ ) {
			if ( this.childCount[ n ] === 0 && n > 0 ) {
				out.push( n );
			}
		}
		return out;
	}
}
