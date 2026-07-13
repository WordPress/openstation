/**
 * The Living Tree — meadow wildflowers (categories).
 *
 * Categories don't tint the canopy (real trees don't grow in colour
 * wedges) — they bloom in the meadow. Each category reads as a PATCH of
 * wildflowers of one species and colour growing in the grass around the
 * trunk: one category is a couple of blossoms, a rich taxonomy is a
 * flowering meadow. The count saturates (`computeFlowerCount`) — 2000
 * categories is a full flowerbed, never 2000 sprites.
 *
 * Render pipeline: four hand-drawn species (daisy, poppy, bellflower,
 * cosmos) are rasterized ONCE per species+colour combination into shared
 * textures; every flower is a single sprite anchored at its stem base,
 * swaying as one stalk in the wind. ≤ {@link MAX_FLOWERS} sprites total,
 * updated at the canopy's 30 Hz cadence. Layout draws from its own
 * seeded stream (`<seed>|flowers`), stable per site and isolated from
 * the skeleton's PRNG. See `docs/living-tree-algorithm.md` §A.8.
 *
 * @since 0.9.4
 */

import { hash32, mulberry32 } from '../rng';
import type { PixiContainer, PixiNamespace, PixiSprite, PixiTexture } from '../pixi-types';
import type { Vec2 } from '../types';

/** LOD bounds — one category still earns a couple of blossoms. */
const MIN_FLOWERS = 3;
const MAX_FLOWERS = 80;

/** Most patches a meadow splits into — categories beyond this share. */
const MAX_PATCHES = 8;

/** Flower texture raster size (whole plant: head + stem). */
const TEX_W = 80;
const TEX_H = 112;

/** The four species, in unlock order. */
const SPECIES = [ 'daisy', 'poppy', 'bell', 'cosmos' ] as const;
type Species = ( typeof SPECIES )[ number ];

/**
 * Petal colours — a natural wildflower set (poppy red, cornflower blue,
 * buttercup yellow, blossom pink, lavender, daisy white). Full colour is
 * baked into the texture (petals carry gradients a flat tint can't), so
 * combinations are rasterized lazily per species+colour.
 */
const PETAL_COLORS = [ 0xd94f4a, 0x6f8fd8, 0xf0c64a, 0xf0a2bc, 0xa98fd6, 0xf5f2ea ];

/** Stem / foliage green, shaded per part. */
const STEM_COLOR = 0x3f7a3f;

interface Flower {
	sprite: PixiSprite;
	base: Vec2;
	/** Stalk height in reference units — sway pivots on the base. */
	height: number;
	phase: number;
	scale: number;
	alphaMax: number;
	/** Seconds until this flower starts fading in (staggered bloom). */
	delay: number;
	age: number;
}

export interface FlowerFieldOptions {
	/** Total category count — drives flower count + variety. */
	categories: number;
	/** Half-width of the plantable meadow, in reference units. */
	fieldHalf: number;
	/** Depth of the visible ground region (ground line → canvas bottom). */
	coverDepth: number;
	/** Trunk-base radius — keeps the bed clear of the contact shadow. */
	trunkBase: number;
	/** Site identity (`siteUrl|siteName`) — seeds the flower layout. */
	siteKey: string;
}

/**
 * How many wildflowers a taxonomy of the given size grows. Saturating on
 * a square root: one category is a small cluster, growth is visible for
 * the first dozens, and the hard cap keeps 2000 categories a flowerbed
 * instead of a sprite storm. Pure — unit-tested alongside the leaf
 * budget (content changes decoration, never the skeleton).
 *
 * @param totalCategories Category count from the snapshot.
 * @return Number of flower sprites to plant.
 */
export function computeFlowerCount( totalCategories: number ): number {
	const cats = Math.max( 0, Math.floor( totalCategories ) );
	if ( cats === 0 ) {
		return 0;
	}
	return Math.min(
		MAX_FLOWERS,
		Math.max( MIN_FLOWERS, Math.round( 2.5 * Math.sqrt( cats ) ) ),
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

/** Mix two packed colours (`f` = weight of `b`). */
function mix( a: number, b: number, f: number ): number {
	const ch = ( shift: number ): number => {
		const ca = Math.floor( a / shift ) % 256;
		const cb = Math.floor( b / shift ) % 256;
		return Math.round( ca + ( cb - ca ) * f );
	};
	return ch( 65536 ) * 65536 + ch( 256 ) * 256 + ch( 1 );
}

/**
 * Draw the stalk: a gently bent stem from the texture bottom up to the
 * head, with one or two small leaf blades. Shared by every species.
 */
function drawStem(
	ctx: CanvasRenderingContext2D,
	cx: number,
	headY: number,
	bend: number,
): void {
	const baseY = TEX_H - 2;
	ctx.strokeStyle = css( shade( STEM_COLOR, 0.9 ) );
	ctx.lineWidth = 2.6;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo( cx - bend * 0.4, baseY );
	ctx.quadraticCurveTo( cx + bend, ( baseY + headY ) / 2, cx, headY + 4 );
	ctx.stroke();

	// Two leaf blades off the stem, one per side.
	const leaf = ( ly: number, dir: number ): void => {
		const lx = cx + bend * 0.5;
		const len = 14 + Math.abs( bend ) * 2;
		ctx.fillStyle = css( shade( STEM_COLOR, 1.05 ), 0.95 );
		ctx.beginPath();
		ctx.moveTo( lx, ly );
		ctx.quadraticCurveTo( lx + dir * len * 0.7, ly - len * 0.45, lx + dir * len, ly - len * 0.15 );
		ctx.quadraticCurveTo( lx + dir * len * 0.55, ly + len * 0.12, lx, ly );
		ctx.closePath();
		ctx.fill();
	};
	leaf( TEX_H * 0.68, 1 );
	leaf( TEX_H * 0.8, -1 );
}

/** One rotated elliptical petal with a base→tip lightness gradient. */
function drawPetal(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	angle: number,
	length: number,
	width: number,
	inner: number,
	outer: number,
	notched: boolean,
): void {
	ctx.save();
	ctx.translate( cx, cy );
	ctx.rotate( angle );
	const gradient = ctx.createLinearGradient( 0, 0, length, 0 );
	gradient.addColorStop( 0, css( inner ) );
	gradient.addColorStop( 1, css( outer ) );
	ctx.fillStyle = gradient;
	ctx.beginPath();
	ctx.moveTo( 2, 0 );
	if ( notched ) {
		// Cosmos-style: straight-ish sides to a shallow V at the tip.
		ctx.quadraticCurveTo( length * 0.45, -width * 0.62, length * 0.96, -width * 0.3 );
		ctx.lineTo( length * 0.88, 0 );
		ctx.lineTo( length * 0.96, width * 0.3 );
		ctx.quadraticCurveTo( length * 0.45, width * 0.62, 2, 0 );
	} else {
		ctx.quadraticCurveTo( length * 0.5, -width * 0.58, length, 0 );
		ctx.quadraticCurveTo( length * 0.5, width * 0.58, 2, 0 );
	}
	ctx.closePath();
	ctx.fill();
	ctx.restore();
}

/** A warm gradient disc — the daisy / cosmos centre. */
function drawDisc( ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number ): void {
	const gradient = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.3, r * 0.15, cx, cy, r );
	gradient.addColorStop( 0, css( 0xffdf8a ) );
	gradient.addColorStop( 1, css( 0xcf8f2e ) );
	ctx.fillStyle = gradient;
	ctx.beginPath();
	ctx.arc( cx, cy, r, 0, Math.PI * 2 );
	ctx.fill();
}

/**
 * Rasterize one whole plant (head + stalk) for a species+colour combo.
 * Full colour with baked gradients — sprites never tint these (tints
 * would muddy the disc golds and stem greens); back-row dimming shades
 * the whole sprite instead.
 */
function buildFlowerTexture(
	pixi: PixiNamespace,
	species: Species,
	petal: number,
	seed: number,
): PixiTexture {
	const canvas = document.createElement( 'canvas' );
	canvas.width = TEX_W;
	canvas.height = TEX_H;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const rand = mulberry32( hash32( `flower|${ species }|${ seed }` ) );
	const cx = TEX_W / 2;
	const headY = 26;
	const bend = ( rand() * 2 - 1 ) * 7;
	drawStem( ctx, cx, headY, bend );

	const light = mix( petal, 0xffffff, 0.35 );
	const deep = shade( petal, 0.72 );

	if ( species === 'daisy' ) {
		const petals = 11;
		for ( let i = 0; i < petals; i++ ) {
			const a = ( i / petals ) * Math.PI * 2 + rand() * 0.1;
			drawPetal( ctx, cx, headY, a, 19, 6.5, mix( petal, 0xffffff, 0.12 ), light, false );
		}
		drawDisc( ctx, cx, headY, 6.5 );
	} else if ( species === 'poppy' ) {
		// Five broad overlapping petals, edge-lit like tissue paper.
		for ( let i = 0; i < 5; i++ ) {
			const a = ( i / 5 ) * Math.PI * 2 - Math.PI / 2 + rand() * 0.12;
			const orbit = 8.5;
			const px = cx + Math.cos( a ) * orbit;
			const py = headY + Math.sin( a ) * orbit;
			const gradient = ctx.createRadialGradient( px, py, 1, px, py, 12 );
			gradient.addColorStop( 0, css( deep ) );
			gradient.addColorStop( 0.75, css( petal ) );
			gradient.addColorStop( 1, css( light, 0.9 ) );
			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.arc( px, py, 11.5, 0, Math.PI * 2 );
			ctx.fill();
		}
		// Dark heart + a ring of stamen dots.
		ctx.fillStyle = css( 0x35222e );
		ctx.beginPath();
		ctx.arc( cx, headY, 5, 0, Math.PI * 2 );
		ctx.fill();
		ctx.fillStyle = css( 0xe8d27a, 0.9 );
		for ( let i = 0; i < 8; i++ ) {
			const a = ( i / 8 ) * Math.PI * 2 + rand() * 0.2;
			ctx.beginPath();
			ctx.arc( cx + Math.cos( a ) * 6.5, headY + Math.sin( a ) * 6.5, 1.1, 0, Math.PI * 2 );
			ctx.fill();
		}
	} else if ( species === 'bell' ) {
		// Two hanging bells on drooping pedicels off the stem apex.
		const bell = ( bx: number, by: number, s: number ): void => {
			ctx.strokeStyle = css( shade( STEM_COLOR, 0.85 ) );
			ctx.lineWidth = 1.6;
			ctx.beginPath();
			ctx.moveTo( cx, headY + 4 );
			ctx.quadraticCurveTo( ( cx + bx ) / 2, Math.min( headY, by ) - 8, bx, by - 10 * s );
			ctx.stroke();
			const gradient = ctx.createLinearGradient( bx, by - 12 * s, bx, by + 8 * s );
			gradient.addColorStop( 0, css( light ) );
			gradient.addColorStop( 1, css( deep ) );
			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.moveTo( bx, by - 10 * s );
			ctx.bezierCurveTo(
				bx + 7 * s, by - 9 * s, bx + 8 * s, by - 1 * s, bx + 6 * s, by + 5 * s,
			);
			// Flared mouth with a soft scallop.
			ctx.quadraticCurveTo( bx + 3 * s, by + 3.4 * s, bx, by + 5.5 * s );
			ctx.quadraticCurveTo( bx - 3 * s, by + 3.4 * s, bx - 6 * s, by + 5 * s );
			ctx.bezierCurveTo(
				bx - 8 * s, by - 1 * s, bx - 7 * s, by - 9 * s, bx, by - 10 * s,
			);
			ctx.closePath();
			ctx.fill();
		};
		bell( cx - 9, headY + 12, 1 );
		bell( cx + 10, headY + 5, 0.8 );
	} else {
		// Cosmos: eight notched petals with a visible gap between them.
		const petals = 8;
		for ( let i = 0; i < petals; i++ ) {
			const a = ( i / petals ) * Math.PI * 2 + Math.PI / petals;
			drawPetal( ctx, cx, headY, a, 18, 7.5, petal, light, true );
		}
		drawDisc( ctx, cx, headY, 4.5 );
	}
	return pixi.Texture.from( canvas );
}

export class FlowerField {
	private readonly flowers: Flower[] = [];
	private readonly textures = new Map< string, PixiTexture >();
	private readonly layer: PixiContainer;
	private readonly pixi: PixiNamespace;

	/**
	 * @param layer The flower-field layer (in front of the turf).
	 * @param pixi  The vendor Pixi namespace.
	 */
	constructor( layer: PixiContainer, pixi: PixiNamespace ) {
		this.layer = layer;
		this.pixi = pixi;
	}

	/**
	 * (Re)plant the meadow. Deterministic for a given site + options:
	 * categories map to patches (species+colour), patches to scattered
	 * blossoms, denser and larger toward the foreground.
	 *
	 * @param opts Field geometry + the category count.
	 */
	public build( opts: FlowerFieldOptions ): void {
		this.clear();
		const count = computeFlowerCount( opts.categories );
		if ( count === 0 ) {
			return;
		}
		const rng = mulberry32( hash32( `${ opts.siteKey }|flowers` ) );

		// One patch per category up to the cap; every patch is a distinct
		// species+colour combination while combinations last.
		const patchCount = Math.min( Math.max( 1, opts.categories ), MAX_PATCHES );
		const combos: Array< { species: Species; petal: number } > = [];
		for ( const petal of PETAL_COLORS ) {
			for ( const species of SPECIES ) {
				combos.push( { species, petal } );
			}
		}
		for ( let i = combos.length - 1; i > 0; i-- ) {
			const j = Math.floor( rng() * ( i + 1 ) );
			[ combos[ i ], combos[ j ] ] = [ combos[ j ], combos[ i ] ];
		}

		// Patch centres: stratified across the field so patches spread
		// instead of bunching, kept clear of the trunk's contact shadow.
		const clearance = opts.trunkBase * 4 + 26;
		const slot = ( opts.fieldHalf * 2 ) / patchCount;
		const patches: Array< { x: number; y: number; combo: number } > = [];
		for ( let p = 0; p < patchCount; p++ ) {
			let x = -opts.fieldHalf + ( p + 0.5 ) * slot + ( rng() - 0.5 ) * slot * 0.7;
			if ( Math.abs( x ) < clearance ) {
				x = clearance * ( x < 0 ? -1 : 1 ) + rng() * 20;
			}
			patches.push( {
				x,
				y: 3 + rng() * Math.max( 8, opts.coverDepth * 0.7 ),
				combo: p % combos.length,
			} );
		}

		for ( let i = 0; i < count; i++ ) {
			const patch = patches[ i % patches.length ];
			const combo = combos[ patch.combo ];
			const key = `${ combo.species }:${ combo.petal }`;
			let texture = this.textures.get( key );
			if ( ! texture ) {
				texture = buildFlowerTexture(
					this.pixi,
					combo.species,
					combo.petal,
					patch.combo,
				);
				this.textures.set( key, texture );
			}

			// Gaussian-ish scatter around the patch centre.
			const x = patch.x + ( ( rng() + rng() ) - 1 ) * 42;
			const y = Math.min(
				Math.max( 2, patch.y + ( ( rng() + rng() ) - 1 ) * opts.coverDepth * 0.3 ),
				Math.max( 4, opts.coverDepth * 0.9 ),
			);
			// Depth cue, matching the turf rows: foreground flowers are
			// taller and brighter, back-row ones smaller and dimmer.
			const depth01 = Math.min( 1, y / Math.max( 8, opts.coverDepth ) );
			const height = ( 21 + rng() * 13 ) * ( 0.72 + depth01 * 0.38 );
			const sprite = new this.pixi.Sprite( texture );
			sprite.anchor.set( 0.5, 1 );
			const scale = height / ( TEX_H * 0.78 );
			sprite.scale.set( scale );
			// Mirror about half the flowers so a shared texture never
			// reads as a stamp.
			if ( rng() < 0.5 ) {
				sprite.scale.x = -scale;
			}
			sprite.tint = shade( 0xffffff, 0.66 + 0.34 * depth01 );
			sprite.alpha = 0;
			sprite.x = x;
			sprite.y = y;
			this.layer.addChild( sprite );
			this.flowers.push( {
				sprite,
				base: { x, y },
				height,
				phase: rng() * Math.PI * 2,
				scale,
				alphaMax: 0.9 + rng() * 0.1,
				delay: rng() * 1.4,
				age: 0,
			} );
		}
	}

	/**
	 * Per-frame update (canopy cadence, 30 Hz): staggered bloom fade-in
	 * and a stalk sway — the sprite pivots on its stem base, bending with
	 * the wind sampled at its head like one supple stalk.
	 *
	 * @param dt       Delta time (seconds).
	 * @param t        Elapsed scene time (seconds).
	 * @param displace Wind displacement at a point (already unscaled).
	 */
	public update(
		dt: number,
		t: number,
		displace: ( x: number, y: number ) => Vec2,
	): void {
		for ( const flower of this.flowers ) {
			flower.age += dt;
			const reveal = Math.min( 1, Math.max( 0, ( flower.age - flower.delay ) / 1.2 ) );
			flower.sprite.alpha = flower.alphaMax * reveal;
			if ( reveal <= 0 ) {
				continue;
			}
			const w = displace( flower.base.x, flower.base.y - flower.height );
			// Wind bends the stalk (rotation around the base anchor), an
			// idle breath keeps it alive between gusts. Taller stalks
			// give more.
			const give = Math.min( 0.2, Math.abs( w.x ) * 0.012 ) * ( w.x < 0 ? -1 : 1 );
			flower.sprite.rotation =
				give * ( flower.height / 28 ) +
				Math.sin( t * 1.3 + flower.phase ) * 0.022;
		}
	}

	/**
	 * Flower-head positions in reference space — the butterflies' waypoints.
	 */
	public targets(): Vec2[] {
		return this.flowers.map( ( flower ) => ( {
			x: flower.base.x,
			y: flower.base.y - flower.height * 0.92,
		} ) );
	}

	/** Number of planted flowers (observability + tests). */
	public count(): number {
		return this.flowers.length;
	}

	private clear(): void {
		for ( const flower of this.flowers ) {
			this.layer.removeChild( flower.sprite );
			flower.sprite.destroy();
		}
		this.flowers.length = 0;
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
