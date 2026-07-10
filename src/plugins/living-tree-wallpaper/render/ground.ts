/**
 * The Living Tree — the meadow.
 *
 * The ground the tree stands on, built in four depth layers so it reads
 * as a place rather than a shadow:
 *
 *   1. soil mounds — soft radial-gradient sprites (no hard rims);
 *   2. a contact shadow hugging the trunk base;
 *   3. GRASS — thousands of individually-drawn curved blades filling
 *      the whole ground region, tessellated ONCE into a single static
 *      Graphics (the swaying-clump version cost a live scene-graph
 *      object per clump and made steady-state frames expensive);
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
	/**
	 * Half the visible canvas width in reference units — the meadow
	 * always reaches the screen edges, however wide the desktop is.
	 */
	coverHalfWidth: number;
	/**
	 * Depth of the visible ground region in reference units (from the
	 * ground line to the canvas bottom). The turf FILLS this — rows of
	 * clumps all the way down, so no bare soil is ever visible.
	 */
	coverDepth: number;
	/** Trunk-base radius — sizes the contact shadow + clear patch. */
	trunkBase: number;
	/** SEO health, 0..1 — green meadow ↔ dry straw. */
	health01: number;
	/** Site identity (`siteUrl|siteName`) — seeds the meadow layout. */
	siteKey: string;
}

export class GroundLayer {
	private readonly layer: PixiContainer;
	private readonly pixi: PixiNamespace;
	private gradientTexture: PixiTexture | null = null;
	private leafTexture: PixiTexture | null = null;
	private readonly mounds: PixiSprite[] = [];
	private turf: PixiGraphics | null = null;
	private readonly litter: PixiSprite[] = [];

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
		const rng = mulberry32( hash32( `${ opts.siteKey }|ground` ) );
		this.gradientTexture = this.gradientTexture ?? buildGroundGradientTexture( this.pixi );

		const grass = leafColor( GRASS_HUE, opts.health01, 0 );
		// Soil sits DEEP below the grass tone — the dark base is what
		// grounds the whole scene against the sky gradient.
		const soil = shade( grass, 0.16 );
		// The lawn runs to the screen edges no matter how the tree fits.
		const meadowHalf = Math.max( opts.span * 1.15, opts.coverHalfWidth );

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
		mound( soil, 0.95, meadowHalf * 2.6, 130, 0, 22 );
		mound( shade( grass, 0.34 ), 0.75, meadowHalf * 1.7, 70, -meadowHalf * 0.12, 8 );
		mound( shade( grass, 0.28 ), 0.7, meadowHalf * 1.2, 56, meadowHalf * 0.24, 12 );
		// 2. Contact shadow at the trunk.
		mound( 0x000000, 0.45, opts.trunkBase * 10 + 60, 30, 0, 4 );

		// ── 3. Grass — clumps of curved blades swaying around their own
		// roots. Denser near the tree, thinning toward the meadow's edge.
		// Stratified placement: one clump per horizontal slot (+ jitter)
		// so the lawn is CONTINUOUS — random draws bunched clumps in the
		// middle and left bald gaps at the edges. Rows of clumps FILL the
		// ground region top to bottom (painter's order: back rows first,
		// darker; front rows brighter and slightly taller), the last row
		// rooting just past the canvas bottom so its blades reach up into
		// view — soil never shows between rows.
		//
		// The whole field is STATIC and draws into ONE Graphics: ~13k
		// blades tessellate once at build and cost a single scene-graph
		// object per frame afterwards. (An earlier version kept a
		// container per clump so the turf could sway; ~460 live Graphics
		// objects made the wallpaper's steady-state frame noticeably
		// expensive — the swaying canopy carries the wind story fine.)
		const turf = new this.pixi.Graphics();
		const fieldDepth = Math.max( 24, opts.coverDepth + 10 );
		const rowStep = 10;
		const rowCount = Math.max( 3, Math.ceil( fieldDepth / rowStep ) + 1 );
		for ( let r = 0; r < rowCount; r++ ) {
			const depth01 = rowCount === 1 ? 1 : r / ( rowCount - 1 );
			const tone = 0.5 + depth01 * 0.55;
			const sizeScale = 0.78 + depth01 * 0.3;
			const clumpCount = Math.max( 20, Math.round( meadowHalf / 26 ) );
			const slotWidth = ( meadowHalf * 2 ) / clumpCount;
			for ( let c = 0; c < clumpCount; c++ ) {
				const spread =
					-meadowHalf + ( c + 0.5 ) * slotWidth + ( rng() - 0.5 ) * slotWidth * 0.8;
				const baseY = r * rowStep + rng() * rowStep * 0.7;
				this.drawClumpBlades(
					turf,
					rng,
					shade( grass, tone ),
					sizeScale,
					spread,
					baseY,
				);
			}
		}
		this.layer.addChild( turf );
		// Bake the blade field: from here on the whole turf is ONE quad
		// per frame instead of ~13k stroked curves.
		turf.cacheAsTexture?.( true );
		this.turf = turf;

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
			sprite.y = 8 + rng() * Math.max( 10, opts.coverDepth * 0.6 );
			this.layer.addChild( sprite );
			this.litter.push( sprite );
		}
	}

	/**
	 * Draw one clump's blades into the shared turf Graphics: curved
	 * strokes leaning from a shared root at (`originX`, `originY`), back
	 * blades darker, front blades brighter.
	 */
	private drawClumpBlades(
		g: PixiGraphics,
		rng: () => number,
		grass: number,
		sizeScale: number,
		originX: number,
		originY: number,
	): void {
		for ( let b = 0; b < BLADES_PER_CLUMP; b++ ) {
			const rootX = originX + ( rng() * 2 - 1 ) * 42;
			const height = ( 9 + rng() * 19 ) * sizeScale;
			const lean = ( rng() * 2 - 1 ) * 11;
			const midLean = lean * 0.35 + ( rng() * 2 - 1 ) * 2;
			// Depth cue: early (back) blades dark, later (front) bright.
			const depth = b / BLADES_PER_CLUMP;
			const color = shade( grass, 0.45 + depth * 0.6 + rng() * 0.1 );
			g.moveTo( rootX, originY + 2 )
				.bezierCurveTo(
					rootX + midLean,
					originY - height * 0.45,
					rootX + lean * 0.8,
					originY - height * 0.8,
					rootX + lean,
					originY - height,
				)
				.stroke( {
					color,
					width: 1 + rng() * 0.9,
					alpha: 0.85,
					cap: 'round',
				} );
		}
	}

	private clear(): void {
		for ( const sprite of this.mounds ) {
			this.layer.removeChild( sprite );
			sprite.destroy();
		}
		this.mounds.length = 0;
		if ( this.turf ) {
			this.layer.removeChild( this.turf );
			this.turf.destroy();
			this.turf = null;
		}
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
