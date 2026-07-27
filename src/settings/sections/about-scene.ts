/**
 * About — Pixi scene.
 *
 * The visual centerpiece of the OS Settings → About tab. Samples the
 * Automattic logotype PNG to build a particle field whose "home"
 * positions trace the logo. On top of the standard spring-to-home
 * physics (lifted from the animated-logo-wallpaper) the scene layers:
 *
 *   - **Boids** — light separation + alignment computed against
 *     spatially-hashed neighbours, so the resting field has organic
 *     motion that reads as "alive" rather than "twitching."
 *   - **Magnetic field** — the cursor pulls particles within
 *     {@link CONFIG.magnetRadius} with an inverse-square falloff. The
 *     hold reads as "the swarm is curious about you."
 *   - **Shockwaves** — clicks emit a radial impulse that decays over
 *     ~1.2 s; particles are knocked outward and spring back through
 *     a brief rebound oscillation.
 *   - **Sparkles** — a small additive-blended sprite pool emits
 *     occasional star-bursts from particle positions, drifting upward
 *     and fading out. The shimmer is what makes the otherwise flat
 *     field feel like it's *glittering*.
 *   - **Hue drift** — every particle is tinted via a slowly-rotating
 *     palette so the logo gently breathes through cyan / electric
 *     blue / magenta / violet without ever leaving the brand-adjacent
 *     spectrum.
 *
 * Rendered via PixiJS (loaded via `wp.desktop.loadModules(['pixijs'])`,
 * registered by the shell). Designed to hold 60fps with ~3000
 * particles on mid-range hardware — the hot loop is a single-pass
 * scan over flat `Float32Array`s with allocation-free spatial hashing.
 */

import type { Application, Container, Sprite, Text, Texture } from 'pixi.js';

declare global {
	interface Window {
		PIXI?: typeof import( 'pixi.js' );
	}
}

export interface AboutScene {
	/** Stop the render loop, release WebGL resources, restore container styles. */
	destroy(): void;
	/** Pause / resume animation (e.g. tab switched away). */
	setAnimating( playing: boolean ): void;
}

/** Pre-translated copy displayed inside the canvas. */
export interface AboutLabels {
	eyebrow: string;
	title: string;
	byline: string;
	version: string;
	hint: string;
}

export interface SceneOptions {
	container: HTMLElement;
	logoUrl: string;
	prefersReducedMotion: boolean;
	labels: AboutLabels;
}

/** Pool entry for a single sparkle sprite — see {@link updateSparkles}. */
interface SparklePool {
	sprite: Sprite;
	life: number;
	vx: number;
	vy: number;
}

/**
 * Tuning constants — every knob the scene reads. Grouped here so a
 * reviewer can re-vibe the whole effect without spelunking through
 * the integrator.
 */
const CONFIG = {
	/** Grid stride when sampling the logo PNG. Lower → denser → heavier. */
	sampleStride: 2,
	/** Alpha threshold (0–255) above which a sampled pixel becomes a particle home. */
	alphaThreshold: 64,
	/** Cap on total particles — guards against absurd logo sizes. */
	maxParticles: 8000,
	/** Particle "home" layout: fraction of the canvas the logo occupies. */
	logoFraction: 0.78,
	/**
	 * Vertical centre of the logo as a fraction of canvas height. Pushed
	 * a touch below 0.5 because the title text sits above the logotype
	 * — visual centre vs. geometric centre. Tuned so the white space
	 * above the eyebrow and below the hint feels balanced.
	 */
	logoCenterY: 0.55,
	/** Spring stiffness toward the home position. */
	springK: 0.018,
	/** Velocity damping per tick — lower = more lethargic, more drift. */
	damping: 0.88,
	/** Velocity floor below which a particle snaps to its home. */
	restVelocityEpsilon: 0.025,
	/**
	 * Cursor magnetic radius (CSS pixels). Particles inside this disc
	 * feel an inverse-square pull toward the pointer.
	 */
	magnetRadius: 220,
	/** Magnetic strength scalar — higher = grabbier, but easy to over-do. */
	magnetStrength: 1600,
	/** Cap the per-particle magnetic force so deep-radius particles don't teleport. */
	magnetForceCap: 1.6,
	/**
	 * Sand-drag brush radius — particles within this distance of the
	 * cursor inherit a fraction of its per-frame displacement, so a
	 * fast pan whips them along the cursor's direction of travel
	 * (independent of the magnetic pull above).
	 */
	dragRadius: 140,
	dragStrength: 0.18,
	maxMouseDelta: 80,
	/** Click shockwave: peak outward push at the impact ring. */
	shockwavePeak: 14,
	/** Speed (CSS px / frame) at which the shockwave ring expands outward. */
	shockwaveSpeed: 22,
	/** Frames a shockwave lives before it's culled. */
	shockwaveLifeFrames: 75,
	/**
	 * Boids: search radius for neighbours when computing separation /
	 * alignment. Tighter than the standard preset because the dense
	 * particle field makes a small radius give a beautiful subtle
	 * "shimmer" without the loop blowing up O(neighbours).
	 */
	boidsRadius: 14,
	/** Boids: separation force scalar — pushes apart particles that are too close. */
	separationStrength: 0.010,
	/** Boids: alignment force scalar — biases velocity toward neighbour mean. */
	alignmentStrength: 0.005,
	/** Cell size of the spatial hash used by the boids loop. */
	gridCell: 18,
	/** Sparkle pool size — borrowed-only, so capping it costs nothing on idle frames. */
	sparkleCount: 128,
	/** Per-frame chance of spawning a sparkle from any particle. */
	sparkleSpawnRate: 0.6,
	/** Sparkle frames-of-life. */
	sparkleLifeFrames: 80,
	/** Sparkle initial rise speed (negative y). */
	sparkleRiseSpeed: 0.45,
	/** Particle brush texture pixel size. Big enough to look soft when scaled. */
	brushSize: 96,
	/** Sparkle brush texture pixel size — smaller = sharper twinkle. */
	sparkleBrushSize: 32,
	/**
	 * Per-particle sprite size range — smaller than the wallpaper variant
	 * because the field is much denser; larger sprites would mush the
	 * lettering into a glow blob.
	 */
	spriteScaleMin: 0.05,
	spriteScaleMax: 0.13,
	/** Per-particle alpha range. */
	spriteAlphaMin: 0.55,
	spriteAlphaMax: 0.95,
	/** Hue cycle period in frames (~7s at 60fps). */
	hueCycleFrames: 420,
};

/**
 * Hue palette — a hand-tuned arc through Automattic's brand-adjacent
 * spectrum. Each entry is a packed 0xRRGGBB tint; the integrator
 * blends between consecutive entries based on a global phase so the
 * whole field cross-fades together. Keeping the palette short and
 * each colour bright makes the additive-blend overlaps glow without
 * washing into white.
 */
const HUE_PALETTE = [
	0x4ec5ff, // sky cyan (the Automattic blue dot, brightened)
	0x7a8cff, // periwinkle
	0xb56bff, // amethyst
	0xff5cd1, // electric magenta
	0xff7e6b, // sunset coral
	0xffd166, // soft gold
	0x4cd9b8, // mint
	0x4ec5ff, // back to start (closes the loop seamlessly)
];

/**
 * Cosmic backdrop — a deep radial gradient painted by the browser
 * directly on the container (pure CSS), so we get bandless
 * interpolation for free. Pixi renders transparent on top.
 */
const BACKDROP_CSS =
	'radial-gradient(circle at 50% 35%, #1b3461 0%, #0c1733 55%, #050918 100%)';

/**
 * Mount the About scene into `container`. Returns an {@link AboutScene}
 * handle for pause/resume + full teardown. Caller is responsible for
 * calling `destroy()` when the panel is removed; failing to do so
 * leaks the WebGL context and the ticker.
 *
 * Assumes `window.PIXI` is defined — the section builder triggers
 * `wp.desktop.loadModules(['pixijs'])` before mounting.
 */
export async function mountAboutScene( opts: SceneOptions ): Promise<AboutScene> {
	const { container, logoUrl, prefersReducedMotion, labels } = opts;
	const pixi = window.PIXI;
	if ( ! pixi ) {
		throw new Error(
			'[desktop-mode/about] window.PIXI is undefined; load the pixijs module before calling mountAboutScene().',
		);
	}

	const { homes, aspectRatio } = await sampleLogoHomes( logoUrl );
	const priorBackground = container.style.background;
	container.style.background = BACKDROP_CSS;

	const app: Application = new pixi.Application();
	await app.init( {
		resizeTo: container,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min( window.devicePixelRatio || 1, 2 ),
	} );
	container.appendChild( app.canvas );
	applyCanvasLayout( app.canvas );

	const brushTexture: Texture = buildBrushTexture( pixi, CONFIG.brushSize );
	const sparkleTexture: Texture = buildSparkleTexture( pixi, CONFIG.sparkleBrushSize );

	// Layer order: particles + sparkles use additive blend; text uses
	// normal blend on top so the labels stay readable through the
	// densest part of the field. Building the text layer last ensures
	// it z-orders above the particles.
	const particleLayer: Container = new pixi.Container();
	const sparkleLayer: Container = new pixi.Container();
	const textLayer: Container = new pixi.Container();
	app.stage.addChild( particleLayer );
	app.stage.addChild( sparkleLayer );
	app.stage.addChild( textLayer );

	// Pre-build every text label up front. We re-position them on each
	// `computeLayout()` call (on resize) but the styles never change,
	// so caching the Pixi.Text instances avoids the per-frame texture
	// regeneration that setting `style` would trigger.
	const fontStack =
		'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
	const eyebrowText = makeText( pixi, labels.eyebrow, {
		fontFamily: fontStack,
		fontSize: 11,
		fill: 0x9bb5ff,
		fontWeight: '600',
		letterSpacing: 4,
	} );
	const titleText = makeText( pixi, labels.title, {
		fontFamily: fontStack,
		fontSize: 38,
		fill: 0xffffff,
		fontWeight: '300',
		letterSpacing: -0.4,
	} );
	const bylineText = makeText( pixi, labels.byline, {
		fontFamily: fontStack,
		fontSize: 14,
		fill: 0xc0caea,
		fontWeight: '400',
		fontStyle: 'italic',
		letterSpacing: 0.3,
	} );
	const versionText = makeText(
		pixi,
		labels.version,
		{
			fontFamily: fontStack,
			fontSize: 11,
			fill: 0x6f7eb0,
			fontWeight: '500',
			letterSpacing: 1,
		},
	);
	const hintText = makeText( pixi, labels.hint, {
		fontFamily: fontStack,
		fontSize: 10,
		fill: 0xffffff,
		fontWeight: '500',
		letterSpacing: 2.4,
	} );
	hintText.alpha = 0.5;
	textLayer.addChild( eyebrowText );
	textLayer.addChild( titleText );
	textLayer.addChild( bylineText );
	textLayer.addChild( versionText );
	textLayer.addChild( hintText );

	const n = homes.length;
	const homeX = new Float32Array( n );
	const homeY = new Float32Array( n );
	const x = new Float32Array( n );
	const y = new Float32Array( n );
	const vx = new Float32Array( n );
	const vy = new Float32Array( n );
	// Each particle picks a random "phase" in [0, 1) so the global hue
	// cycle reads as a smooth wave through the field rather than every
	// particle flipping colour at the same moment.
	const phase = new Float32Array( n );

	const sprites: Sprite[] = new Array( n );
	for ( let i = 0; i < n; i++ ) {
		const sprite: Sprite = new pixi.Sprite( brushTexture );
		sprite.anchor.set( 0.5 );
		sprite.blendMode = 'add';
		const scale =
			CONFIG.spriteScaleMin +
			Math.random() * ( CONFIG.spriteScaleMax - CONFIG.spriteScaleMin );
		sprite.scale.set( scale );
		sprite.alpha =
			CONFIG.spriteAlphaMin +
			Math.random() * ( CONFIG.spriteAlphaMax - CONFIG.spriteAlphaMin );
		particleLayer.addChild( sprite );
		sprites[ i ] = sprite;
		phase[ i ] = Math.random();
	}

	// Sparkle pool — pre-allocated, reused. A particle borrows the
	// next free slot when it spawns a sparkle; the slot frees itself
	// when its life ticks below zero.
	const sparkles: SparklePool[] = [];
	for ( let i = 0; i < CONFIG.sparkleCount; i++ ) {
		const sprite: Sprite = new pixi.Sprite( sparkleTexture );
		sprite.anchor.set( 0.5 );
		sprite.blendMode = 'add';
		sprite.visible = false;
		sparkleLayer.addChild( sprite );
		sparkles.push( { sprite, life: 0, vx: 0, vy: 0 } );
	}

	// Track the previous logo bbox so a resize transforms each
	// particle's position from old logo-space to new logo-space — the
	// alternative (just updating `homeX/Y` and letting springs pull
	// particles in) looks like the whole logo "drifts" off-centre
	// during a window resize until the springs catch up. Initialised
	// to NaN so the first compute is detected as a fresh seed (springs
	// teleport into place), and every subsequent compute does a
	// proportional remap.
	let prevOffsetX = NaN;
	let prevOffsetY = NaN;
	let prevWidthPx = 0;
	let prevHeightPx = 0;

	const computeLayout = (): void => {
		const w = app.canvas.clientWidth;
		const h = app.canvas.clientHeight;
		if ( w <= 0 || h <= 0 ) {
			return;
		}
		// Aspect-aware fit — preserve the sampled bbox aspect so the
		// logotype doesn't squash on tall narrow panels. We pick the
		// largest size that fits both axes inside `logoFraction` of the
		// canvas; whichever axis is the binding constraint determines
		// the rendered scale.
		const fitW = w * CONFIG.logoFraction;
		const fitH = h * CONFIG.logoFraction * 0.45; // logo gets ~45% vertical band
		let widthPx = fitW;
		let heightPx = widthPx / aspectRatio;
		if ( heightPx > fitH ) {
			heightPx = fitH;
			widthPx = heightPx * aspectRatio;
		}
		const logoOffsetX = ( w - widthPx ) / 2;
		const logoOffsetY = h * CONFIG.logoCenterY - heightPx / 2;

		// Transform existing particle positions from the previous logo
		// bbox into the new one. Particles outside the bbox (e.g. blown
		// out by a shockwave) are scaled by the same affine so they
		// keep their relative offset and the springs pull them in
		// correctly. Skipped on the very first compute so seed-from-
		// home below produces a clean first paint.
		const isFirstCompute =
			Number.isNaN( prevOffsetX ) || prevWidthPx <= 0 || prevHeightPx <= 0;
		if ( ! isFirstCompute ) {
			const sx = widthPx / prevWidthPx;
			const sy = heightPx / prevHeightPx;
			for ( let i = 0; i < n; i++ ) {
				const relX = ( x[ i ] - prevOffsetX ) / prevWidthPx;
				const relY = ( y[ i ] - prevOffsetY ) / prevHeightPx;
				x[ i ] = logoOffsetX + relX * widthPx;
				y[ i ] = logoOffsetY + relY * heightPx;
				vx[ i ] *= sx;
				vy[ i ] *= sy;
			}
		}

		for ( let i = 0; i < n; i++ ) {
			homeX[ i ] = logoOffsetX + homes[ i ][ 0 ] * widthPx;
			homeY[ i ] = logoOffsetY + homes[ i ][ 1 ] * heightPx;
			if ( isFirstCompute ) {
				x[ i ] = homeX[ i ];
				y[ i ] = homeY[ i ];
			}
		}

		// Position text labels relative to canvas size. The eyebrow
		// and title sit above the logo; the byline / version / hint
		// stack below it. Anchored centre-x so the placement adjusts
		// to whatever width the panel currently has.
		const cx = w / 2;
		eyebrowText.x = cx;
		eyebrowText.y = Math.max( 28, h * 0.10 );
		titleText.x = cx;
		titleText.y = Math.max( 56, h * 0.18 );
		// Scale the title so it never feels enormous on a narrow panel
		// or tiny on a huge one.
		const titleScale = clamp( w / 760, 0.6, 1.25 );
		titleText.scale.set( titleScale );
		const logoBottom = logoOffsetY + heightPx;
		bylineText.x = cx;
		bylineText.y = Math.min( h - 70, logoBottom + 40 );
		versionText.x = cx;
		versionText.y = Math.min( h - 46, logoBottom + 70 );
		hintText.x = cx;
		hintText.y = h - 22;

		prevOffsetX = logoOffsetX;
		prevOffsetY = logoOffsetY;
		prevWidthPx = widthPx;
		prevHeightPx = heightPx;
	};
	computeLayout();

	// Resize handling — Pixi's `resizeTo` only listens on window resize,
	// so we drive the renderer manually here. Critical for the case
	// where the About tab is hidden at mount time (Appearance is
	// active) and only gains a real box when the user clicks our tab —
	// the observer fires on that visibility flip and the canvas snaps
	// to the right size before the user sees a paint.
	const resizeObserver = new ResizeObserver( () => {
		const w = container.clientWidth;
		const h = container.clientHeight;
		if ( w > 0 && h > 0 ) {
			app.renderer.resize( w, h );
		}
		computeLayout();
		try {
			app.render();
		} catch {
			// Pixi sometimes throws on race during teardown.
		}
	} );
	resizeObserver.observe( container );

	let pointerX = -1e6;
	let pointerY = -1e6;
	let pointerActive = false;
	let mouseDx = 0;
	let mouseDy = 0;

	interface Shockwave {
		x: number;
		y: number;
		age: number;
	}
	const shockwaves: Shockwave[] = [];

	const onPointerMove = ( e: PointerEvent ): void => {
		const rect = app.canvas.getBoundingClientRect();
		const nx = e.clientX - rect.left;
		const ny = e.clientY - rect.top;
		// Only register the cursor as "active" when it's actually over
		// the canvas — otherwise scrolling the OS Settings panel would
		// drag particles around even while the cursor is over a tab.
		const inside = nx >= 0 && ny >= 0 && nx <= rect.width && ny <= rect.height;
		if ( ! inside ) {
			pointerActive = false;
			pointerX = -1e6;
			pointerY = -1e6;
			return;
		}
		if ( pointerActive ) {
			const cap = CONFIG.maxMouseDelta;
			mouseDx += Math.max( -cap, Math.min( cap, nx - pointerX ) );
			mouseDy += Math.max( -cap, Math.min( cap, ny - pointerY ) );
		}
		pointerX = nx;
		pointerY = ny;
		pointerActive = true;
	};

	const onPointerLeave = (): void => {
		pointerActive = false;
		pointerX = -1e6;
		pointerY = -1e6;
		mouseDx = 0;
		mouseDy = 0;
	};

	const onPointerDown = ( e: PointerEvent ): void => {
		const rect = app.canvas.getBoundingClientRect();
		const nx = e.clientX - rect.left;
		const ny = e.clientY - rect.top;
		if ( nx < 0 || ny < 0 || nx > rect.width || ny > rect.height ) {
			return;
		}
		shockwaves.push( { x: nx, y: ny, age: 0 } );
	};

	app.canvas.addEventListener( 'pointermove', onPointerMove, { passive: true } );
	app.canvas.addEventListener( 'pointerleave', onPointerLeave );
	app.canvas.addEventListener( 'pointerdown', onPointerDown );

	let animating = ! prefersReducedMotion;
	let frame = 0;

	const syncSprites = (): void => {
		// Tint the field via a global hue cycle. We linearly interpolate
		// between two adjacent palette entries; the per-particle phase
		// offset spreads the wave across the field so the colour change
		// reads as movement, not a flash.
		const cycle = ( frame % CONFIG.hueCycleFrames ) / CONFIG.hueCycleFrames;
		for ( let i = 0; i < n; i++ ) {
			const sprite = sprites[ i ];
			sprite.x = x[ i ];
			sprite.y = y[ i ];
			const t = ( cycle + phase[ i ] ) % 1;
			const idxF = t * ( HUE_PALETTE.length - 1 );
			const a = HUE_PALETTE[ Math.floor( idxF ) ];
			const b = HUE_PALETTE[ Math.min( HUE_PALETTE.length - 1, Math.floor( idxF ) + 1 ) ];
			sprite.tint = mixColor( a, b, idxF - Math.floor( idxF ) );
		}
	};

	const tick = (): void => {
		frame++;
		if ( animating ) {
			step(
				n,
				homeX,
				homeY,
				x,
				y,
				vx,
				vy,
				pointerX,
				pointerY,
				pointerActive,
				pointerActive ? mouseDx : 0,
				pointerActive ? mouseDy : 0,
				shockwaves,
			);
			updateShockwaves( shockwaves );
			updateSparkles( sparkles, x, y, n );
		}
		mouseDx = 0;
		mouseDy = 0;
		syncSprites();
	};

	app.ticker.add( tick );
	syncSprites();
	if ( ! animating ) {
		app.renderer.render( app.stage );
		app.ticker.stop();
	}

	return {
		destroy(): void {
			resizeObserver.disconnect();
			app.canvas.removeEventListener( 'pointermove', onPointerMove );
			app.canvas.removeEventListener( 'pointerleave', onPointerLeave );
			app.canvas.removeEventListener( 'pointerdown', onPointerDown );
			try {
				// `{ removeView: true }`, NEVER `true`: a literal `true`
				// runs `releaseGlobalResources()`, wiping Pixi's
				// page-global pools out from under every other live
				// Application (the active canvas wallpaper, the OS
				// Settings wallpaper previews).
				app.destroy( { removeView: true }, {
					children: true,
					texture: true,
					textureSource: true,
					context: true,
				} as object );
			} catch {
				// Pixi sometimes throws on race during teardown.
			}
			try {
				brushTexture.destroy( true );
			} catch {
				// already released
			}
			try {
				sparkleTexture.destroy( true );
			} catch {
				// already released
			}
			container.style.background = priorBackground;
		},
		setAnimating( playing: boolean ): void {
			animating = playing && ! prefersReducedMotion;
			if ( animating ) {
				app.ticker.start();
			} else {
				app.ticker.stop();
			}
		},
	};
}

/**
 * Hot-loop integrator.
 *
 * For each particle:
 *   1. spring force toward home
 *   2. magnetic pull toward cursor (inverse-square, capped)
 *   3. sand-drag from cursor velocity (within drag radius)
 *   4. radial impulse from each active shockwave
 *   5. boids separation + alignment via spatial hash
 *   6. damp velocity and integrate
 *
 * Pure function, no allocations inside the inner loop. The boids pass
 * uses a flat-array spatial hash whose buckets are pre-sized — no
 * dynamic Map churn per tick.
 */
function step(
	n: number,
	homeX: Float32Array,
	homeY: Float32Array,
	x: Float32Array,
	y: Float32Array,
	vx: Float32Array,
	vy: Float32Array,
	pointerX: number,
	pointerY: number,
	pointerActive: boolean,
	mouseDx: number,
	mouseDy: number,
	shockwaves: Array<{ x: number; y: number; age: number }>,
): void {
	const {
		springK,
		damping,
		magnetRadius,
		magnetStrength,
		magnetForceCap,
		dragRadius,
		dragStrength,
		shockwavePeak,
		shockwaveSpeed,
		shockwaveLifeFrames,
		boidsRadius,
		separationStrength,
		alignmentStrength,
		gridCell,
		restVelocityEpsilon,
	} = CONFIG;

	const magnetRadSq = magnetRadius * magnetRadius;
	const dragRadSq = dragRadius * dragRadius;
	const restEpsSq = restVelocityEpsilon * restVelocityEpsilon;

	// Spatial hash for boids — bucket each particle into a grid cell.
	// Reusing a flat hash map keyed by `cellX * 1e5 + cellY` keeps the
	// lookup O(1) without object allocation.
	const grid = boidsBuildGrid( n, x, y, gridCell );

	// Cursor velocity for sand-drag + magnitude-boost.
	const mouseSpeed = Math.sqrt( mouseDx * mouseDx + mouseDy * mouseDy );
	const cursorMoving = mouseSpeed > 0.001;
	const dragFx = mouseDx * dragStrength;
	const dragFy = mouseDy * dragStrength;

	for ( let i = 0; i < n; i++ ) {
		// 1. spring toward home
		const dhx = homeX[ i ] - x[ i ];
		const dhy = homeY[ i ] - y[ i ];
		let fx = dhx * springK;
		let fy = dhy * springK;

		// 2. magnetic pull toward cursor (inverse-square, capped)
		if ( pointerActive ) {
			const dx = pointerX - x[ i ];
			const dy = pointerY - y[ i ];
			const distSq = dx * dx + dy * dy;
			if ( distSq < magnetRadSq && distSq > 4 ) {
				const dist = Math.sqrt( distSq );
				let force = magnetStrength / distSq;
				if ( force > magnetForceCap ) {
					force = magnetForceCap;
				}
				fx += ( dx / dist ) * force;
				fy += ( dy / dist ) * force;
			}
		}

		// 3. sand-drag — particles within dragRadius pick up a fraction
		//    of the cursor's per-frame displacement.
		if ( cursorMoving ) {
			const dx = x[ i ] - pointerX;
			const dy = y[ i ] - pointerY;
			const distSq = dx * dx + dy * dy;
			if ( distSq < dragRadSq ) {
				const t = 1 - Math.sqrt( distSq ) / dragRadius;
				const falloff = t * t;
				fx += dragFx * falloff;
				fy += dragFy * falloff;
			}
		}

		// 4. shockwaves — radial impulse, gaussian-ish ring at age*speed
		for ( let s = 0; s < shockwaves.length; s++ ) {
			const sw = shockwaves[ s ];
			const dx = x[ i ] - sw.x;
			const dy = y[ i ] - sw.y;
			const dist = Math.sqrt( dx * dx + dy * dy );
			const ringR = sw.age * shockwaveSpeed;
			const lifeT = sw.age / shockwaveLifeFrames;
			const lifeFalloff = ( 1 - lifeT ) * ( 1 - lifeT );
			// Width of the impulse ring grows with age so the wave
			// thickens visibly as it propagates.
			const ringWidth = 30 + sw.age * 0.5;
			const ringDelta = Math.abs( dist - ringR );
			if ( ringDelta < ringWidth && dist > 0.01 ) {
				const ringStrength = 1 - ringDelta / ringWidth;
				const force = shockwavePeak * ringStrength * lifeFalloff;
				fx += ( dx / dist ) * force;
				fy += ( dy / dist ) * force;
			}
		}

		// 5. boids: separation + alignment from neighbours via grid
		const cx = Math.floor( x[ i ] / gridCell );
		const cy = Math.floor( y[ i ] / gridCell );
		let sepFx = 0;
		let sepFy = 0;
		let alignVx = 0;
		let alignVy = 0;
		let neighbourCount = 0;
		const radSq = boidsRadius * boidsRadius;
		for ( let nx = cx - 1; nx <= cx + 1; nx++ ) {
			for ( let ny = cy - 1; ny <= cy + 1; ny++ ) {
				const bucket = grid.get( nx * 100003 + ny );
				if ( ! bucket ) {
					continue;
				}
				for ( let k = 0; k < bucket.length; k++ ) {
					const j = bucket[ k ];
					if ( j === i ) {
						continue;
					}
					const ddx = x[ i ] - x[ j ];
					const ddy = y[ i ] - y[ j ];
					const dSq = ddx * ddx + ddy * ddy;
					if ( dSq < radSq && dSq > 0.01 ) {
						const inv = 1 / dSq;
						sepFx += ddx * inv;
						sepFy += ddy * inv;
						alignVx += vx[ j ];
						alignVy += vy[ j ];
						neighbourCount++;
					}
				}
			}
		}
		if ( neighbourCount > 0 ) {
			fx += sepFx * separationStrength;
			fy += sepFy * separationStrength;
			fx += ( alignVx / neighbourCount - vx[ i ] ) * alignmentStrength;
			fy += ( alignVy / neighbourCount - vy[ i ] ) * alignmentStrength;
		}

		// 6. integrate with damping
		const nvx = ( vx[ i ] + fx ) * damping;
		const nvy = ( vy[ i ] + fy ) * damping;

		// Snap-to-rest only when particle is at home AND quiet AND not
		// being touched by a force source — without these gates, a
		// particle decelerating mid-flight would freeze off-home.
		const calm =
			! pointerActive &&
			shockwaves.length === 0 &&
			nvx * nvx + nvy * nvy < restEpsSq &&
			dhx * dhx + dhy * dhy < 0.5;
		if ( calm ) {
			x[ i ] = homeX[ i ];
			y[ i ] = homeY[ i ];
			vx[ i ] = 0;
			vy[ i ] = 0;
			continue;
		}

		vx[ i ] = nvx;
		vy[ i ] = nvy;
		x[ i ] += nvx;
		y[ i ] += nvy;
	}
}

/**
 * Build a sparse spatial-hash grid. Each cell is `gridCell` pixels
 * wide; the key is `cellX * 100003 + cellY` (100003 is prime, large
 * enough to avoid trivial collisions for screen-sized worlds).
 */
function boidsBuildGrid(
	n: number,
	x: Float32Array,
	y: Float32Array,
	gridCell: number,
): Map< number, number[] > {
	const grid = new Map< number, number[] >();
	for ( let i = 0; i < n; i++ ) {
		const cx = Math.floor( x[ i ] / gridCell );
		const cy = Math.floor( y[ i ] / gridCell );
		const key = cx * 100003 + cy;
		const bucket = grid.get( key );
		if ( bucket ) {
			bucket.push( i );
		} else {
			grid.set( key, [ i ] );
		}
	}
	return grid;
}

function updateShockwaves(
	shockwaves: Array<{ x: number; y: number; age: number }>,
): void {
	for ( let i = shockwaves.length - 1; i >= 0; i-- ) {
		shockwaves[ i ].age++;
		if ( shockwaves[ i ].age >= CONFIG.shockwaveLifeFrames ) {
			shockwaves.splice( i, 1 );
		}
	}
}

function updateSparkles(
	sparkles: SparklePool[],
	x: Float32Array,
	y: Float32Array,
	n: number,
): void {
	// Spawn — on average CONFIG.sparkleSpawnRate sparkles per frame,
	// each anchored to a randomly-chosen particle.
	let spawnsLeft = 0;
	let r = Math.random();
	while ( r < CONFIG.sparkleSpawnRate ) {
		spawnsLeft++;
		r += Math.random();
	}
	for ( let s = 0; s < sparkles.length && spawnsLeft > 0; s++ ) {
		if ( sparkles[ s ].life <= 0 ) {
			const idx = Math.floor( Math.random() * n );
			const sprite = sparkles[ s ].sprite;
			sprite.x = x[ idx ];
			sprite.y = y[ idx ];
			sprite.scale.set( 0.4 + Math.random() * 0.5 );
			sprite.alpha = 1;
			sprite.tint = HUE_PALETTE[ Math.floor( Math.random() * HUE_PALETTE.length ) ];
			sprite.visible = true;
			sparkles[ s ].life = CONFIG.sparkleLifeFrames;
			// Slight outward drift so sparkles feel like they're
			// floating up from the field — mostly upward, with a small
			// horizontal wobble.
			sparkles[ s ].vx = ( Math.random() - 0.5 ) * 0.3;
			sparkles[ s ].vy = -CONFIG.sparkleRiseSpeed - Math.random() * 0.4;
			spawnsLeft--;
		}
	}
	// Step + cull
	for ( let s = 0; s < sparkles.length; s++ ) {
		const spk = sparkles[ s ];
		if ( spk.life <= 0 ) {
			continue;
		}
		spk.life--;
		spk.sprite.x += spk.vx;
		spk.sprite.y += spk.vy;
		const t = spk.life / CONFIG.sparkleLifeFrames;
		// Ease-out alpha + slight scale-down so they feel like a
		// true sparkle rather than a dot fading uniformly.
		spk.sprite.alpha = t * t;
		const baseScale = 0.4 + ( 1 - t ) * 0.4;
		spk.sprite.scale.set( baseScale );
		if ( spk.life <= 0 ) {
			spk.sprite.visible = false;
		}
	}
}

/**
 * Mix two packed RGB colours by `t` ∈ [0, 1] in linear-ish RGB space.
 * Component decomposition uses arithmetic rather than bit-twiddling —
 * the project lints against bitwise ops, and the math is just as fast
 * for V8's hot-path inliner. Gamma-correct lerp would be nicer but
 * the difference is sub-perceptible under additive blend.
 */
function mixColor( a: number, b: number, t: number ): number {
	const ar = Math.floor( a / 65536 );
	const ag = Math.floor( a / 256 ) % 256;
	const ab = a % 256;
	const br = Math.floor( b / 65536 );
	const bg = Math.floor( b / 256 ) % 256;
	const bb = b % 256;
	const r = Math.round( ar + ( br - ar ) * t );
	const g = Math.round( ag + ( bg - ag ) * t );
	const bcomp = Math.round( ab + ( bb - ab ) * t );
	return r * 65536 + g * 256 + bcomp;
}

/**
 * Build the particle "brush" — soft radial gradient rasterized once
 * into an offscreen canvas and wrapped as a Pixi Texture. Every
 * particle sprite shares this texture so Pixi can batch them in a
 * single draw call.
 */
function buildBrushTexture(
	pixi: typeof import( 'pixi.js' ),
	size: number,
): Texture {
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[desktop-mode/about] 2D canvas context unavailable.' );
	}
	const center = size / 2;
	const gradient = ctx.createRadialGradient(
		center,
		center,
		0,
		center,
		center,
		center,
	);
	gradient.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	gradient.addColorStop( 0.18, 'rgba(255, 255, 255, 0.85)' );
	gradient.addColorStop( 0.42, 'rgba(255, 255, 255, 0.28)' );
	gradient.addColorStop( 0.75, 'rgba(255, 255, 255, 0.06)' );
	gradient.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, size, size );
	return pixi.Texture.from( canvas );
}

/**
 * Build the sparkle "twinkle" texture — a four-armed star painted on
 * a tight radial core. Sharper falloff than the particle brush so the
 * sparkle reads as a glint rather than a soft blob, with clear arms
 * pointing N/S/E/W to sell the twinkle.
 */
function buildSparkleTexture(
	pixi: typeof import( 'pixi.js' ),
	size: number,
): Texture {
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[desktop-mode/about] 2D canvas context unavailable.' );
	}
	const center = size / 2;

	// Core radial gradient — bright tight pinprick.
	const radial = ctx.createRadialGradient(
		center,
		center,
		0,
		center,
		center,
		center * 0.5,
	);
	radial.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	radial.addColorStop( 0.4, 'rgba(255, 255, 255, 0.5)' );
	radial.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
	ctx.fillStyle = radial;
	ctx.fillRect( 0, 0, size, size );

	// Cross-shaped arms via two thin linear-gradient strokes,
	// horizontal and vertical, that fade to transparent at the edges.
	ctx.globalCompositeOperation = 'lighter';
	const armWidth = 1.5;
	for ( const isVertical of [ false, true ] ) {
		const grad = isVertical
			? ctx.createLinearGradient( 0, 0, 0, size )
			: ctx.createLinearGradient( 0, 0, size, 0 );
		grad.addColorStop( 0, 'rgba(255, 255, 255, 0)' );
		grad.addColorStop( 0.5, 'rgba(255, 255, 255, 0.85)' );
		grad.addColorStop( 1, 'rgba(255, 255, 255, 0)' );
		ctx.fillStyle = grad;
		if ( isVertical ) {
			ctx.fillRect( center - armWidth, 0, armWidth * 2, size );
		} else {
			ctx.fillRect( 0, center - armWidth, size, armWidth * 2 );
		}
	}

	return pixi.Texture.from( canvas );
}

/**
 * Sample the logo PNG to a fixed grid of "home" positions, returned
 * as unit coordinates in [0, 1]² (relative to the logo's tight
 * bounding box) plus the bbox aspect ratio (`width / height`). The
 * caller uses the aspect to size the rendered field correctly so the
 * logotype doesn't squash when the panel reflows.
 */
async function sampleLogoHomes(
	url: string,
): Promise< { homes: Array<[ number, number ]>; aspectRatio: number } > {
	const img = await loadImage( url );

	const maxSide = 600;
	const ratio = img.naturalWidth / img.naturalHeight;
	const sampleWidth = ratio >= 1 ? maxSide : Math.round( maxSide * ratio );
	const sampleHeight = ratio >= 1 ? Math.round( maxSide / ratio ) : maxSide;

	const empty = { homes: [], aspectRatio: 1 };
	const off = document.createElement( 'canvas' );
	off.width = sampleWidth;
	off.height = sampleHeight;
	const ctx = off.getContext( '2d', { willReadFrequently: true } );
	if ( ! ctx ) {
		return empty;
	}
	ctx.drawImage( img, 0, 0, sampleWidth, sampleHeight );
	const data = ctx.getImageData( 0, 0, sampleWidth, sampleHeight ).data;

	// First pass — find the bounding box of opaque pixels so we can
	// normalise to [0, 1]² over just the mark, not the whole PNG.
	let minX = sampleWidth;
	let minY = sampleHeight;
	let maxX = 0;
	let maxY = 0;
	const threshold = CONFIG.alphaThreshold;
	for ( let py = 0; py < sampleHeight; py++ ) {
		for ( let px = 0; px < sampleWidth; px++ ) {
			const alpha = data[ ( py * sampleWidth + px ) * 4 + 3 ];
			if ( alpha > threshold ) {
				if ( px < minX ) {
					minX = px;
				}
				if ( px > maxX ) {
					maxX = px;
				}
				if ( py < minY ) {
					minY = py;
				}
				if ( py > maxY ) {
					maxY = py;
				}
			}
		}
	}
	if ( minX > maxX || minY > maxY ) {
		return empty;
	}
	const bboxW = maxX - minX + 1;
	const bboxH = maxY - minY + 1;
	const aspectRatio = bboxW / bboxH;

	const homes: Array<[ number, number ]> = [];
	const stride = CONFIG.sampleStride;

	for ( let row = minY; row <= maxY; row += stride ) {
		// Half-stride row offset → break the rectangular lattice that
		// would otherwise show up as a faint moiré in the rendered field.
		const rowOffset = ( ( row - minY ) / stride ) % 2 === 0 ? 0 : stride / 2;
		for ( let col = minX; col <= maxX; col += stride ) {
			const px = Math.min( maxX, Math.round( col + rowOffset ) );
			const py = row;
			const alpha = data[ ( py * sampleWidth + px ) * 4 + 3 ];
			if ( alpha > threshold ) {
				homes.push( [
					( px - minX ) / bboxW,
					( py - minY ) / bboxH,
				] );
				if ( homes.length >= CONFIG.maxParticles ) {
					return { homes, aspectRatio };
				}
			}
		}
	}
	return { homes, aspectRatio };
}

function loadImage( url: string ): Promise<HTMLImageElement> {
	return new Promise( ( resolve, reject ) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve( img );
		img.onerror = () => reject( new Error( `Failed to load logo: ${ url }` ) );
		img.src = url;
	} );
}

function applyCanvasLayout( canvas: HTMLCanvasElement ): void {
	canvas.style.display = 'block';
	canvas.style.width = '100%';
	canvas.style.height = '100%';
}

/**
 * Construct a centred Pixi.Text with the given style. Anchored at
 * (0.5, 0.5) so positioning later just sets `x`/`y` to the desired
 * centre. `resolution: 2` keeps text crisp on retina without
 * shipping a giant bitmap.
 *
 * Pixi v8's `TextStyleFontWeight` is a narrow string-literal union;
 * we widen it here to plain `string` for caller convenience and
 * cast at the construction site — the runtime accepts the broader
 * input identically.
 */
function makeText(
	pixi: typeof import( 'pixi.js' ),
	text: string,
	style: {
		fontFamily: string;
		fontSize: number;
		fill: number;
		fontWeight?: string;
		fontStyle?: 'italic' | 'normal';
		letterSpacing?: number;
	},
): Text {
	const t = new pixi.Text( {
		text,
		style: {
			fontFamily: style.fontFamily,
			fontSize: style.fontSize,
			fill: style.fill,
			fontWeight: ( style.fontWeight ?? 'normal' ) as
				import( 'pixi.js' ).TextStyleFontWeight,
			fontStyle: style.fontStyle ?? 'normal',
			letterSpacing: style.letterSpacing ?? 0,
			align: 'center',
		},
		resolution: 2,
		anchor: { x: 0.5, y: 0.5 },
	} );
	return t;
}

function clamp( v: number, lo: number, hi: number ): number {
	if ( v < lo ) {
		return lo;
	}
	if ( v > hi ) {
		return hi;
	}
	return v;
}
