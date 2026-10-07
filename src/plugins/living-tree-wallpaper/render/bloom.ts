import type { PixiContainer, PixiNamespace, PixiSprite, PixiTexture } from '../pixi-types';
import type { Vec2 } from '../types';

const FLOWER_TEX_SIZE = 40;

const FLOWER_TINTS = [ 0xfff1f5, 0xffd9e8, 0xffe9c9, 0xf7d4ff ];

interface Flower {
	sprite: PixiSprite;
	base: Vec2;
	compliance: number;
	phase: number;
	scale: number;
}

function buildFlowerTexture( pixi: PixiNamespace ): PixiTexture {
	const size = FLOWER_TEX_SIZE;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const c = size / 2;
	const petalR = size * 0.2;
	const orbit = size * 0.22;
	ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
	for ( let i = 0; i < 5; i++ ) {
		const a = ( i / 5 ) * Math.PI * 2 - Math.PI / 2;
		ctx.beginPath();
		ctx.arc( c + Math.cos( a ) * orbit, c + Math.sin( a ) * orbit, petalR, 0, Math.PI * 2 );
		ctx.fill();
	}
	ctx.fillStyle = 'rgba(255, 214, 120, 1)';
	ctx.beginPath();
	ctx.arc( c, c, size * 0.12, 0, Math.PI * 2 );
	ctx.fill();
	return pixi.Texture.from( canvas );
}

export class BloomEngine {
	private readonly flowers: Flower[] = [];
	private texture: PixiTexture | null = null;
	private readonly layer: PixiContainer;
	private readonly pixi: PixiNamespace;

	constructor( layer: PixiContainer, pixi: PixiNamespace ) {
		this.layer = layer;
		this.pixi = pixi;
	}

	public apply(
		bloom01: number,
		placements: Array< { pos: Vec2; compliance: number; radius?: number } >,
		rng: () => number,
	): void {
		this.clear();
		const fraction = Math.min( 1, Math.max( 0, bloom01 ) );
		if ( fraction === 0 || placements.length === 0 ) {
			return;
		}
		this.texture = this.texture ?? buildFlowerTexture( this.pixi );

		const perCluster = 1 + Math.round( fraction * 2 );
		const count = Math.min( 140, Math.round( placements.length * fraction * perCluster ) );

		const placed: Vec2[] = [];
		const MIN_GAP = 26;
		const MIN_GAP_SQ = MIN_GAP * MIN_GAP;
		for ( let i = 0; i < count; i++ ) {
			let base: Vec2 | null = null;
			for ( let attempt = 0; attempt < 4 && ! base; attempt++ ) {
				const p = placements[ Math.floor( rng() * placements.length ) ];
				const spread = ( p.radius ?? 12 ) * 1.3;
				const candidate = {
					x: p.pos.x + ( rng() * 2 - 1 ) * spread,
					y: p.pos.y + ( rng() * 2 - 1 ) * spread * 0.8,
					compliance: p.compliance,
					radius: p.radius ?? 12,
				};
				const crowded = placed.some( ( q ) => {
					const dx = q.x - candidate.x;
					const dy = q.y - candidate.y;
					return dx * dx + dy * dy < MIN_GAP_SQ;
				} );
				if ( ! crowded ) {
					base = candidate;
					const sprite = new this.pixi.Sprite( this.texture );
					sprite.anchor.set( 0.5 );
					sprite.tint =
						FLOWER_TINTS[ Math.floor( rng() * FLOWER_TINTS.length ) ];

					const scale =
						( candidate.radius * ( 0.32 + rng() * 0.22 ) ) / FLOWER_TEX_SIZE;
					sprite.scale.set( scale );
					sprite.alpha = 0;
					this.layer.addChild( sprite );
					placed.push( { x: candidate.x, y: candidate.y } );
					this.flowers.push( {
						sprite,
						base: { x: candidate.x, y: candidate.y },
						compliance: candidate.compliance,
						phase: rng() * Math.PI * 2,
						scale,
					} );
				}
			}
		}
	}

	public update(
		dt: number,
		t: number,
		displace: ( x: number, y: number ) => Vec2,
	): void {
		for ( const flower of this.flowers ) {
			flower.sprite.alpha = Math.min( 0.95, flower.sprite.alpha + dt * 0.5 );
			const pulse = 1 + 0.08 * Math.sin( t * 1.6 + flower.phase );
			flower.sprite.scale.set( flower.scale * pulse );
			const w = displace( flower.base.x, flower.base.y );
			flower.sprite.x = flower.base.x + w.x * flower.compliance;
			flower.sprite.y = flower.base.y + w.y * flower.compliance;
		}
	}

	private clear(): void {
		for ( const flower of this.flowers ) {
			this.layer.removeChild( flower.sprite );
			flower.sprite.destroy();
		}
		this.flowers.length = 0;
	}

	public destroy(): void {
		this.clear();
		if ( this.texture ) {
			this.texture.destroy( true );
			this.texture = null;
		}
	}
}
