/**
 * The Living Tree — butterflies (tags).
 *
 * Tags cross-pollinate content across categories, so they render as the
 * pollinators: a handful of butterflies working the category wildflowers
 * — flying flower to flower, perching with slow wing-pumps, banking with
 * their own flight. Count and wing-colour variety scale with the tag
 * count (`computeButterflyCount`, hard-capped at {@link MAX_BUTTERFLIES})
 * — a folksonomy is a busy meadow, never a swarm. The daytime complement
 * of the fireflies: they live inside the tree body, so night dims them
 * exactly as the fireflies wake.
 *
 * One sprite per butterfly; the wing-flap is a `scale.x` fold along the
 * body axis — no extra scene-graph nodes, no filters. Colours and first
 * perches draw from the seeded PRNG (same site → same kaleidoscope);
 * the wandering itself uses `Math.random()` like the fireflies do —
 * flight is live behaviour, not DNA. See
 * `docs/living-tree-algorithm.md` §A.8.
 */

import type { PixiContainer, PixiNamespace, PixiSprite, PixiTexture } from '../pixi-types';
import type { Vec2 } from '../types';

/** Hard cap — a meadow's worth of pollinators, not a swarm. */
const MAX_BUTTERFLIES = 8;

/** Butterfly texture raster size (wings spread, top view). */
const TEX_W = 72;
const TEX_H = 56;

/** Cruise speed, reference units / second. */
const CRUISE_SPEED = 58;

/**
 * Wing colours — monarch orange, morpho blue, sulphur yellow, cabbage
 * white, purple emperor. More tags unlock more of the set.
 */
const WING_COLORS = [ 0xe08a3c, 0x5f9fe0, 0xe6cf6e, 0xf0ede2, 0xa583d8 ];

interface Butterfly {
	sprite: PixiSprite;
	pos: Vec2;
	vel: Vec2;
	target: Vec2;
	/** Seconds left perched on a flower; 0 while flying. */
	dwell: number;
	/** Whether the current target is a flower head (perchable). */
	perchable: boolean;
	flapPhase: number;
	bobPhase: number;
	scale: number;
}

/**
 * How many butterflies a folksonomy of the given size attracts.
 * Saturating with a floor of two (one tag already earns a pair) and the
 * {@link MAX_BUTTERFLIES} cap. Pure — unit-tested alongside the other
 * decoration budgets.
 *
 * @param totalTags Tag count from the snapshot.
 * @return Number of butterflies.
 */
export function computeButterflyCount( totalTags: number ): number {
	const tags = Math.max( 0, Math.floor( totalTags ) );
	if ( tags === 0 ) {
		return 0;
	}
	return Math.min(
		MAX_BUTTERFLIES,
		Math.max( 2, 2 + Math.round( 6 * ( tags / ( tags + 40 ) ) ) ),
	);
}

/** Multiply a packed RGB colour's channels by `f` (no bitwise ops). */
function shade( color: number, f: number ): number {
	const r = Math.min( 255, Math.round( ( Math.floor( color / 65536 ) % 256 ) * f ) );
	const g = Math.min( 255, Math.round( ( Math.floor( color / 256 ) % 256 ) * f ) );
	const b = Math.min( 255, Math.round( ( color % 256 ) * f ) );
	return r * 65536 + g * 256 + b;
}

/** Packed 0xRRGGBB → CSS `rgba()` string. */
function css( color: number, alpha = 1 ): string {
	const r = Math.floor( color / 65536 ) % 256;
	const g = Math.floor( color / 256 ) % 256;
	const b = color % 256;
	return `rgba(${ r }, ${ g }, ${ b }, ${ alpha })`;
}

/** One wing (fore + hind lobe) on the given side, gradient-lit. */
function drawWing(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	side: number,
	color: number,
): void {
	const light = shade( color, 1.25 );
	const deep = shade( color, 0.62 );

	// Forewing: a swept teardrop reaching up and out.
	ctx.save();
	ctx.translate( cx, cy );
	ctx.scale( side, 1 );
	let gradient = ctx.createRadialGradient( 4, -2, 2, 18, -12, 22 );
	gradient.addColorStop( 0, css( light ) );
	gradient.addColorStop( 0.72, css( color ) );
	gradient.addColorStop( 1, css( deep ) );
	ctx.fillStyle = gradient;
	ctx.beginPath();
	ctx.moveTo( 2, -1 );
	ctx.bezierCurveTo( 10, -22, 30, -26, 33, -16 );
	ctx.bezierCurveTo( 34, -8, 26, -2, 2, 1 );
	ctx.closePath();
	ctx.fill();

	// Hindwing: a rounder lobe below, slightly deeper in tone.
	gradient = ctx.createRadialGradient( 3, 4, 2, 14, 12, 18 );
	gradient.addColorStop( 0, css( color ) );
	gradient.addColorStop( 1, css( deep ) );
	ctx.fillStyle = gradient;
	ctx.beginPath();
	ctx.moveTo( 2, 2 );
	ctx.bezierCurveTo( 18, 2, 24, 12, 18, 19 );
	ctx.bezierCurveTo( 12, 24, 4, 16, 2, 6 );
	ctx.closePath();
	ctx.fill();

	// Two pale spots along the forewing edge.
	ctx.fillStyle = css( 0xffffff, 0.75 );
	ctx.beginPath();
	ctx.arc( 24, -16, 2.2, 0, Math.PI * 2 );
	ctx.fill();
	ctx.beginPath();
	ctx.arc( 29, -12, 1.5, 0, Math.PI * 2 );
	ctx.fill();
	ctx.restore();
}

/** Rasterize one butterfly (wings spread, top view) per wing colour. */
function buildButterflyTexture( pixi: PixiNamespace, color: number ): PixiTexture {
	const canvas = document.createElement( 'canvas' );
	canvas.width = TEX_W;
	canvas.height = TEX_H;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const cx = TEX_W / 2;
	const cy = TEX_H / 2 + 2;
	drawWing( ctx, cx, cy, -1, color );
	drawWing( ctx, cx, cy, 1, color );

	// Body: a slim dark ellipse plus two antennae.
	ctx.fillStyle = css( 0x2e2620 );
	ctx.save();
	ctx.translate( cx, cy );
	ctx.scale( 1, 4.2 );
	ctx.beginPath();
	ctx.arc( 0, 0, 2.2, 0, Math.PI * 2 );
	ctx.fill();
	ctx.restore();
	ctx.strokeStyle = css( 0x2e2620, 0.9 );
	ctx.lineWidth = 1;
	for ( const side of [ -1, 1 ] ) {
		ctx.beginPath();
		ctx.moveTo( cx, cy - 8 );
		ctx.quadraticCurveTo( cx + side * 3, cy - 14, cx + side * 6, cy - 16 );
		ctx.stroke();
	}
	return pixi.Texture.from( canvas );
}

export interface ButterflyBounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

export class ButterflyLayer {
	private readonly butterflies: Butterfly[] = [];
	private readonly textures = new Map< number, PixiTexture >();
	private readonly layer: PixiContainer;
	private readonly pixi: PixiNamespace;
	private targetPool: Vec2[] = [];
	private roam: ButterflyBounds = { minX: -100, maxX: 100, minY: -120, maxY: 0 };

	/**
	 * @param layer The butterfly layer (front of the tree body).
	 * @param pixi  The vendor Pixi namespace.
	 */
	constructor( layer: PixiContainer, pixi: PixiNamespace ) {
		this.layer = layer;
		this.pixi = pixi;
	}

	/**
	 * (Re)hatch the butterflies. Each starts perched on (or heading to) a
	 * flower; colours cycle through the unlocked slice of the wing set.
	 *
	 * @param totalTags Tag count — drives population + colour variety.
	 * @param targets   Flower-head waypoints from `FlowerField.targets()`.
	 * @param roam      Airspace for non-flower waypoints (meadow + lower crown).
	 * @param rng       Seeded PRNG — colours and first perches are DNA.
	 */
	public populate(
		totalTags: number,
		targets: Vec2[],
		roam: ButterflyBounds,
		rng: () => number,
	): void {
		this.clear();
		this.targetPool = targets.map( ( p ) => ( { x: p.x, y: p.y } ) );
		this.roam = roam;
		const count = computeButterflyCount( totalTags );
		if ( count === 0 ) {
			return;
		}
		const varieties = Math.max(
			1,
			Math.min( WING_COLORS.length, Math.ceil( ( count * WING_COLORS.length ) / MAX_BUTTERFLIES ) ),
		);
		for ( let i = 0; i < count; i++ ) {
			const color = WING_COLORS[ i % varieties ];
			let texture = this.textures.get( color );
			if ( ! texture ) {
				texture = buildButterflyTexture( this.pixi, color );
				this.textures.set( color, texture );
			}
			const sprite = new this.pixi.Sprite( texture );
			sprite.anchor.set( 0.5, 0.5 );
			const scale = 0.24 + rng() * 0.1;
			sprite.scale.set( scale );
			const start = this.pickTarget( rng );
			sprite.x = start.point.x;
			sprite.y = start.point.y;
			// Perched from frame one — under reduced motion this IS the
			// still frame, and it reads as rest, not freeze.
			this.layer.addChild( sprite );
			this.butterflies.push( {
				sprite,
				pos: { x: start.point.x, y: start.point.y },
				vel: { x: 0, y: 0 },
				target: start.point,
				dwell: start.perchable ? 1 + rng() * 3 : 0,
				perchable: start.perchable,
				flapPhase: rng() * Math.PI * 2,
				bobPhase: rng() * Math.PI * 2,
				scale,
			} );
		}
	}

	/** Next waypoint: usually a flower, sometimes open air. */
	private pickTarget( rand: () => number ): { point: Vec2; perchable: boolean } {
		if ( this.targetPool.length > 0 && rand() < 0.68 ) {
			const p = this.targetPool[ Math.floor( rand() * this.targetPool.length ) ];
			return { point: { x: p.x, y: p.y }, perchable: true };
		}
		return {
			point: {
				x: this.roam.minX + rand() * ( this.roam.maxX - this.roam.minX ),
				y: this.roam.minY + rand() * ( this.roam.maxY - this.roam.minY ),
			},
			perchable: false,
		};
	}

	/**
	 * Per-frame update (full rate — the flap needs it, and there are at
	 * most {@link MAX_BUTTERFLIES} sprites): seek the current waypoint
	 * with a bobbing flutter, perch and pump on flowers, then move on.
	 *
	 * @param dt Delta time (seconds).
	 * @param t  Elapsed scene time (seconds).
	 */
	public update( dt: number, t: number ): void {
		for ( const b of this.butterflies ) {
			if ( b.dwell > 0 ) {
				// Perched: wings folded, pumping slowly.
				b.dwell -= dt;
				b.flapPhase += dt * 2.6;
				b.sprite.scale.x =
					b.scale * ( 0.22 + 0.18 * Math.abs( Math.cos( b.flapPhase ) ) );
				b.sprite.rotation = 0;
				if ( b.dwell <= 0 ) {
					const next = this.pickTarget( Math.random );
					b.target = next.point;
					b.perchable = next.perchable;
				}
				continue;
			}

			// Steer toward the waypoint with a vertical flutter-bob.
			const dx = b.target.x - b.pos.x;
			const dy = b.target.y - b.pos.y;
			const dist = Math.hypot( dx, dy );
			if ( dist < 9 ) {
				if ( b.perchable ) {
					b.pos.x = b.target.x;
					b.pos.y = b.target.y;
					b.vel.x = 0;
					b.vel.y = 0;
					b.dwell = 1.5 + Math.random() * 3.5;
				} else {
					const next = this.pickTarget( Math.random );
					b.target = next.point;
					b.perchable = next.perchable;
				}
			} else {
				const speed = CRUISE_SPEED * Math.min( 1, 0.35 + dist / 90 );
				const ux = dx / dist;
				const uy = dy / dist;
				const ease = Math.min( 1, dt * 2.2 );
				b.vel.x += ( ux * speed - b.vel.x ) * ease;
				b.vel.y += ( uy * speed - b.vel.y ) * ease;
				b.pos.x += b.vel.x * dt;
				b.pos.y +=
					b.vel.y * dt + Math.sin( t * 6.5 + b.bobPhase ) * 14 * dt;
			}

			b.flapPhase += dt * ( 13 + 3 * Math.sin( t * 0.9 + b.bobPhase ) );
			b.sprite.x = b.pos.x;
			b.sprite.y = b.pos.y;
			// Fold along the body axis = the flap; bank into the motion.
			b.sprite.scale.x =
				b.scale * ( 0.3 + 0.7 * Math.abs( Math.cos( b.flapPhase ) ) );
			b.sprite.rotation = Math.max( -0.35, Math.min( 0.35, b.vel.x * 0.005 ) );
		}
	}

	/** Number of live butterflies (observability + tests). */
	public count(): number {
		return this.butterflies.length;
	}

	/** Remove every butterfly (textures stay cached for the next hatch). */
	public clear(): void {
		for ( const b of this.butterflies ) {
			this.layer.removeChild( b.sprite );
			b.sprite.destroy();
		}
		this.butterflies.length = 0;
	}

	/** Release sprites + the shared textures. */
	public destroy(): void {
		this.clear();
		for ( const texture of this.textures.values() ) {
			try {
				texture.destroy( true );
			} catch {
				/* released with the app */
			}
		}
		this.textures.clear();
	}
}
