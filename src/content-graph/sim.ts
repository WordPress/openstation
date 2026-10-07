import type { GraphEdge, GraphNode } from './types';

export interface SimOptions {
	repulsion: number;
	springK: number;
	springLen: number;
	gravity: number;
	damping: number;
}

export const DEFAULT_SIM_OPTIONS: SimOptions = {

	repulsion: 26000,
	springK: 0.04,
	springLen: 200,
	gravity: 0.0035,
	damping: 0.86,
};

const ALPHA_DECAY = 0.992;
const ALPHA_MIN = 0.01;
const ALPHA_REHEAT = 1;

const MAX_VELOCITY = 12;

export class ForceSim {
	public nodes: GraphNode[];
	public edges: GraphEdge[];
	public opts: SimOptions;

	public dragOrigin: { x: number; y: number } | null = null;
	public dragInfluenceRadius = 500;

	public groupAssignment: Map< number, string[] > | null = null;

	public groupOrder: string[] | null = null;
	public groupAttractorStrength = 0.12;

	public groupOrderSpacing = 320;

	public groupOrderStaggerY = 0;
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

	step( dt = 1 ): void {
		if ( this.isSettled ) {
			return;
		}

		const { repulsion, springK, springLen, gravity, damping } = this.opts;
		const nodes = this.nodes;
		const len = nodes.length;

		for ( let i = 0; i < len; i++ ) {
			const a = nodes[ i ];
			for ( let j = i + 1; j < len; j++ ) {
				const b = nodes[ j ];
				let dx = a.x - b.x;
				let dy = a.y - b.y;
				let d2 = dx * dx + dy * dy;
				if ( d2 < 0.01 ) {
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

		this.applyClusterAttractor();

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

	private applyClusterAttractor(): void {
		const assignment = this.groupAssignment;
		if ( ! assignment ) {
			return;
		}
		const k = this.groupAttractorStrength;
		if ( k <= 0 ) {
			return;
		}

		const orderedX = new Map< string, number >();
		const orderedY = new Map< string, number >();
		if ( this.groupOrder && this.groupOrder.length > 0 ) {
			const n = this.groupOrder.length;
			const spacing = this.groupOrderSpacing;
			const stagger = this.groupOrderStaggerY;
			for ( let i = 0; i < n; i++ ) {
				const key = this.groupOrder[ i ];
				orderedX.set( key, ( i - ( n - 1 ) / 2 ) * spacing );
				if ( stagger > 0 ) {
					orderedY.set( key, i % 2 === 0 ? -stagger : stagger );
				}
			}
		}

		const centroids = new Map< string, { sx: number; sy: number; count: number } >();
		for ( const n of this.nodes ) {
			const keys = assignment.get( n.id );
			if ( ! keys || keys.length === 0 ) {
				continue;
			}
			for ( const key of keys ) {
				const c = centroids.get( key );
				if ( c ) {
					c.sx += n.x;
					c.sy += n.y;
					c.count++;
				} else {
					centroids.set( key, { sx: n.x, sy: n.y, count: 1 } );
				}
			}
		}

		for ( const n of this.nodes ) {
			if ( n.pinned ) {
				continue;
			}
			const keys = assignment.get( n.id );
			if ( ! keys || keys.length === 0 ) {
				continue;
			}
			const perKey = k / keys.length;
			for ( const key of keys ) {
				const c = centroids.get( key );
				if ( ! c || c.count === 0 ) {
					continue;
				}
				const cx = orderedX.has( key )
					? ( orderedX.get( key ) as number )
					: c.sx / c.count;
				const cy = orderedY.has( key )
					? ( orderedY.get( key ) as number )
					: c.sy / c.count;
				n.vx += ( cx - n.x ) * perKey;
				n.vy += ( cy - n.y ) * perKey;
			}
		}
	}

	setGroupAssignment(
		map: Map< number, string[] > | null,
		order: string[] | null = null,
	): void {
		this.groupAssignment = map;
		this.groupOrder = map ? order : null;
		this.reheat( 0.3, false );
	}
}
