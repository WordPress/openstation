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
	/**
	 * Diurnal rotation of the star field (radians): one full turn per
	 * 24h around a pole below the horizon, so stars arc east → west
	 * overhead exactly like the sun and moon do. Imperceptible in real
	 * time (0.25°/min, as in the real sky), obvious when scrubbing the
	 * tuner's time slider.
	 */
	starAngle: number;
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
		starAngle: ( h / 24 ) * Math.PI * 2,
	};
}

/**
 * Local time of day in fractional hours. Honours a debug override global
 * (`window.openStationLivingTreeHourOverride`, a number) so a specific
 * hour can be previewed without waiting for the clock.
 */
export function currentHour(): number {
	const override = ( window as unknown as {
		openStationLivingTreeHourOverride?: unknown;
	} ).openStationLivingTreeHourOverride;
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

/**
 * Vertical soil gradient: transparent at the top (soft horizon blend)
 * → opaque white below. Tinted per time-of-day, it is the OPAQUE earth
 * band under the meadow — without it the sky gradient showed through
 * between grass blades and the ground read as "uncoloured".
 */
function buildEarthTexture( pixi: PixiNamespace ): PixiTexture {
	const w = 8;
	const h = 128;
	const canvas = document.createElement( 'canvas' );
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const gradient = ctx.createLinearGradient( 0, 0, 0, h );
	gradient.addColorStop( 0, 'rgba(255, 255, 255, 0)' );
	gradient.addColorStop( 0.22, 'rgba(255, 255, 255, 0.85)' );
	gradient.addColorStop( 0.45, 'rgba(255, 255, 255, 1)' );
	gradient.addColorStop( 1, 'rgba(255, 255, 255, 1)' );
	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, w, h );
	return pixi.Texture.from( canvas );
}

/** Earth tint at midday / deep night — mossy loam, moonlit loam. */
const EARTH_DAY = 0x3a4a2c;
const EARTH_NIGHT = 0x10150c;

/**
 * A star is a PINPOINT: a hard 1–2px core with a very tight falloff.
 * (The first pass reused a soft 16px glow and the night sky read as
 * floating peas.) Bright stars get a subtle 4-ray sparkle.
 */
function buildStarTexture( pixi: PixiNamespace ): PixiTexture {
	const size = 8;
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
	gradient.addColorStop( 0.25, 'rgba(255, 255, 255, 0.9)' );
	gradient.addColorStop( 0.5, 'rgba(255, 255, 255, 0.15)' );
	gradient.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, size, size );
	return pixi.Texture.from( canvas );
}

/** Rare bright star: pinpoint core + faint 4-ray sparkle. */
function buildBrightStarTexture( pixi: PixiNamespace ): PixiTexture {
	const size = 24;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const c = size / 2;
	const gradient = ctx.createRadialGradient( c, c, 0, c, c, 4 );
	gradient.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	gradient.addColorStop( 0.5, 'rgba(255, 255, 255, 0.5)' );
	gradient.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, size, size );
	// Diffraction rays.
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo( c, 1 );
	ctx.lineTo( c, size - 1 );
	ctx.moveTo( 1, c );
	ctx.lineTo( size - 1, c );
	ctx.stroke();
	return pixi.Texture.from( canvas );
}

/**
 * A soft cumulus puff: overlapping radial gradients with a flatter,
 * slightly darker base. The canvas carries generous padding — every
 * lobe's gradient must reach zero WELL inside the bitmap, or the sprite
 * shows hard horizontal cuts at its top/bottom edges.
 */
function buildCloudTexture( pixi: PixiNamespace ): PixiTexture {
	const w = 280;
	const h = 190;
	const canvas = document.createElement( 'canvas' );
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	// Positions in unit space of the PADDED canvas; radii sized so that
	// centre + radius stays ≥ 18px away from every edge.
	const lobes: Array< [ number, number, number, number ] > = [
		[ 0.36, 0.52, 0.19, 0.85 ],
		[ 0.5, 0.42, 0.22, 0.9 ],
		[ 0.64, 0.5, 0.19, 0.85 ],
		[ 0.44, 0.58, 0.17, 0.8 ],
		[ 0.58, 0.6, 0.15, 0.75 ],
		[ 0.28, 0.6, 0.13, 0.6 ],
		[ 0.72, 0.6, 0.12, 0.55 ],
	];
	for ( const [ lx, ly, lr, la ] of lobes ) {
		const radius = lr * h;
		const gradient = ctx.createRadialGradient(
			lx * w,
			ly * h,
			1,
			lx * w,
			ly * h,
			radius,
		);
		gradient.addColorStop( 0, `rgba(255, 255, 255, ${ la })` );
		gradient.addColorStop( 0.6, `rgba(255, 255, 255, ${ la * 0.45 })` );
		gradient.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
		ctx.fillStyle = gradient;
		ctx.fillRect( 0, 0, w, h );
	}
	return pixi.Texture.from( canvas );
}

/** Shooting-star streak: a thin white line fading toward its tail. */
function buildStreakTexture( pixi: PixiNamespace ): PixiTexture {
	const w = 72;
	const h = 4;
	const canvas = document.createElement( 'canvas' );
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[living-tree-wallpaper] 2D canvas context unavailable.' );
	}
	const gradient = ctx.createLinearGradient( 0, 0, w, 0 );
	gradient.addColorStop( 0, 'rgba(255, 255, 255, 0)' );
	gradient.addColorStop( 0.75, 'rgba(255, 255, 255, 0.55)' );
	gradient.addColorStop( 1, 'rgba(255, 255, 255, 1)' );
	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, w, h );
	return pixi.Texture.from( canvas );
}

interface Star {
	sprite: PixiSprite;
	/** Polar placement around the celestial pole (see layoutStars). */
	theta: number;
	/** Radius as a fraction of the field radius. */
	r01: number;
	phase: number;
	baseAlpha: number;
	twinkle: number;
}

interface ShootingStar {
	sprite: PixiSprite;
	active: boolean;
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
}

interface Cloud {
	sprite: PixiSprite;
	/** Vertical position, fraction of sky height. */
	y01: number;
	/** Horizontal drift speed, px/s at 1500px width. */
	speed: number;
	baseAlpha: number;
	/** Initial offset so clouds don't start in a row. */
	offset01: number;
	width: number;
}

/**
 * Number of stars in the night field. The field is a full DISC around
 * the celestial pole (it wheels through 2π per day), and the visible
 * sky is only ~a fifth of that disc — so the population is sized for
 * ~120 stars on screen at any rotation.
 */
const STAR_COUNT = 650;

/** Fraction of stars that are bright 4-ray ones. */
const BRIGHT_STAR_RATIO = 0.12;

/** Drifting clouds. */
const CLOUD_COUNT = 5;

/** Max simultaneous shooting stars; ~2 spawn per minute after dark. */
const SHOOTING_STAR_POOL = 2;
const SHOOTING_STARS_PER_MINUTE = 2;

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
	private readonly earthTexture: PixiTexture;
	private readonly earth: PixiSprite;
	private readonly discTexture: PixiTexture;
	private readonly starTexture: PixiTexture;
	private readonly brightStarTexture: PixiTexture;
	private readonly cloudTexture: PixiTexture;
	private readonly sun: PixiSprite;
	private readonly moon: PixiSprite;
	private readonly streakTexture: PixiTexture;
	private readonly starRoot: PixiContainer;
	private readonly stars: Star[] = [];
	private readonly shooting: ShootingStar[] = [];
	private readonly cloudRoot: PixiContainer;
	private readonly clouds: Cloud[] = [];
	private width = 1;
	private height = 1;
	private groundLine = 1;
	private starAlpha = 0;
	private cloudLight = 1;
	private lastTickT = 0;

	constructor( pixi: PixiNamespace, parent: PixiContainer ) {
		this.pixi = pixi;
		this.root = new pixi.Container();
		parent.addChild( this.root );

		this.gradientTexture = buildGradientTexture( pixi, 0x0d1226, 0x141a30, 0x22283e );
		this.gradient = new pixi.Sprite( this.gradientTexture );
		this.root.addChild( this.gradient );

		this.discTexture = buildDiscTexture( pixi );
		this.starTexture = buildStarTexture( pixi );
		this.brightStarTexture = buildBrightStarTexture( pixi );
		this.cloudTexture = buildCloudTexture( pixi );
		this.streakTexture = buildStreakTexture( pixi );

		// Stars render BEFORE the earth band: the field is a full disc
		// around the celestial pole, and the band is the horizon that
		// naturally hides whatever has "set".
		this.starRoot = new pixi.Container();
		this.root.addChild( this.starRoot );
		for ( let i = 0; i < STAR_COUNT; i++ ) {
			// Mostly pinpoints (1–4px on screen); a handful of bright
			// 4-ray stars anchor the field the way real skies have a few
			// first-magnitude stars.
			const bright = Math.random() < BRIGHT_STAR_RATIO;
			const sprite = new pixi.Sprite(
				bright ? this.brightStarTexture : this.starTexture,
			);
			sprite.anchor.set( 0.5 );
			const scale = bright
				? 0.6 + Math.random() * 0.4
				: 0.3 + Math.random() * 0.42;
			sprite.scale.set( scale );
			this.starRoot.addChild( sprite );
			// Uniform over a disc (sqrt for area-uniformity) — the field
			// must cover every rotation angle, since it wheels through a
			// full turn per day.
			this.stars.push( {
				sprite,
				theta: Math.random() * Math.PI * 2,
				r01: Math.sqrt( Math.random() ),
				phase: Math.random() * Math.PI * 2,
				baseAlpha: bright ? 0.9 + Math.random() * 0.1 : 0.55 + Math.random() * 0.45,
				twinkle: 0.4 + Math.random() * 2.2,
			} );
		}

		// Shooting stars — pooled streak sprites, ~2/min after dark.
		for ( let i = 0; i < SHOOTING_STAR_POOL; i++ ) {
			const sprite = new pixi.Sprite( this.streakTexture );
			sprite.anchor.set( 0.5 );
			sprite.visible = false;
			this.root.addChild( sprite );
			this.shooting.push( {
				sprite,
				active: false,
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
				life: 0,
			} );
		}

		// Opaque earth band from the ground line to the bottom edge —
		// full-width, so no sky ever shows through the meadow (and the
		// horizon that swallows setting stars).
		this.earthTexture = buildEarthTexture( pixi );
		this.earth = new pixi.Sprite( this.earthTexture );
		this.earth.tint = EARTH_NIGHT;
		this.root.addChild( this.earth );

		// Clouds — the flat gradient sky needed WEATHER. They drift
		// slowly across, wrap around, and all but vanish after dark.
		this.cloudRoot = new pixi.Container();
		this.root.addChild( this.cloudRoot );
		for ( let i = 0; i < CLOUD_COUNT; i++ ) {
			const sprite = new pixi.Sprite( this.cloudTexture );
			sprite.anchor.set( 0.5 );
			const stretch = 0.9 + Math.random() * 1.4;
			sprite.scale.x = stretch;
			sprite.scale.y = 0.7 + Math.random() * 0.5;
			this.cloudRoot.addChild( sprite );
			this.clouds.push( {
				sprite,
				y01: 0.06 + Math.random() * 0.38,
				speed: 3 + Math.random() * 5,
				baseAlpha: 0.35 + Math.random() * 0.3,
				offset01: ( i + Math.random() ) / CLOUD_COUNT,
				width: 220 * stretch,
			} );
		}

		this.sun = new pixi.Sprite( this.discTexture );
		this.sun.anchor.set( 0.5 );
		this.moon = new pixi.Sprite( this.discTexture );
		this.moon.anchor.set( 0.5 );
		this.root.addChild( this.sun );
		this.root.addChild( this.moon );
		this.layoutClouds( 0 );
	}

	/**
	 * Position the clouds for time `t` — stateless (pure function of t)
	 * so pauses, reduced motion, and resizes all land on a valid layout.
	 */
	private layoutClouds( t: number ): void {
		for ( const cloud of this.clouds ) {
			const span = this.width + cloud.width * 2;
			const travelled =
				( cloud.offset01 * span + t * cloud.speed * ( this.width / 1500 ) ) % span;
			cloud.sprite.x = travelled - cloud.width;
			cloud.sprite.y = cloud.y01 * this.height;
			cloud.sprite.alpha = cloud.baseAlpha * this.cloudLight;
		}
	}

	/**
	 * Resize to cover the canvas and reposition everything.
	 *
	 * @param width      Canvas width (CSS px).
	 * @param height     Canvas height (CSS px).
	 * @param groundLine Y of the tree's ground line; the earth band's
	 *                   soft top edge blends in just above it. Defaults
	 *                   near the bottom.
	 */
	public resize( width: number, height: number, groundLine?: number ): void {
		this.width = Math.max( 1, width );
		this.height = Math.max( 1, height );
		this.groundLine = groundLine ?? this.height * 0.94;
		this.gradient.scale.x = this.width / 8;
		this.gradient.scale.y = this.height / 256;
		// The band's transparent→opaque ramp must hide INSIDE the turf:
		// start it barely above the ground line so the grass blades (which
		// reach well past it) fully cover the blend — starting higher
		// painted a visible dark smear across the sky above the lawn.
		const bandTop = this.groundLine - 10;
		this.earth.x = 0;
		this.earth.y = bandTop;
		this.earth.scale.x = this.width / 8;
		this.earth.scale.y = Math.max( 0.4, ( this.height - bandTop + 8 ) / 128 );
		this.layoutStars();
		this.layoutClouds( 0 );
	}

	/**
	 * Place the star field as a disc around the celestial pole — a point
	 * below the horizon's centre, so rotating the field arcs the stars
	 * east → west overhead exactly like the sun. The container's pivot
	 * sits on the pole; `applyState` only touches `rotation`.
	 */
	private layoutStars(): void {
		const poleX = this.width * 0.5;
		const poleY = this.height * 1.3;
		// Reach the top corners from the pole with margin to spare.
		const fieldRadius = Math.hypot( this.width * 0.5, poleY ) + 40;
		this.starRoot.pivot?.set( poleX, poleY );
		this.starRoot.x = poleX;
		this.starRoot.y = poleY;
		for ( const star of this.stars ) {
			star.sprite.x = poleX + Math.cos( star.theta ) * star.r01 * fieldRadius;
			star.sprite.y = poleY + Math.sin( star.theta ) * star.r01 * fieldRadius;
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
		// Diurnal wheel: the whole field turns around the pole with the
		// clock (2π per day — real-sky slow, tuner-slider visible).
		this.starRoot.rotation = state.starAngle;

		// Earth follows the ambient light: mossy loam by day, near-black
		// moonlit ground at night.
		this.earth.tint = lerpColor( EARTH_NIGHT, EARTH_DAY, state.light01 );

		// Clouds: bright white by day, faint blue-grey ghosts by night.
		this.cloudLight = 0.12 + 0.88 * state.light01;
		for ( const cloud of this.clouds ) {
			cloud.sprite.tint = lerpColor( 0x39415e, 0xffffff, state.light01 );
			cloud.sprite.alpha = cloud.baseAlpha * this.cloudLight;
		}

		const discSize = Math.max( 70, Math.min( this.width, this.height ) * 0.16 );
		// The sun warms as it drops: pale gold at noon, ember at the
		// horizon — the altitude IS the colour cue for dawn/dusk.
		const altitude01 = Math.min(
			1,
			Math.max( 0, ( 0.86 - state.sunY01 ) / 0.64 ),
		);
		this.sun.tint = lerpColor( 0xffab5e, 0xfff2c4, altitude01 );
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

	/**
	 * Twinkle the stars, drift the clouds, fly the shooting stars
	 * (cheap; every frame).
	 */
	public tick( t: number ): void {
		this.layoutClouds( t );
		if ( this.starAlpha <= 0.01 ) {
			this.lastTickT = t;
			return;
		}
		const dt = Math.min( 0.1, Math.max( 0, t - this.lastTickT ) );
		this.lastTickT = t;
		for ( const star of this.stars ) {
			// Shallow twinkle: stars shimmer, they don't blink out.
			const flick = 0.8 + 0.2 * Math.sin( t * star.twinkle + star.phase );
			star.sprite.alpha = star.baseAlpha * flick;
		}

		// Shooting stars: only after dark, ~2/min on average, short
		// diagonal streaks that burn out in half a second.
		if ( this.starAlpha > 0.3 && Math.random() < dt * ( SHOOTING_STARS_PER_MINUTE / 60 ) ) {
			const meteor = this.shooting.find( ( m ) => ! m.active );
			if ( meteor ) {
				meteor.active = true;
				meteor.life = 0.5;
				meteor.x = this.width * ( 0.1 + Math.random() * 0.8 );
				meteor.y = this.height * ( 0.05 + Math.random() * 0.3 );
				const angle =
					Math.PI * 0.25 +
					Math.random() * Math.PI * 0.5 +
					( Math.random() < 0.5 ? Math.PI * 0.5 : 0 );
				const speed = 900 + Math.random() * 500;
				meteor.vx = Math.cos( angle ) * speed * ( Math.random() < 0.5 ? -1 : 1 );
				meteor.vy = Math.abs( Math.sin( angle ) ) * speed * 0.45;
				meteor.sprite.rotation = Math.atan2( meteor.vy, meteor.vx );
				meteor.sprite.visible = true;
			}
		}
		for ( const meteor of this.shooting ) {
			if ( ! meteor.active ) {
				continue;
			}
			meteor.life -= dt;
			meteor.x += meteor.vx * dt;
			meteor.y += meteor.vy * dt;
			meteor.sprite.x = meteor.x;
			meteor.sprite.y = meteor.y;
			meteor.sprite.alpha = Math.max( 0, meteor.life / 0.5 ) * this.starAlpha;
			if ( meteor.life <= 0 || meteor.y > this.groundLine ) {
				meteor.active = false;
				meteor.sprite.visible = false;
			}
		}
	}

	/** Release the sky's own textures. */
	public destroy(): void {
		this.root.destroy( { children: true } );
		try {
			this.gradientTexture.destroy( true );
			this.earthTexture.destroy( true );
			this.discTexture.destroy( true );
			this.starTexture.destroy( true );
			this.brightStarTexture.destroy( true );
			this.cloudTexture.destroy( true );
			this.streakTexture.destroy( true );
		} catch {
			/* already released with the container */
		}
	}
}
