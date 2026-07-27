/**
 * The Living Tree — foliage (posts).
 *
 * Placement, not mapping: never one-leaf-per-post. Leaf anchors are
 * chosen by WOOD THICKNESS, not position: any revealed node (or segment
 * midpoint) whose radius says "leafy shoot" carries foliage — outer twigs
 * AND the fine interior branches alike — so the canopy fills the whole
 * crown instead of rimming the branch ends. The trunk and thick boughs
 * stay bare because their girth disqualifies them.
 *
 * Canopy depth comes from real leaves, not glow: roughly a third of each
 * tuft renders BEHIND the branches, darker — silhouette foliage — while
 * the rest sits in front catching the light. (An earlier design used a
 * soft "puff" sprite behind each tuft; it read as a smudgy halo around
 * the wood and is gone.)
 *
 * The LOD cap (`computeLeafBudget( foliage01 )`) bounds total leaf
 * sprites; `postsPerLeaf` folds the surplus in. Hue is the site's own
 * canopy green (`canopyHue`) with small per-tuft variation — natural
 * foliage, not a data legend. Colour value comes from `health01`
 * (green → yellow → red → grey), size from `log( visits )`,
 * fullness/brightness from `vitality01`. Tufts fade in staggered once
 * growth settles. See `docs/living-tree-algorithm.md` §A.7.
 */

import { leafColor } from '../palette';
import type { PixiContainer, PixiNamespace, PixiSprite, PixiTexture } from '../pixi-types';
import type { BranchNode, Hormones, TreeSnapshot, Vec2 } from '../types';
import type { WindField } from '../wind';

/** LOD bounds — a sprout wears a handful, an oak up to 3200. */
const MIN_LEAVES = 6;
const MAX_LEAVES = 3200;

/**
 * Target leaves per tuft (soft — clamped by anchor points + budget).
 * Modest so the canopy is many overlapping tufts spread along the
 * branches rather than a few pom-poms at the tips.
 */
const LEAVES_PER_CLUSTER = 10;

/**
 * Natural per-tuft hue variation around the canopy base green (degrees).
 * Real foliage isn't one flat colour — but the variation is random and
 * subtle, never a data mapping.
 */
const TUFT_HUE_JITTER = 9;

/**
 * Wood no thicker than this carries leaves. Relative to the trunk —
 * Murray's law scales every radius with the trunk base, so an absolute
 * threshold silently disqualifies the whole canopy on a thick old tree.
 */
function leafyShootRadius( trunkBase: number ): number {
	return Math.max( 3.4, trunkBase * 0.3 );
}

/** Leaf texture raster size (scaled down per sprite). */
const LEAF_TEX_SIZE = 48;

interface ClusterLeaf {
	sprite: PixiSprite;
	dx: number;
	dy: number;
	baseRotation: number;
	phase: number;
	alphaMax: number;
	/** True when the leaf renders behind the wood (silhouette layer). */
	behind: boolean;
}

interface Cluster {
	center: Vec2;
	compliance: number;
	radius: number;
	leaves: ClusterLeaf[];
	/** Seconds until this tuft starts fading in (staggered leaf-out). */
	delay: number;
	age: number;
	phase: number;
}

/**
 * The LOD cap: how many leaf sprites a canopy of the given foliage level
 * carries. Pure — unit-tested as part of the topology-invariance suite
 * (content changes THIS, never the skeleton).
 *
 * @param foliage01 Canopy fill hormone, 0..1.
 * @return Sprite budget.
 */
export function computeLeafBudget( foliage01: number ): number {
	const f = Math.min( 1, Math.max( 0, foliage01 ) );
	return Math.round( MIN_LEAVES + ( MAX_LEAVES - MIN_LEAVES ) * Math.pow( f, 1.35 ) );
}

/** Multiply a packed RGB colour's channels by `f` (no bitwise ops). */
function shade( color: number, f: number ): number {
	const r = Math.min( 255, Math.round( ( Math.floor( color / 65536 ) % 256 ) * f ) );
	const g = Math.min( 255, Math.round( ( Math.floor( color / 256 ) % 256 ) * f ) );
	const b = Math.min( 255, Math.round( ( color % 256 ) * f ) );
	return r * 65536 + g * 256 + b;
}

/** Cluster texture raster size (a bundle of blades per sprite). */
const CLUSTER_TEX_SIZE = 96;

/** Distinct cluster arrangements — repetition reads as wallpaper. */
const CLUSTER_TEX_VARIANTS = 4;

/** Apparent blades baked into one cluster texture (density × sprites). */
const BLADES_PER_TEXTURE_MIN = 6;
const BLADES_PER_TEXTURE_MAX = 10;

/** Draw one blade path into a 2D context at the given transform. */
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

/**
 * Rasterize a CLUSTER of blades — 6–10 leaves fanned around a common
 * stem point, per-blade brightness baked in grayscale so a single tint
 * still colours the bundle with believable internal variation. One
 * sprite = one handful of leaves: apparent density multiplies without
 * adding scene-graph nodes.
 */
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
	// Deterministic per-variant layout (cheap LCG, bitwise-free).
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
		// Fan upward-ish from the stem, back blades dimmer.
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

/**
 * Rasterize a single leaf: a pointed blade with a lit tip, shaded base,
 * and a faint centre vein. Drawn white so per-sprite tint colours it.
 * Exported — the falling-leaves layer shares the exact same blade.
 */
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

	// Blade: two mirrored quadratic arcs meeting at tip + stem point.
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

	// Centre vein.
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

	/**
	 * @param backLayer  Silhouette-foliage layer BEHIND the branches.
	 * @param frontLayer Lit-leaf layer in front of the branches.
	 * @param pixi       The vendor Pixi namespace.
	 */
	constructor(
		backLayer: PixiContainer,
		frontLayer: PixiContainer,
		pixi: PixiNamespace,
	) {
		this.backLayer = backLayer;
		this.frontLayer = frontLayer;
		this.pixi = pixi;
	}

	/**
	 * Populate the canopy on every leafy shoot of the revealed skeleton.
	 *
	 * @param nodes    The revealed skeleton (radius filled by computeGirth).
	 * @param hormones Foliage / health / vigour / vitality drive the look.
	 * @param baseHue  The site's canopy green (`canopyHue`), 0..360.
	 * @param snapshot The snapshot (post/visit aggregates size the leaves).
	 * @param rng      Seeded PRNG so a reload keeps the same canopy.
	 */
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

		// Anchors: ANY revealed segment whose wood is a leafy shoot —
		// interior fine branches included. TWO gates, both required:
		//   - girth: thin wood only (disqualifies boughs);
		//   - depth: at least two forks from the trunk — the trunk's own
		//     upper run is thin too, and thickness alone was hanging
		//     leaves straight on the main stem.
		// Segment midpoints double the coverage so foliage runs the
		// length of every shoot.
		let trunkBase = 1;
		let deepest = 0;
		let treeTop = 0;
		for ( const node of nodes ) {
			trunkBase = Math.max( trunkBase, node.radius );
			deepest = Math.max( deepest, node.depth );
			treeTop = Math.max( treeTop, -node.pos.y );
		}
		const shootRadius = leafyShootRadius( trunkBase );
		// Depth 0 is the trunk's own chain — bare by definition, even
		// where it thins near the apex. Everything past the first fork
		// (depth ≥ 1) may carry leaves if its girth qualifies. (A depth-2
		// floor was tried and stripped whole upper limbs bald.)
		// EXCEPTION: the leader's crown tip — the top of the depth-0
		// chain, thin and high in the canopy — leafs out like any shoot,
		// or it pokes through the crown as a bare stick.
		const minLeafDepth = Math.min( 1, deepest );
		const isLeaderTip = ( node: BranchNode ): boolean =>
			node.depth === 0 &&
			node.radius <= shootRadius * 0.55 &&
			-node.pos.y > treeTop * 0.6;
		const points: Array< {
			x: number;
			y: number;
			compliance: number;
			/** Silhouette fill on thick inner wood — back layer only. */
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
			// Thick inner wood (the base third of every limb) can't carry
			// front foliage — but bare crotches read as HOLES in the
			// crown. Give those segments back-layer silhouette tufts:
			// foliage from twigs BEHIND the limb, filling the gap without
			// hiding the branch structure.
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

		// Leaf + tuft sizing scales with the tree's actual extent, so a
		// sprout wears small leaves (not boulders) and an oak wears full
		// ones.
		let treeHeight = 1;
		for ( const node of nodes ) {
			treeHeight = Math.max( treeHeight, -node.pos.y );
		}
		const leafScale = Math.min( 1.25, Math.max( 0.4, treeHeight / 520 ) );

		// Density responds to content: foliage01 (post count) sets the LOD
		// cap, vigour (busy + fast site) fills it out, vitality dims a
		// struggling canopy.
		const vigorFill = 0.7 + 0.3 * Math.min( 1, Math.max( 0, hormones.vigor01 ) );
		const vitality = Math.min( 1, Math.max( 0, hormones.vitality01 ) );
		const budget = Math.min(
			Math.round( computeLeafBudget( hormones.foliage01 ) * vigorFill * 2.2 ),
			points.length * LEAVES_PER_CLUSTER * 2,
		);
		// EVERY shoot gets a tuft when the budget allows — full coverage
		// is what gives the crown volume; a bare mini-branch reads as a
		// mistake. Only a genuinely content-poor site drops twigs (its
		// canopy SHOULD be sparse); everyone else adjusts leaves-per-tuft
		// instead of skipping twigs.
		const clusterCount = Math.min( points.length, Math.max( 1, Math.floor( budget / 2 ) ) );
		const perCluster = Math.max( 2, Math.round( budget / clusterCount ) );
		const meanVisits = Math.max( 1, snapshot.traffic / Math.max( 1, snapshot.totalPosts ) );

		// Deterministic point shuffle (Fisher–Yates on the seeded PRNG) so
		// tufts spread across the whole canopy rather than the first N.
		const order = points.slice();
		for ( let i = order.length - 1; i > 0; i-- ) {
			const j = Math.floor( rng() * ( i + 1 ) );
			[ order[ i ], order[ j ] ] = [ order[ j ], order[ i ] ];
		}

		// Fuller sites grow fuller tufts: radius swells with foliage01 so
		// neighbouring tufts overlap and merge into one continuous canopy
		// mass instead of leaf sleeves along the wood.
		const tuftFill = 0.8 + 0.8 * Math.min( 1, Math.max( 0, hormones.foliage01 ) );

		for ( let c = 0; c < clusterCount; c++ ) {
			const anchor = order[ c % order.length ];
			const clusterRadius = ( 13 + rng() * 9 ) * leafScale * tuftFill;
			const center = {
				x: anchor.x + ( rng() * 2 - 1 ) * 6 * leafScale,
				y: anchor.y + ( rng() * 2 - 1 ) * 6 * leafScale - clusterRadius * 0.2,
			};
			// Natural variation only: every tuft leans a few degrees off
			// the site's base green. (Categories used to paint the crown
			// in hue wedges — unrealistic; they bloom as meadow
			// wildflowers now.)
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
				// Gaussian-ish offset: two rng draws pull leaves toward
				// the tuft core, denser inside, wispy at the rim.
				const angle = rng() * Math.PI * 2;
				const dist = ( ( rng() + rng() ) / 2 ) * clusterRadius;
				const dx = Math.cos( angle ) * dist;
				const dy = Math.sin( angle ) * dist * 0.82;
				const visits = meanVisits * ( 0.25 + rng() * 1.5 );
				// A bundle sprite is a HANDFUL of leaves — larger footprint
				// than the old single blade, same scene-graph cost.
				const size =
					( 22 + Math.log1p( visits ) * 5 ) * ( 0.75 + rng() * 0.5 ) * leafScale;

				// Canopy depth: about a third of each tuft is silhouette
				// foliage behind the wood, the rest catches the light in
				// front. Inner-fill tufts (thick-wood bases) are silhouette
				// ONLY — they populate the crotch gaps from "behind" the
				// limb without hiding the branch structure.
				const behind = anchor.inner === true || i % 3 === 0;
				const clusterTextureList = this.clusterTextures as PixiTexture[];
				const sprite = new this.pixi.Sprite(
					clusterTextureList[ Math.floor( rng() * clusterTextureList.length ) ],
				);
				sprite.anchor.set( 0.5 );
				// Per-bundle light: bundles above the tuft core catch the
				// sky, ones below sit in their own shadow; back-layer
				// bundles live in the crown's own shade.
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

	/**
	 * Per-frame update: staggered fade-in, wind displacement per tuft
	 * (× compliance), and a subtle per-leaf rotation flutter.
	 *
	 * @param dt   Delta time (seconds).
	 * @param wind The active wind field.
	 * @param t    Elapsed scene time (seconds).
	 */
	public update( dt: number, wind: WindField, t: number ): void {
		for ( const cluster of this.clusters ) {
			cluster.age += dt;
			const reveal = Math.min( 1, Math.max( 0, ( cluster.age - cluster.delay ) / 1.1 ) );
			if ( reveal <= 0 ) {
				continue;
			}
			// Foliage carries the whole wind story (the wood is static) —
			// tuft sway plus an independent per-leaf shimmer. Back-layer
			// silhouette leaves ride the tuft only: their flutter is
			// invisible behind the wood, so we don't pay for it.
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

	/** Tuft placements — the blossom layer anchors to these. */
	public placements(): Array< { pos: Vec2; compliance: number; radius: number } > {
		return this.clusters.map( ( cluster ) => ( {
			pos: cluster.center,
			compliance: cluster.compliance,
			radius: cluster.radius,
		} ) );
	}

	/** Number of live leaf sprites (observability + tests). */
	public count(): number {
		return this.leafCount;
	}

	/**
	 * A sample of real canopy leaves (position / tint / size) — the
	 * falling-leaves layer detaches copies of THESE, so a drifting leaf
	 * always matches the canopy it left.
	 *
	 * @param cap Max samples to return, spread evenly across the canopy.
	 */
	public sources( cap: number ): Array< { x: number; y: number; tint: number; size: number } > {
		const all: Array< { x: number; y: number; tint: number; size: number } > = [];
		for ( const cluster of this.clusters ) {
			for ( const leaf of cluster.leaves ) {
				if ( ! leaf.behind ) {
					all.push( {
						x: cluster.center.x + leaf.dx,
						y: cluster.center.y + leaf.dy,
						tint: leaf.sprite.tint,
						// A faller is ONE leaf, not the whole bundle — hand
						// the shed a single-blade-sized sample.
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

	/** Release sprites + the shared texture. */
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
