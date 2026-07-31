/**
 * The Living Tree — falling leaves.
 *
 * Every few seconds a leaf lets go of the canopy, tumbles down through
 * the wind, and fades into the grass. It's the cheapest realism trick in
 * the book: a static-canopied tree reads as a decoration; one that sheds
 * a leaf now and then reads as ALIVE. Deliberately sparse — a handful of
 * concurrent leaves, spawned from real canopy positions with real canopy
 * tints, so a drifting leaf always matches the tuft it left.
 *
 * IMPORTANT: fallers are COPIES. The canopy sprite it "detached" from is
 * never removed or hidden — stare at the tree for a year and it stays as
 * leafy as its DNA says. The illusion holds because a canopy tuft has
 * many overlapping leaves; one more drifting away implies no hole.
 *
 * Ambient motion, not DNA — like the fireflies, spawn timing uses
 * `Math.random()`; the skeleton's determinism is untouched. Under
 * reduced motion the ticker never runs, so nothing ever falls.
 */

import { buildLeafTexture } from './leaves';
import type { PixiContainer, PixiNamespace, PixiSprite, PixiTexture } from '../pixi-types';
import type { WindField } from '../wind';

/** Max leaves airborne at once — a shed, not a storm. */
const MAX_CONCURRENT = 5;

/** Seconds between release attempts (min + random spread). */
const SPAWN_EVERY_MIN = 2.5;
const SPAWN_EVERY_SPREAD = 5;

/** Leaf texture raster size (matches the canopy blade). */
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

	/**
	 * @param layer The lit-leaf layer (a falling leaf is still a leaf).
	 * @param pixi  The vendor Pixi namespace.
	 */
	constructor( layer: PixiContainer, pixi: PixiNamespace ) {
		this.layer = layer;
		this.pixi = pixi;
	}

	/**
	 * Point the shedder at the current canopy. An empty array (used
	 * while a new tree grows) stops new releases and lets airborne
	 * leaves finish their fall.
	 *
	 * @param sources Real canopy leaf samples from `LeafGenerator.sources()`.
	 */
	public setSources( sources: LeafSource[] ): void {
		this.sources = sources;
	}

	/**
	 * Advance the shed: release on schedule, tumble, land, recycle.
	 *
	 * @param dt   Delta time (seconds).
	 * @param wind The active wind field (fallers drift with it).
	 * @param t    Elapsed scene time (seconds).
	 */
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

			// Touch-down: settle just above the ground line, then fade.
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

	/** Detach one canopy leaf copy and let it go. */
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

	/** Release sprites + the shared texture. */
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
