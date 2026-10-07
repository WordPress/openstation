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

const BLADES_PER_CLUMP = 34;

const FALLEN_LEAVES = 7;

const GRASS_HUE = 96;

function shade( color: number, f: number ): number {
	const r = Math.min( 255, Math.round( ( Math.floor( color / 65536 ) % 256 ) * f ) );
	const g = Math.min( 255, Math.round( ( Math.floor( color / 256 ) % 256 ) * f ) );
	const b = Math.min( 255, Math.round( ( color % 256 ) * f ) );
	return r * 65536 + g * 256 + b;
}

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

	span: number;

	coverHalfWidth: number;

	coverDepth: number;

	trunkBase: number;

	health01: number;

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

	constructor( layer: PixiContainer, pixi: PixiNamespace ) {
		this.layer = layer;
		this.pixi = pixi;
	}

	public build( opts: GroundBuildOptions ): void {
		this.clear();
		const rng = mulberry32( hash32( `${ opts.siteKey }|ground` ) );
		this.gradientTexture = this.gradientTexture ?? buildGroundGradientTexture( this.pixi );

		const grass = leafColor( GRASS_HUE, opts.health01, 0 );

		const soil = shade( grass, 0.16 );

		const meadowHalf = Math.max( opts.span * 1.15, opts.coverHalfWidth );

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

		mound( 0x000000, 0.45, opts.trunkBase * 10 + 60, 30, 0, 4 );

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

		turf.cacheAsTexture?.( true );
		this.turf = turf;

		this.leafTexture = this.leafTexture ?? buildLeafTexture( this.pixi );
		for ( let i = 0; i < FALLEN_LEAVES; i++ ) {
			const sprite = new this.pixi.Sprite( this.leafTexture );
			sprite.anchor.set( 0.5 );

			sprite.tint = shade( leafColor( 46, 0.35, 2000 ), 1.1 );
			sprite.alpha = 0.8;
			const size = 13 + rng() * 8;
			sprite.scale.x = size / 48;

			sprite.scale.y = ( size / 48 ) * 0.5;
			sprite.rotation = ( rng() * 2 - 1 ) * 0.5 + Math.PI / 2;

			const side = rng() < 0.5 ? -1 : 1;
			sprite.x = side * ( opts.trunkBase * 3 + 30 + rng() * ( opts.trunkBase * 5 + 70 ) );
			sprite.y = 8 + rng() * Math.max( 10, opts.coverDepth * 0.6 );
			this.layer.addChild( sprite );
			this.litter.push( sprite );
		}
	}

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

	public destroy(): void {
		this.clear();
		if ( this.gradientTexture ) {
			try {
				this.gradientTexture.destroy( true );
			} catch {

			}
			this.gradientTexture = null;
		}
		if ( this.leafTexture ) {
			try {
				this.leafTexture.destroy( true );
			} catch {

			}
			this.leafTexture = null;
		}
	}
}
