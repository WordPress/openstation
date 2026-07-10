/**
 * The Living Tree — time-of-day sky.
 *
 * The backdrop tracks the viewer's LOCAL clock through a 24-hour cycle:
 * deep starry night → pre-dawn → warm sunrise → bright midday → golden
 * afternoon → dusk → back to night. A sun disc arcs across the day sky, a
 * moon across the night, and a star field fades in after dark. The same
 * cycle yields an ambient `light01` the scene uses to dim the tree at
 * night (a brilliant midday canopy shouldn't glow at 2am).
 *
 * `skyForTime()` is pure and unit-tested; `new Date()` is only read at
 * the scene boundary via {@link currentHour} (with a debug override).
 *
 * @since 0.9.4
 */

import type {
	PixiContainer,
	PixiNamespace,
	PixiSprite,
	PixiTexture,
} from './pixi-types';

/** One anchor in the daily colour cycle. */
interface SkyKeyframe {
	h: number;
	/** Zenith, mid-sky, horizon colours (packed 0xRRGGBB). */
	top: number;
	mid: number;
	bottom: number;
	/** Star visibility, 0..1. */
	star: number;
	/** Ambient light, 0 (night) .. 1 (midday) — drives tree brightness. */
	light: number;
}

/**
 * The daily keyframes, hour-ascending. `skyForTime` interpolates between
 * the two bracketing frames, wrapping 24→0.
 */
const KEYFRAMES: SkyKeyframe[] = [
	{ h: 0, top: 0x0a0e1a, mid: 0x0d1226, bottom: 0x161a2e, star: 1, light: 0.12 },
	{ h: 5, top: 0x1a2036, mid: 0x3a2f4a, bottom: 0x6b4a5a, star: 0.8, light: 0.3 },
	{ h: 6.5, top: 0x38547f, mid: 0xb0785f, bottom: 0xf0b070, star: 0.15, light: 0.62 },
	{ h: 9, top: 0x5b93d6, mid: 0x9cc8ee, bottom: 0xdcecf8, star: 0, light: 0.9 },
	{ h: 13, top: 0x3f86d4, mid: 0x82b8ea, bottom: 0xc8e4f5, star: 0, light: 1 },
	{ h: 16, top: 0x5a86c0, mid: 0xaab2d2, bottom: 0xe8d4ac, star: 0, light: 0.92 },
	{ h: 18.5, top: 0x2a3a6a, mid: 0x9a5a7a, bottom: 0xf0854e, star: 0.15, light: 0.55 },
	{ h: 20, top: 0x1a2340, mid: 0x4a3560, bottom: 0x8a5a63, star: 0.55, light: 0.35 },
	{ h: 22, top: 0x0d1220, mid: 0x141a30, bottom: 0x22283e, star: 0.9, light: 0.18 },
];

export interface SkyState {
	top: number;
	mid: number;
	bottom: number;
	/** Star-field opacity, 0..1. */
	starAlpha: number;
	/** Ambient light, 0 (night) .. 1 (midday). */
	light01: number;
	sunAlpha: number;
	moonAlpha: number;
	/** Luminary positions, 0..1 across width / down from top. */
	sunX01: number;
	sunY01: number;
	moonX01: number;
	moonY01: number;
}

function clamp01( v: number ): number {
	return Math.min( 1, Math.max( 0, v ) );
}

/** Channel-wise lerp of two packed RGB colours. */
function lerpColor( a: number, b: number, t: number ): number {
	const ar = Math.floor( a / 65536 ) % 256;
	const ag = Math.floor( a / 256 ) % 256;
	const ab = a % 256;
	const br = Math.floor( b / 65536 ) % 256;
	const bg = Math.floor( b / 256 ) % 256;
	const bb = b % 256;
	return (
		Math.round( ar + ( br - ar ) * t ) * 65536 +
		Math.round( ag + ( bg - ag ) * t ) * 256 +
		Math.round( ab + ( bb - ab ) * t )
	);
}

/** Smooth 0→1 ramp over [edge0, edge1]. */
function smoothRamp( x: number, edge0: number, edge1: number ): number {
	const t = clamp01( ( x - edge0 ) / ( edge1 - edge0 ) );
	return t * t * ( 3 - 2 * t );
}

/**
 * The sky state for a given local hour (0..24, fractional). Pure.
 *
 * @param hours Local time of day in hours (e.g. 13.5 = 13:30).
 * @return The interpolated {@link SkyState}.
 */
export function skyForTime( hours: number ): SkyState {
	const h = ( ( hours % 24 ) + 24 ) % 24;

	// Bracket the hour between two keyframes, wrapping the last→first.
	let a = KEYFRAMES[ KEYFRAMES.length - 1 ];
	let b = KEYFRAMES[ 0 ];
	let span = KEYFRAMES[ 0 ].h + 24 - a.h;
	let local = h < KEYFRAMES[ 0 ].h ? h + 24 - a.h : h - a.h;
	for ( let i = 0; i < KEYFRAMES.length - 1; i++ ) {
		if ( h >= KEYFRAMES[ i ].h && h < KEYFRAMES[ i + 1 ].h ) {
			a = KEYFRAMES[ i ];
			b = KEYFRAMES[ i + 1 ];
			span = b.h - a.h;
			local = h - a.h;
			break;
		}
	}
	const t = span <= 0 ? 0 : clamp01( local / span );

	// Sun arcs 5.5→18.5 (east→west, peak at noon); moon fills the night.
	const sunT = clamp01( ( h - 5.5 ) / 13 );
	const sunAlpha = smoothRamp( h, 5.5, 7 ) * ( 1 - smoothRamp( h, 17.2, 18.8 ) );
	const moonH = ( ( h - 18 + 24 ) % 24 ) / 12; // 0 at 18:00 → 1 at 06:00
	const moonAlpha = clamp01(
		Math.max( smoothRamp( h, 17.5, 19.5 ), 1 - smoothRamp( h, 4.5, 6.5 ) ),
	);

	return {
		top: lerpColor( a.top, b.top, t ),
		mid: lerpColor( a.mid, b.mid, t ),
		bottom: lerpColor( a.bottom, b.bottom, t ),
		starAlpha: a.star + ( b.star - a.star ) * t,
		light01: a.light + ( b.light - a.light ) * t,
		sunAlpha,
		moonAlpha,
		sunX01: sunT,
		sunY01: 0.86 - Math.sin( sunT * Math.PI ) * 0.64,
		moonX01: moonH,
		moonY01: 0.82 - Math.sin( moonH * Math.PI ) * 0.6,
	};
}

/**
 * Local time of day in fractional hours. Honours a debug override global
 * (`window.desktopModeLivingTreeHourOverride`, a number) so a specific
 * hour can be previewed without waiting for the clock.
 */
export function currentHour(): number {
	const override = ( window as unknown as {
		desktopModeLivingTreeHourOverride?: unknown;
	} ).desktopModeLivingTreeHourOverride;
	if ( typeof override === 'number' && Number.isFinite( override ) ) {
		return ( ( override % 24 ) + 24 ) % 24;
	}
	const now = new Date();
	return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

/** Build a vertical 3-stop gradient texture (top → mid → bottom). */
function buildGradientTexture(
	pixi: PixiNamespace,
	top: number,
	mid: number,
	bottom: number,
): PixiTexture {
	const w = 8;
	const h = 256;
	const canvas = document.createElement( 'canvas' );
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const hex = ( c: number ): string =>
		`#${ c.toString( 16 ).padStart( 6, '0' ) }`;
	const gradient = ctx.createLinearGradient( 0, 0, 0, h );
	gradient.addColorStop( 0, hex( top ) );
	gradient.addColorStop( 0.55, hex( mid ) );
	gradient.addColorStop( 1, hex( bottom ) );
	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, w, h );
	return pixi.Texture.from( canvas );
}

/** Soft radial glow texture for the sun / moon disc. */
function buildDiscTexture( pixi: PixiNamespace ): PixiTexture {
	const size = 128;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const c = size / 2;
	const gradient = ctx.createRadialGradient( c, c, 0, c, c, c );
	gradient.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	gradient.addColorStop( 0.32, 'rgba(255, 255, 255, 0.95)' );
	gradient.addColorStop( 0.42, 'rgba(255, 255, 255, 0.4)' );
	gradient.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, size, size );
	return pixi.Texture.from( canvas );
}

/** Small soft star dot. */
function buildStarTexture( pixi: PixiNamespace ): PixiTexture {
	const size = 16;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const c = size / 2;
	const gradient = ctx.createRadialGradient( c, c, 0, c, c, c );
	gradient.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	gradient.addColorStop( 0.5, 'rgba(255, 255, 255, 0.5)' );
	gradient.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, size, size );
	return pixi.Texture.from( canvas );
}

interface Star {
	sprite: PixiSprite;
	x01: number;
	y01: number;
	phase: number;
	baseAlpha: number;
	twinkle: number;
}

/** Number of stars in the night field. */
const STAR_COUNT = 110;

/**
 * The sky backdrop layer. Lives in screen space at the very back of the
 * stage. `applyState()` retints on a slow cadence; `tick()` twinkles the
 * stars every frame. All star positions are one-time random (presence,
 * not DNA — a fixed seed isn't required for a star field).
 */
export class SkyLayer {
	private readonly pixi: PixiNamespace;
	private readonly root: PixiContainer;
	private gradient: PixiSprite;
	private gradientTexture: PixiTexture;
	private readonly discTexture: PixiTexture;
	private readonly starTexture: PixiTexture;
	private readonly sun: PixiSprite;
	private readonly moon: PixiSprite;
	private readonly starRoot: PixiContainer;
	private readonly stars: Star[] = [];
	private width = 1;
	private height = 1;
	private starAlpha = 0;

	constructor( pixi: PixiNamespace, parent: PixiContainer ) {
		this.pixi = pixi;
		this.root = new pixi.Container();
		parent.addChild( this.root );

		this.gradientTexture = buildGradientTexture( pixi, 0x0d1226, 0x141a30, 0x22283e );
		this.gradient = new pixi.Sprite( this.gradientTexture );
		this.root.addChild( this.gradient );

		this.discTexture = buildDiscTexture( pixi );
		this.starTexture = buildStarTexture( pixi );

		this.starRoot = new pixi.Container();
		this.root.addChild( this.starRoot );
		for ( let i = 0; i < STAR_COUNT; i++ ) {
			const sprite = new pixi.Sprite( this.starTexture );
			sprite.anchor.set( 0.5 );
			const scale = 0.25 + Math.random() * 0.7;
			sprite.scale.set( scale );
			this.starRoot.addChild( sprite );
			this.stars.push( {
				sprite,
				x01: Math.random(),
				// Stars sit in the upper ~68% of the sky.
				y01: Math.random() * 0.68,
				phase: Math.random() * Math.PI * 2,
				baseAlpha: 0.4 + Math.random() * 0.6,
				twinkle: 0.4 + Math.random() * 2.2,
			} );
		}

		this.sun = new pixi.Sprite( this.discTexture );
		this.sun.anchor.set( 0.5 );
		this.moon = new pixi.Sprite( this.discTexture );
		this.moon.anchor.set( 0.5 );
		this.root.addChild( this.sun );
		this.root.addChild( this.moon );
	}

	/** Resize to cover the canvas and reposition everything. */
	public resize( width: number, height: number ): void {
		this.width = Math.max( 1, width );
		this.height = Math.max( 1, height );
		this.gradient.scale.x = this.width / 8;
		this.gradient.scale.y = this.height / 256;
		for ( const star of this.stars ) {
			star.sprite.x = star.x01 * this.width;
			star.sprite.y = star.y01 * this.height;
		}
	}

	/** Apply a sky state — colours, luminaries, star opacity (slow cadence). */
	public applyState( state: SkyState ): void {
		const next = buildGradientTexture( this.pixi, state.top, state.mid, state.bottom );
		this.gradient.texture = next;
		this.gradientTexture.destroy( true );
		this.gradientTexture = next;
		this.gradient.scale.x = this.width / 8;
		this.gradient.scale.y = this.height / 256;

		this.starAlpha = state.starAlpha;
		this.starRoot.alpha = state.starAlpha;

		const discSize = Math.max( 70, Math.min( this.width, this.height ) * 0.16 );
		this.sun.tint = 0xfff2c4;
		this.sun.scale.set( ( discSize * 1.4 ) / 128 );
		this.sun.x = state.sunX01 * this.width;
		this.sun.y = state.sunY01 * this.height;
		this.sun.alpha = state.sunAlpha;

		this.moon.tint = 0xf2f4ff;
		this.moon.scale.set( discSize / 128 );
		this.moon.x = state.moonX01 * this.width;
		this.moon.y = state.moonY01 * this.height;
		this.moon.alpha = state.moonAlpha * 0.95;
	}

	/** Twinkle the stars (cheap; safe to call every frame). */
	public tick( t: number ): void {
		if ( this.starAlpha <= 0.01 ) {
			return;
		}
		for ( const star of this.stars ) {
			const flick = 0.55 + 0.45 * Math.sin( t * star.twinkle + star.phase );
			star.sprite.alpha = star.baseAlpha * flick;
		}
	}

	/** Release the sky's own textures. */
	public destroy(): void {
		this.root.destroy( { children: true } );
		try {
			this.gradientTexture.destroy( true );
			this.discTexture.destroy( true );
			this.starTexture.destroy( true );
		} catch {
			/* already released with the container */
		}
	}
}
