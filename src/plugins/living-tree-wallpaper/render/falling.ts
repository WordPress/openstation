import { buildLeafTexture } from './leaves';
import type { PixiContainer, PixiNamespace, PixiSprite, PixiTexture } from '../pixi-types';
import type { WindField } from '../wind';

const MAX_CONCURRENT = 5;

const SPAWN_EVERY_MIN = 2.5;
const SPAWN_EVERY_SPREAD = 5;

const LEAF_TEX_SIZE = 48;

interface LeafSource {
	x: number;
	y: number;
	tint: number;
	size: number;
}

interface FallingLeaf {
	sprite: PixiSprite;
	active: boolean;
	y: number;
	x: number;
	fallSpeed: number;
	swayPhase: number;
	swayWidth: number;
	rotSpeed: number;
	fade: number;
}

export class FallingLeaves {
	private readonly layer: PixiContainer;
	private readonly pixi: PixiNamespace;
	private texture: PixiTexture | null = null;
	private readonly pool: FallingLeaf[] = [];
	private sources: LeafSource[] = [];
	private nextSpawn = SPAWN_EVERY_MIN;

	constructor( layer: PixiContainer, pixi: PixiNamespace ) {
		this.layer = layer;
		this.pixi = pixi;
	}

	public setSources( sources: LeafSource[] ): void {
		this.sources = sources;
	}

	public update( dt: number, wind: WindField, t: number ): void {
		this.nextSpawn -= dt;
		if ( this.nextSpawn <= 0 && this.sources.length > 0 ) {
			this.nextSpawn = SPAWN_EVERY_MIN + Math.random() * SPAWN_EVERY_SPREAD;
			this.release();
		}

		for ( const leaf of this.pool ) {
			if ( ! leaf.active ) {
				continue;
			}
			leaf.y += leaf.fallSpeed * dt;
			const w = wind.sample( leaf.x, leaf.y, t );
			leaf.x += ( w.x * 0.6 + Math.sin( t * 1.9 + leaf.swayPhase ) * leaf.swayWidth ) * dt;
			leaf.sprite.x = leaf.x;
			leaf.sprite.y = leaf.y;
			leaf.sprite.rotation += leaf.rotSpeed * dt;

			if ( leaf.y >= -4 ) {
				leaf.fade -= dt * 1.1;
				leaf.sprite.alpha = Math.max( 0, leaf.fade * 0.9 );
				if ( leaf.fade <= 0 ) {
					leaf.active = false;
					leaf.sprite.visible = false;
				}
			}
		}
	}

	private release(): void {
		const source = this.sources[ Math.floor( Math.random() * this.sources.length ) ];
		if ( ! source ) {
			return;
		}
		let leaf = this.pool.find( ( candidate ) => ! candidate.active ) ?? null;
		if ( ! leaf ) {
			if ( this.pool.length >= MAX_CONCURRENT ) {
				return;
			}
			this.texture = this.texture ?? buildLeafTexture( this.pixi );
			const sprite = new this.pixi.Sprite( this.texture );
			sprite.anchor.set( 0.5 );
			this.layer.addChild( sprite );
			leaf = {
				sprite,
				active: false,
				x: 0,
				y: 0,
				fallSpeed: 0,
				swayPhase: 0,
				swayWidth: 0,
				rotSpeed: 0,
				fade: 1,
			};
			this.pool.push( leaf );
		}

		leaf.active = true;
		leaf.x = source.x;
		leaf.y = source.y;
		leaf.fallSpeed = 26 + Math.random() * 22;
		leaf.swayPhase = Math.random() * Math.PI * 2;
		leaf.swayWidth = 14 + Math.random() * 16;
		leaf.rotSpeed = ( Math.random() * 2 - 1 ) * 3.2;
		leaf.fade = 1;
		leaf.sprite.tint = source.tint;
		leaf.sprite.scale.set( source.size / LEAF_TEX_SIZE );
		leaf.sprite.rotation = Math.random() * Math.PI * 2;
		leaf.sprite.alpha = 0.92;
		leaf.sprite.visible = true;
		leaf.sprite.x = leaf.x;
		leaf.sprite.y = leaf.y;
	}

	public destroy(): void {
		for ( const leaf of this.pool ) {
			this.layer.removeChild( leaf.sprite );
			leaf.sprite.destroy();
		}
		this.pool.length = 0;
		if ( this.texture ) {
			this.texture.destroy( true );
			this.texture = null;
		}
	}
}
