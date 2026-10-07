import { leafColor } from '../palette';
import type { PixiContainer, PixiNamespace, PixiSprite, PixiTexture } from '../pixi-types';
import type { BranchNode, Hormones, TreeSnapshot, Vec2 } from '../types';
import type { WindField } from '../wind';

const MIN_LEAVES = 6;
const MAX_LEAVES = 3200;

const LEAVES_PER_CLUSTER = 10;

const TUFT_HUE_JITTER = 9;

function leafyShootRadius( trunkBase: number ): number {
	return Math.max( 3.4, trunkBase * 0.3 );
}

const LEAF_TEX_SIZE = 48;

interface ClusterLeaf {
	sprite: PixiSprite;
	dx: number;
	dy: number;
	baseRotation: number;
	phase: number;
	alphaMax: number;

	behind: boolean;
}

interface Cluster {
	center: Vec2;
	compliance: number;
	radius: number;
	leaves: ClusterLeaf[];

	delay: number;
	age: number;
	phase: number;
}

export function computeLeafBudget( foliage01: number ): number {
	const f = Math.min( 1, Math.max( 0, foliage01 ) );
	return Math.round( MIN_LEAVES + ( MAX_LEAVES - MIN_LEAVES ) * Math.pow( f, 1.35 ) );
}

function shade( color: number, f: number ): number {
	const r = Math.min( 255, Math.round( ( Math.floor( color / 65536 ) % 256 ) * f ) );
	const g = Math.min( 255, Math.round( ( Math.floor( color / 256 ) % 256 ) * f ) );
	const b = Math.min( 255, Math.round( ( color % 256 ) * f ) );
	return r * 65536 + g * 256 + b;
}

const CLUSTER_TEX_SIZE = 96;

const CLUSTER_TEX_VARIANTS = 4;

const BLADES_PER_TEXTURE_MIN = 6;
const BLADES_PER_TEXTURE_MAX = 10;

function drawBladeInto(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	rotation: number,
	length: number,
	brightness: number,
): void {
	ctx.save();
	ctx.translate( x, y );
	ctx.rotate( rotation );
	const half = length * 0.28;
	const gradient = ctx.createLinearGradient( 0, -length / 2, 0, length / 2 );
	const c = Math.round( 255 * brightness );
	gradient.addColorStop( 0, `rgba(${ c }, ${ c }, ${ c }, 1)` );
	gradient.addColorStop( 0.55, `rgba(${ c }, ${ c }, ${ c }, 0.95)` );
	gradient.addColorStop( 1, `rgba(${ Math.round( c * 0.72 ) }, ${ Math.round( c * 0.72 ) }, ${ Math.round( c * 0.72 ) }, 0.9)` );
	ctx.fillStyle = gradient;
	ctx.beginPath();
	ctx.moveTo( 0, -length / 2 );
	ctx.quadraticCurveTo( half, 0, 0, length / 2 );
	ctx.quadraticCurveTo( -half, 0, 0, -length / 2 );
	ctx.closePath();
	ctx.fill();
	ctx.strokeStyle = `rgba(${ Math.round( c * 0.4 ) }, ${ Math.round( c * 0.4 ) }, ${ Math.round( c * 0.4 ) }, 0.3)`;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo( 0, -length / 2 + 3 );
	ctx.quadraticCurveTo( 1, 0, 0, length / 2 - 3 );
	ctx.stroke();
	ctx.restore();
}

function buildLeafClusterTexture(
	pixi: PixiNamespace,
	seedIndex: number,
): PixiTexture {
	const size = CLUSTER_TEX_SIZE;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}

	let s = 2654435769 + seedIndex * 2246822519;
	const rand = (): number => {
		s = ( s * 1664525 + 1013904223 ) % 4294967296;
		return s / 4294967296;
	};
	const blades =
		BLADES_PER_TEXTURE_MIN +
		Math.floor( rand() * ( BLADES_PER_TEXTURE_MAX - BLADES_PER_TEXTURE_MIN + 1 ) );
	const cx = size / 2;
	const cy = size * 0.62;
	for ( let b = 0; b < blades; b++ ) {
		const angle = -Math.PI / 2 + ( rand() - 0.5 ) * Math.PI * 1.15;
		const length = size * ( 0.34 + rand() * 0.24 );
		const reach = length * 0.32;
		drawBladeInto(
			ctx,
			cx + Math.cos( angle ) * reach + ( rand() - 0.5 ) * 8,
			cy + Math.sin( angle ) * reach,
			angle + Math.PI / 2 + ( rand() - 0.5 ) * 0.5,
			length,
			0.5 + ( b / blades ) * 0.45 + rand() * 0.08,
		);
	}
	return pixi.Texture.from( canvas );
}

export function buildLeafTexture( pixi: PixiNamespace ): PixiTexture {
	const size = LEAF_TEX_SIZE;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const cx = size / 2;

	const gradient = ctx.createLinearGradient( 0, 2, 0, size - 2 );
	gradient.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	gradient.addColorStop( 0.55, 'rgba(235, 235, 235, 0.96)' );
	gradient.addColorStop( 1, 'rgba(170, 170, 170, 0.9)' );
	ctx.fillStyle = gradient;
	ctx.beginPath();
	ctx.moveTo( cx, 2 );
	ctx.quadraticCurveTo( size - 6, size * 0.38, cx, size - 3 );
	ctx.quadraticCurveTo( 6, size * 0.38, cx, 2 );
	ctx.closePath();
	ctx.fill();

	ctx.strokeStyle = 'rgba(90, 90, 90, 0.35)';
	ctx.lineWidth = 1.4;
	ctx.beginPath();
	ctx.moveTo( cx, 5 );
	ctx.quadraticCurveTo( cx + 2, size / 2, cx, size - 6 );
	ctx.stroke();

	return pixi.Texture.from( canvas );
}

export class LeafGenerator {
	private readonly clusters: Cluster[] = [];
	private clusterTextures: PixiTexture[] | null = null;
	private readonly backLayer: PixiContainer;
	private readonly frontLayer: PixiContainer;
	private readonly pixi: PixiNamespace;
	private leafCount = 0;

	constructor(
		backLayer: PixiContainer,
		frontLayer: PixiContainer,
		pixi: PixiNamespace,
	) {
		this.backLayer = backLayer;
		this.frontLayer = frontLayer;
		this.pixi = pixi;
	}

	public populate(
		nodes: BranchNode[],
		hormones: Hormones,
		baseHue: number,
		snapshot: TreeSnapshot,
		rng: () => number,
	): void {
		this.clear();
		if ( nodes.length < 2 ) {
			return;
		}
		if ( ! this.clusterTextures ) {
			this.clusterTextures = [];
			for ( let v = 0; v < CLUSTER_TEX_VARIANTS; v++ ) {
				this.clusterTextures.push( buildLeafClusterTexture( this.pixi, v ) );
			}
		}

		let trunkBase = 1;
		let deepest = 0;
		let treeTop = 0;
		for ( const node of nodes ) {
			trunkBase = Math.max( trunkBase, node.radius );
			deepest = Math.max( deepest, node.depth );
			treeTop = Math.max( treeTop, -node.pos.y );
		}
		const shootRadius = leafyShootRadius( trunkBase );

		const minLeafDepth = Math.min( 1, deepest );
		const isLeaderTip = ( node: BranchNode ): boolean =>
			node.depth === 0 &&
			node.radius <= shootRadius * 0.55 &&
			-node.pos.y > treeTop * 0.6;
		const points: Array< {
			x: number;
			y: number;
			compliance: number;

			inner?: boolean;
		} > = [];
		for ( let idx = 1; idx < nodes.length; idx++ ) {
			const node = nodes[ idx ];
			if (
				node.parent === null ||
				( node.depth < minLeafDepth && ! isLeaderTip( node ) )
			) {
				continue;
			}

			if ( node.radius > shootRadius ) {
				if ( node.radius <= trunkBase * 0.62 && node.depth >= 1 ) {
					points.push( {
						x: node.pos.x,
						y: node.pos.y,
						compliance: node.compliance,
						inner: true,
					} );
				}
				continue;
			}
			points.push( { x: node.pos.x, y: node.pos.y, compliance: node.compliance } );
			const p = nodes[ node.parent ];
			if ( p.radius <= shootRadius * 1.4 && p.depth >= minLeafDepth ) {
				points.push( {
					x: ( node.pos.x + p.pos.x ) / 2,
					y: ( node.pos.y + p.pos.y ) / 2,
					compliance: ( node.compliance + p.compliance ) / 2,
				} );
			}
		}
		if ( points.length === 0 ) {
			return;
		}

		let treeHeight = 1;
		for ( const node of nodes ) {
			treeHeight = Math.max( treeHeight, -node.pos.y );
		}
		const leafScale = Math.min( 1.25, Math.max( 0.4, treeHeight / 520 ) );

		const vigorFill = 0.7 + 0.3 * Math.min( 1, Math.max( 0, hormones.vigor01 ) );
		const vitality = Math.min( 1, Math.max( 0, hormones.vitality01 ) );
		const budget = Math.min(
			Math.round( computeLeafBudget( hormones.foliage01 ) * vigorFill * 2.2 ),
			points.length * LEAVES_PER_CLUSTER * 2,
		);

		const clusterCount = Math.min( points.length, Math.max( 1, Math.floor( budget / 2 ) ) );
		const perCluster = Math.max( 2, Math.round( budget / clusterCount ) );
		const meanVisits = Math.max( 1, snapshot.traffic / Math.max( 1, snapshot.totalPosts ) );

		const order = points.slice();
		for ( let i = order.length - 1; i > 0; i-- ) {
			const j = Math.floor( rng() * ( i + 1 ) );
			[ order[ i ], order[ j ] ] = [ order[ j ], order[ i ] ];
		}

		const tuftFill = 0.8 + 0.8 * Math.min( 1, Math.max( 0, hormones.foliage01 ) );

		for ( let c = 0; c < clusterCount; c++ ) {
			const anchor = order[ c % order.length ];
			const clusterRadius = ( 13 + rng() * 9 ) * leafScale * tuftFill;
			const center = {
				x: anchor.x + ( rng() * 2 - 1 ) * 6 * leafScale,
				y: anchor.y + ( rng() * 2 - 1 ) * 6 * leafScale - clusterRadius * 0.2,
			};

			const hue = baseHue + ( rng() * 2 - 1 ) * TUFT_HUE_JITTER;
			const clusterAge = rng() * Math.max( 30, snapshot.siteAgeDays );
			const baseColor = leafColor( hue, hormones.health01, clusterAge );

			const cluster: Cluster = {
				center,
				compliance: anchor.compliance,
				radius: clusterRadius,
				leaves: [],
				delay: ( c / clusterCount ) * 1.6,
				age: 0,
				phase: rng() * Math.PI * 2,
			};

			for ( let i = 0; i < perCluster; i++ ) {
				const angle = rng() * Math.PI * 2;
				const dist = ( ( rng() + rng() ) / 2 ) * clusterRadius;
				const dx = Math.cos( angle ) * dist;
				const dy = Math.sin( angle ) * dist * 0.82;
				const visits = meanVisits * ( 0.25 + rng() * 1.5 );

				const size =
					( 22 + Math.log1p( visits ) * 5 ) * ( 0.75 + rng() * 0.5 ) * leafScale;

				const behind = anchor.inner === true || i % 3 === 0;
				const clusterTextureList = this.clusterTextures as PixiTexture[];
				const sprite = new this.pixi.Sprite(
					clusterTextureList[ Math.floor( rng() * clusterTextureList.length ) ],
				);
				sprite.anchor.set( 0.5 );

				let lightBase = behind ? 0.42 : 0.78;
				if ( anchor.inner === true ) {
					lightBase = 0.34;
				}
				const light =
					lightBase +
					0.42 * ( 0.5 - dy / ( clusterRadius * 2 ) ) +
					rng() * 0.12;
				sprite.tint = shade( baseColor, light );
				sprite.alpha = 0;
				sprite.scale.set( ( size * ( behind ? 1.25 : 1 ) ) / CLUSTER_TEX_SIZE );
				const baseRotation = ( rng() * 2 - 1 ) * Math.PI;
				sprite.rotation = baseRotation;
				( behind ? this.backLayer : this.frontLayer ).addChild( sprite );

				cluster.leaves.push( {
					sprite,
					dx,
					dy,
					baseRotation,
					phase: rng() * Math.PI * 2,
					alphaMax: ( behind ? 0.85 : 0.94 ) * ( 0.55 + 0.45 * vitality ),
					behind,
				} );
				this.leafCount++;
			}
			this.clusters.push( cluster );
		}
	}

	public update( dt: number, wind: WindField, t: number ): void {
		for ( const cluster of this.clusters ) {
			cluster.age += dt;
			const reveal = Math.min( 1, Math.max( 0, ( cluster.age - cluster.delay ) / 1.1 ) );
			if ( reveal <= 0 ) {
				continue;
			}

			const w = wind.sample( cluster.center.x, cluster.center.y, t );
			const cxNow = cluster.center.x + w.x * cluster.compliance;
			const cyNow = cluster.center.y + w.y * cluster.compliance;
			for ( const leaf of cluster.leaves ) {
				leaf.sprite.alpha = leaf.alphaMax * reveal;
				if ( leaf.behind ) {
					leaf.sprite.x = cxNow + leaf.dx;
					leaf.sprite.y = cyNow + leaf.dy;
					continue;
				}
				const shimmer = cluster.compliance;
				leaf.sprite.x =
					cxNow + leaf.dx + Math.sin( t * 2.8 + leaf.phase ) * 2.4 * shimmer;
				leaf.sprite.y =
					cyNow + leaf.dy + Math.cos( t * 2.1 + leaf.phase * 1.7 ) * 1.3 * shimmer;
				leaf.sprite.rotation =
					leaf.baseRotation +
					Math.sin( t * 3.1 + leaf.phase ) * 0.16 * shimmer;
			}
		}
	}

	public placements(): Array< { pos: Vec2; compliance: number; radius: number } > {
		return this.clusters.map( ( cluster ) => ( {
			pos: cluster.center,
			compliance: cluster.compliance,
			radius: cluster.radius,
		} ) );
	}

	public count(): number {
		return this.leafCount;
	}

	public sources( cap: number ): Array< { x: number; y: number; tint: number; size: number } > {
		const all: Array< { x: number; y: number; tint: number; size: number } > = [];
		for ( const cluster of this.clusters ) {
			for ( const leaf of cluster.leaves ) {
				if ( ! leaf.behind ) {
					all.push( {
						x: cluster.center.x + leaf.dx,
						y: cluster.center.y + leaf.dy,
						tint: leaf.sprite.tint,

						size: leaf.sprite.scale.x * CLUSTER_TEX_SIZE * 0.42,
					} );
				}
			}
		}
		if ( all.length <= cap ) {
			return all;
		}
		const step = all.length / cap;
		const out: Array< { x: number; y: number; tint: number; size: number } > = [];
		for ( let i = 0; i < cap; i++ ) {
			out.push( all[ Math.floor( i * step ) ] );
		}
		return out;
	}

	private clear(): void {
		for ( const cluster of this.clusters ) {
			for ( const leaf of cluster.leaves ) {
				( leaf.behind ? this.backLayer : this.frontLayer ).removeChild( leaf.sprite );
				leaf.sprite.destroy();
			}
		}
		this.clusters.length = 0;
		this.leafCount = 0;
	}

	public destroy(): void {
		this.clear();
		if ( this.clusterTextures ) {
			for ( const texture of this.clusterTextures ) {
				texture.destroy( true );
			}
			this.clusterTextures = null;
		}
	}
}
