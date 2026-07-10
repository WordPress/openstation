/**
 * The Living Tree — the meadow.
 *
 * The ground the tree stands on, built in four depth layers so it reads
 * as a place rather than a shadow:
 *
 *   1. soil mounds — soft radial-gradient sprites (no hard rims);
 *   2. a contact shadow hugging the trunk base;
 *   3. GRASS — hundreds of individually-drawn curved blades, grouped
 *      into clumps that sway gently around their own roots in the wind;
 *   4. a few fallen leaves settled near the trunk — the residue of the
 *      canopy's leaf-shed.
 *
 * Grass colour follows `health01` through the same leaf ramp the canopy
 * uses: a thriving site stands in green meadow, a neglected one in dry
 * straw. Layout draws from its own seeded PRNG (`<seed>|ground`) so the
 * meadow is stable per site without touching the skeleton's stream.
 *
 * @since 0.9.4
 */

import { hash32, mulberry32 } from '../rng';
import { leafColor } from '../palette';
import { buildLeafTexture } from './leaves';
import type {
	PixiContainer,
	PixiGraphics,
	PixiNamespace,
	PixiSprite,
	PixiTexture,
} from '../pixi-types';

/** Grass blades per clump. */
const BLADES_PER_CLUMP = 34;

/** Fallen leaves resting near the trunk. */
const FALLEN_LEAVES = 7;

/** Grass hue — meadow green, dried by low health via the leaf ramp. */
const GRASS_HUE = 96;

/** Multiply a packed RGB colour's channels by `f` (no bitwise ops). */
function shade( color: number, f: number ): number {
	const r = Math.min( 255, Math.round( ( Math.floor( color / 65536 ) % 256 ) * f ) );
	const g = Math.min( 255, Math.round( ( Math.floor( color / 256 ) % 256 ) * f ) );
	const b = Math.min( 255, Math.round( ( color % 256 ) * f ) );
	return r * 65536 + g * 256 + b;
}

/**
 * Rasterize a soft elliptical gradient once (white core → transparent
 * rim); tinted sprites of it build the soil mounds and contact shadow
 * with zero banding and no hard ellipse edges.
 */
function buildGroundGradientTexture( pixi: PixiNamespace ): PixiTexture {
	const w = 256;
	const h = 96;
	const canvas = document.createElement( 'canvas' );
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const gradient = ctx.createRadialGradient( w / 2, h / 2, 1, w / 2, h / 2, w / 2 );
	gradient.addColorStop( 0, 'rgba(255, 255, 255, 0.9)' );
	gradient.addColorStop( 0.5, 'rgba(255, 255, 255, 0.5)' );
	gradient.addColorStop( 0.8, 'rgba(255, 255, 255, 0.16)' );
	gradient.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
	ctx.save();
	ctx.translate( w / 2, h / 2 );
	ctx.scale( 1, h / w );
	ctx.translate( -w / 2, -h / 2 );
	ctx.fillStyle = gradient;
	ctx.fillRect( -w, -h, w * 3, h * 3 );
	ctx.restore();
	return pixi.Texture.from( canvas );
}

export interface GroundBuildOptions {
	/** Meadow half-width in reference units. */
	span: number;
	/** Trunk-base radius — sizes the contact shadow + clear patch. */
	trunkBase: number;
	/** SEO health, 0..1 — green meadow ↔ dry straw. */
	health01: number;
	/** Wind hormone, 0..1 — sway amplitude for the grass clumps. */
	wind01: number;
	/** Site identity (`siteUrl|siteName`) — seeds the meadow layout. */
	siteKey: string;
}

interface Clump {
	container: PixiContainer;
	phase: number;
	amplitude: number;
}

export class GroundLayer {
	private readonly layer: PixiContainer;
	private readonly pixi: PixiNamespace;
	private gradientTexture: PixiTexture | null = null;
	private leafTexture: PixiTexture | null = null;
	private readonly mounds: PixiSprite[] = [];
	private readonly clumps: Clump[] = [];
	private readonly litter: PixiSprite[] = [];
	private windStrength = 0;

	/**
	 * @param layer The ground layer (bottom of the tree body).
	 * @param pixi  The vendor Pixi namespace.
	 */
	constructor( layer: PixiContainer, pixi: PixiNamespace ) {
		this.layer = layer;
		this.pixi = pixi;
	}

	/**
	 * (Re)build the meadow. Deterministic for a given site + options.
	 *
	 * @param opts Meadow geometry + hormones.
	 */
	public build( opts: GroundBuildOptions ): void {
		this.clear();
		this.windStrength = Math.min( 1, Math.max( 0, opts.wind01 ) );
		const rng = mulberry32( hash32( `${ opts.siteKey }|ground` ) );
		this.gradientTexture = this.gradientTexture ?? buildGroundGradientTexture( this.pixi );

		const grass = leafColor( GRASS_HUE, opts.health01, 0 );
		// Soil sits DEEP below the grass tone — the dark base is what
		// grounds the whole scene against the sky gradient.
		const soil = shade( grass, 0.16 );

		// ── 1. Soil mounds — broad, layered, softly overlapping. ─────────
		const mound = (
			tint: number,
			alpha: number,
			w: number,
			h: number,
			x: number,
			y: number,
		): void => {
			const sprite = new this.pixi.Sprite( this.gradientTexture as PixiTexture );
			sprite.anchor.set( 0.5 );
			sprite.tint = tint;
			sprite.alpha = alpha;
			sprite.scale.x = w / 256;
			sprite.scale.y = h / 96;
			sprite.x = x;
			sprite.y = y;
			this.layer.addChild( sprite );
			this.mounds.push( sprite );
		};
		mound( soil, 0.95, opts.span * 2.8, 130, 0, 22 );
		mound( shade( grass, 0.34 ), 0.75, opts.span * 1.7, 70, -opts.span * 0.12, 8 );
		mound( shade( grass, 0.28 ), 0.7, opts.span * 1.2, 56, opts.span * 0.24, 12 );
		// 2. Contact shadow at the trunk.
		mound( 0x000000, 0.45, opts.trunkBase * 10 + 60, 30, 0, 4 );

		// ── 3. Grass — clumps of curved blades swaying around their own
		// roots. Denser near the tree, thinning toward the meadow's edge.
		// Stratified placement: one clump per horizontal slot (+ jitter)
		// so the lawn is CONTINUOUS — random draws bunched clumps in the
		// middle and left bald gaps at the edges.
		const clumpCount = Math.max( 16, Math.round( opts.span / 22 ) );
		const meadowHalf = opts.span * 1.15;
		const slotWidth = ( meadowHalf * 2 ) / clumpCount;
		for ( let c = 0; c < clumpCount; c++ ) {
			const spread =
				-meadowHalf + ( c + 0.5 ) * slotWidth + ( rng() - 0.5 ) * slotWidth * 0.8;
			const baseY = 2 + rng() * 12;
			const container = new this.pixi.Container();
			container.x = spread;
			container.y = baseY;

			const g = new this.pixi.Graphics();
			this.drawClumpBlades( g, rng, grass );
			container.addChild( g );
			this.layer.addChild( container );
			this.clumps.push( {
				container,
				phase: rng() * Math.PI * 2,
				amplitude: 0.012 + rng() * 0.014,
			} );
		}

		// ── 4. Fallen leaves settled near the trunk. ─────────────────────
		this.leafTexture = this.leafTexture ?? buildLeafTexture( this.pixi );
		for ( let i = 0; i < FALLEN_LEAVES; i++ ) {
			const sprite = new this.pixi.Sprite( this.leafTexture );
			sprite.anchor.set( 0.5 );
			// Dry autumn browns — litter must contrast with the lawn.
			sprite.tint = shade( leafColor( 46, 0.35, 2000 ), 1.1 );
			sprite.alpha = 0.8;
			const size = 13 + rng() * 8;
			sprite.scale.x = size / 48;
			// Squashed: a leaf lying flat, seen from our low angle.
			sprite.scale.y = ( size / 48 ) * 0.5;
			sprite.rotation = ( rng() * 2 - 1 ) * 0.5 + Math.PI / 2;
			// Scattered around the trunk but OUTSIDE its contact shadow,
			// where brown-on-dark would vanish.
			const side = rng() < 0.5 ? -1 : 1;
			sprite.x = side * ( opts.trunkBase * 3 + 30 + rng() * ( opts.trunkBase * 5 + 70 ) );
			sprite.y = 6 + rng() * 10;
			this.layer.addChild( sprite );
			this.litter.push( sprite );
		}
	}

	/**
	 * Draw one clump's blades into its Graphics: curved strokes leaning
	 * from a shared root, back blades darker, front blades brighter.
	 */
	private drawClumpBlades(
		g: PixiGraphics,
		rng: () => number,
		grass: number,
	): void {
		for ( let b = 0; b < BLADES_PER_CLUMP; b++ ) {
			const rootX = ( rng() * 2 - 1 ) * 34;
			const height = 9 + rng() * 19;
			const lean = ( rng() * 2 - 1 ) * 11;
			const midLean = lean * 0.35 + ( rng() * 2 - 1 ) * 2;
			// Depth cue: early (back) blades dark, later (front) bright.
			const depth = b / BLADES_PER_CLUMP;
			const color = shade( grass, 0.45 + depth * 0.6 + rng() * 0.1 );
			g.moveTo( rootX, 2 )
				.bezierCurveTo(
					rootX + midLean,
					-height * 0.45,
					rootX + lean * 0.8,
					-height * 0.8,
					rootX + lean,
					-height,
				)
				.stroke( {
					color,
					width: 1 + rng() * 0.9,
					alpha: 0.85,
					cap: 'round',
				} );
		}
	}

	/**
	 * Sway the clumps around their roots — subtle, wind-scaled.
	 *
	 * @param t Elapsed scene time (seconds).
	 */
	public update( t: number ): void {
		if ( this.windStrength <= 0 ) {
			return;
		}
		for ( const clump of this.clumps ) {
			clump.container.rotation =
				Math.sin( t * 1.3 + clump.phase ) * clump.amplitude * this.windStrength;
		}
	}

	private clear(): void {
		for ( const sprite of this.mounds ) {
			this.layer.removeChild( sprite );
			sprite.destroy();
		}
		this.mounds.length = 0;
		for ( const clump of this.clumps ) {
			this.layer.removeChild( clump.container );
			clump.container.destroy( { children: true } );
		}
		this.clumps.length = 0;
		for ( const sprite of this.litter ) {
			this.layer.removeChild( sprite );
			sprite.destroy();
		}
		this.litter.length = 0;
	}

	/** Release sprites + shared textures. */
	public destroy(): void {
		this.clear();
		if ( this.gradientTexture ) {
			try {
				this.gradientTexture.destroy( true );
			} catch {
				/* released with the app */
			}
			this.gradientTexture = null;
		}
		if ( this.leafTexture ) {
			try {
				this.leafTexture.destroy( true );
			} catch {
				/* released with the app */
			}
			this.leafTexture = null;
		}
	}
}
