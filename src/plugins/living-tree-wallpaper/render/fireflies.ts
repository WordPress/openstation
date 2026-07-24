/**
 * The Living Tree — fireflies (online users).
 *
 * `spark` particles with an additive glow drifting through the canopy;
 * the count follows live presence. Each firefly wanders toward a slowly
 * re-rolled target inside the crown box and twinkles on its own phase.
 * See `docs/living-tree-algorithm.md` §A.8.
 *
 * @since 0.9.4
 */

import type { PixiContainer, PixiNamespace, PixiSprite, PixiTexture } from '../pixi-types';

/** Glow texture raster size. */
const GLOW_TEX_SIZE = 32;

interface Firefly {
	sprite: PixiSprite;
	x: number;
	y: number;
	tx: number;
	ty: number;
	phase: number;
	retarget: number;
}

interface CrownBounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

/** Rasterize the warm glow dot once; every firefly shares it. */
function buildGlowTexture( pixi: PixiNamespace ): PixiTexture {
	const size = GLOW_TEX_SIZE;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const c = size / 2;
	const gradient = ctx.createRadialGradient( c, c, 0, c, c, c );
	gradient.addColorStop( 0, 'rgba(255, 244, 180, 1)' );
	gradient.addColorStop( 0.3, 'rgba(255, 224, 120, 0.7)' );
	gradient.addColorStop( 1, 'rgba(255, 200, 60, 0)' );
	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, size, size );
	return pixi.Texture.from( canvas );
}

export class FireflyLayer {
	private readonly flies: Firefly[] = [];
	private texture: PixiTexture | null = null;
	private bounds: CrownBounds = { minX: -80, maxX: 80, minY: -220, maxY: -40 };

	private readonly layer: PixiContainer;
	private readonly pixi: PixiNamespace;

	/**
	 * @param layer The firefly layer (front-most, additive).
	 * @param pixi  The vendor Pixi namespace.
	 */
	constructor( layer: PixiContainer, pixi: PixiNamespace ) {
		this.layer = layer;
		this.pixi = pixi;
	}

	/**
	 * Constrain wandering to the crown region.
	 *
	 * @param bounds The crown bounding box in reference space.
	 */
	public setBounds( bounds: CrownBounds ): void {
		this.bounds = bounds;
	}

	/**
	 * Set the number of fireflies; spawns / retires sprites to match.
	 *
	 * @param n Firefly count (from the `spark` hormone).
	 */
	public setCount( n: number ): void {
		const target = Math.max( 0, Math.round( n ) );
		while ( this.flies.length > target ) {
			const fly = this.flies.pop();
			if ( fly ) {
				this.layer.removeChild( fly.sprite );
				fly.sprite.destroy();
			}
		}
		if ( this.flies.length < target ) {
			this.texture = this.texture ?? buildGlowTexture( this.pixi );
			while ( this.flies.length < target ) {
				const sprite = new this.pixi.Sprite( this.texture );
				sprite.anchor.set( 0.5 );
				sprite.blendMode = 'add';
				sprite.scale.set( ( 6 + Math.random() * 5 ) / GLOW_TEX_SIZE );
				const x = this.randomX();
				const y = this.randomY();
				sprite.x = x;
				sprite.y = y;
				this.layer.addChild( sprite );
				this.flies.push( {
					sprite,
					x,
					y,
					tx: this.randomX(),
					ty: this.randomY(),
					phase: Math.random() * Math.PI * 2,
					retarget: 2 + Math.random() * 4,
				} );
			}
		}
	}

	/**
	 * Per-frame drift + twinkle.
	 *
	 * @param dt Delta time (seconds).
	 * @param t  Elapsed scene time (seconds).
	 */
	public update( dt: number, t: number ): void {
		for ( const fly of this.flies ) {
			fly.retarget -= dt;
			if ( fly.retarget <= 0 ) {
				fly.tx = this.randomX();
				fly.ty = this.randomY();
				fly.retarget = 2 + Math.random() * 4;
			}
			// Lazy homing: ease toward the target with a wobble on top.
			fly.x += ( fly.tx - fly.x ) * dt * 0.4 + Math.sin( t * 2.2 + fly.phase ) * 0.35;
			fly.y += ( fly.ty - fly.y ) * dt * 0.4 + Math.cos( t * 1.7 + fly.phase ) * 0.3;
			fly.sprite.x = fly.x;
			fly.sprite.y = fly.y;
			fly.sprite.alpha = 0.35 + 0.6 * ( 0.5 + 0.5 * Math.sin( t * 2.6 + fly.phase * 3 ) );
		}
	}

	private randomX(): number {
		return this.bounds.minX + Math.random() * ( this.bounds.maxX - this.bounds.minX );
	}

	private randomY(): number {
		return this.bounds.minY + Math.random() * ( this.bounds.maxY - this.bounds.minY );
	}

	/** Release sprites + the shared texture. */
	public destroy(): void {
		this.setCount( 0 );
		if ( this.texture ) {
			this.texture.destroy( true );
			this.texture = null;
		}
	}
}
