/**
 * Animated WP Logo — boids / particle scene.
 *
 * Samples the official WordPress "W" mark PNG (ships in `assets/images/`)
 * to build a dense grid of particle "home" positions. Each particle is
 * a tiny rendered blob that lives near its home via a spring + damping
 * model. The cursor acts as a repelling magnet — particles near the
 * pointer are pushed outward with an inverse-distance falloff, and
 * elastically spring back when the pointer leaves.
 *
 * Rendered with PixiJS (loaded via `needs: ['pixijs']` at the
 * wallpaper-definition level, so `window.PIXI` is guaranteed defined
 * by the time this module runs). Designed to hold a steady 60fps
 * with ~2.5k particles on mid-range hardware — the hot loop is a
 * plain array scan with no per-particle allocations.
 *
 * @since 0.6.0
 */

/**
 * PixiJS types. `import type` is compile-time only — the `pixi.js`
 * package is NOT bundled with our shell; it's loaded lazily via the
 * module registry (`needs: ['pixijs']`) and attaches a `PIXI` global
 * from the vendor script. We type that global as the module's full
 * namespace so every class access (`pixi.Application`, `pixi.Sprite`,
 * …) is checked against the library's first-party definitions with
 * zero runtime overhead.
 */
import type { Application, Container, Sprite, Texture } from 'pixi.js';

declare global {
	interface Window {
		PIXI?: typeof import( 'pixi.js' );
	}
}

export interface SceneHandle {
	/** Stop the render loop and release WebGL resources. */
	destroy(): void;
	/** Temporarily pause / resume animation (e.g. tab backgrounded). */
	setAnimating( playing: boolean ): void;
}

interface SceneOptions {
	container: HTMLElement;
	logoUrl: string;
	prefersReducedMotion: boolean;
}

/**
 * Sampling / physics / rendering tuning constants. All tuned together —
 * changing one usually means revisiting the others.
 */
const CONFIG = {
	/** Grid stride when sampling the logo PNG. Smaller → denser particle field → heavier frame cost. */
	sampleStride: 7,
	/** Alpha threshold (0–255) for "this pixel is part of the logo." */
	alphaThreshold: 128,
	/**
	 * Target logo rendering width in CSS pixels. Capped at this value
	 * on huge screens; on normal screens we take 72% of the smaller
	 * shell axis so the logo reads as "hero-sized" without cropping.
	 */
	targetLogoWidth: 1000,
	/** Fraction of the smaller shell dimension the logo is allowed to occupy. */
	logoShellFraction: 0.72,
	/**
	 * Logo width (CSS px) at which particle sprites render at their
	 * authored `spriteScale*` size. Below it, sprite scale shrinks
	 * proportionally — in a small container (an OS Settings preview
	 * tile) desktop-sized additive sprites pile into a single blown-out
	 * white blob instead of a legible particle logo. Never scales UP
	 * past 1× so full-desktop mounts look exactly as before.
	 */
	spriteReferenceWidth: 700,
	/**
	 * Spring stiffness — how hard a particle pulls back to its home.
	 * Lower = slower, floatier return. At 0.015 the natural-frequency
	 * period is ~50 frames (~0.85 s at 60 fps), so particles visibly
	 * drift back after a cursor flick rather than snapping home.
	 */
	springK: 0.015,
	/** Velocity damping per tick. 1 = no damping, 0 = instant stop. */
	damping: 0.86,
	/**
	 * Velocity floor below which a particle is considered at rest —
	 * its position snaps to its home and its velocity zeroes out. Kills
	 * the subpixel jitter that made the resting logo flicker.
	 */
	restVelocityEpsilon: 0.02,
	/**
	 * Sand-drag brush radius in CSS pixels. Particles within this
	 * distance of the cursor pick up a fraction of the cursor's
	 * per-frame displacement — they're carried in the direction the
	 * cursor is moving, not pushed away from its position. Beyond
	 * the radius the cursor has no effect.
	 */
	dragRadius: 150,
	/**
	 * Base fraction of the cursor's per-frame displacement that a
	 * particle inherits when it's at the dead center of the brush.
	 * At 0.22 a particle in the brush core picks up roughly a
	 * quarter of the cursor's velocity per frame — enough to read
	 * as "dragged" without the particles chasing the cursor.
	 */
	dragStrength: 0.22,
	/**
	 * Super-linear speed boost. For every {@link dragBoostRefSpeed}
	 * pixels-per-frame of cursor speed, the applied drag force is
	 * additionally scaled by this factor. Kept gentle (0.3) so fast
	 * flicks feel a bit punchier than linear without flinging
	 * particles across the screen.
	 */
	dragBoost: 0.3,
	/** Reference cursor speed for the boost curve (CSS px / frame). */
	dragBoostRefSpeed: 40,
	/**
	 * Cap on the mouse delta a single frame can accumulate. Prevents
	 * a wild delta from a stale pointer (e.g. first pointermove after
	 * the cursor entered from offscreen) from launching particles
	 * into orbit. A real fast mouse rarely exceeds 80 px/frame.
	 */
	maxMouseDelta: 80,
	/**
	 * Radial-gradient brush texture size. Larger = smoother edges at
	 * the cost of texture memory. 128px is plenty — sprites scale
	 * down to 10–30 px range for rendering so we have headroom.
	 */
	brushSize: 128,
	/** Min/max sprite scale relative to the brush texture size. */
	spriteScaleMin: 0.1,
	spriteScaleMax: 0.26,
	/** Min/max per-particle alpha. */
	spriteAlphaMin: 0.55,
	spriteAlphaMax: 0.92,
};

/**
 * Particle color palette — Progress Pride flag, rendered as an
 * inclusive field of color. Every stripe of the flag is represented:
 * the classic six-color rainbow (red, orange, yellow, green, blue,
 * purple), the trans flag (pink, light blue, white), and the POC
 * inclusion stripe (brown).
 *
 * Weighted so the rainbow stripes dominate by count — that's what
 * reads as "a rainbow of particles" — with the trans + POC colors
 * sprinkled through at lower frequency. Each entry is a packed
 * 0xRRGGBB tint; sprites multiply the white brush texture by this
 * color so additive-blend overlaps cross-fade between hues.
 *
 * Colors sampled from the widely-shared Progress Pride flag palette
 * (Daniel Quasar, 2018) at brightness boosted ~15% for readability
 * against the dark backdrop.
 *
 * Note on representation: the Pride flag's black stripe is omitted
 * here because additive blending (which gives us the luminous
 * cluster-glow effect) renders pure-black particles as invisible —
 * they can't add light to the backdrop. We keep the brown stripe
 * present and use a rich warm palette for the POC inclusion
 * symbolism; the black stripe is honored conceptually in the
 * inclusion design but can't be made visually present under this
 * blend mode without a separate render pass.
 */
const PARTICLE_PALETTE = [
	// Rainbow six (higher weight — the flag's main body).
	0xff3b3b, 0xff3b3b, // red
	0xff8c2a, 0xff8c2a, // orange
	0xffd93d, 0xffd93d, // yellow
	0x4cd964, 0x4cd964, // green
	0x3ea0ff, 0x3ea0ff, // blue
	0xa86bff, 0xa86bff, // purple
	// Trans flag stripes.
	0xffb3c7, // pink
	0x7fdfff, // light blue
	0xffffff, // white
	// POC inclusion stripe.
	0xc8804a, // warm brown (boosted for visibility under additive)
];

/**
 * CSS radial-gradient used as the backdrop. Painted by the browser
 * directly on the wallpaper container, so the shell does perfectly
 * smooth interpolation — Pixi Graphics can't produce gradients this
 * clean without shader work.
 */
const BACKDROP_CSS =
	'radial-gradient(circle at 50% 50%, #1e40af 0%, #152a6b 45%, #0a1024 100%)';

/**
 * Build and mount the Pixi scene into the given container. Returns a
 * handle for pause/resume + full teardown. `destroy` removes the
 * canvas element and the resize observer; tearing down without it
 * would leak the WebGL context.
 *
 * Assumes the caller has already ensured `window.PIXI` is defined —
 * the shell does this via `needs: ['pixijs']` on the wallpaper def.
 */
export async function mountScene(
	{ container, logoUrl, prefersReducedMotion }: SceneOptions,
): Promise<SceneHandle> {
	const pixi = window.PIXI;
	if ( ! pixi ) {
		throw new Error(
			'[animated-logo-wallpaper] window.PIXI is undefined; ' +
				'declare `needs: [\'pixijs\']` on the wallpaper def so ' +
				'the shell loads it before mount.',
		);
	}

	// Sample the logo upfront — done once, shared across resizes. The
	// sampled homes are unit coordinates (0..1 × 0..1) so we can scale
	// them on every layout pass without re-sampling.
	const homes = await sampleLogoHomes( logoUrl );

	// Paint the gradient via CSS on the container instead of drawing it
	// in Pixi — the browser produces a perfectly smooth radial gradient
	// with no banding, no per-frame cost, and no Pixi Graphics fill
	// approximations needed. The Pixi app renders transparent on top.
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

	// Brush texture — a single soft radial gradient rasterized once
	// into a Pixi-owned texture. Every particle is a sprite of this
	// texture, tinted per-particle and composited with additive blend
	// so clusters genuinely glow instead of just stacking flat colors.
	const brushTexture: Texture = buildBrushTexture( pixi );

	const particleLayer: Container = new pixi.Container();
	app.stage.addChild( particleLayer );

	// Particle state — flat typed arrays keep the hot tick loop free
	// of object allocations. `n` is hoisted so the sprite pre-allocation
	// just below can size to it.
	const n = homes.length;
	const homeX = new Float32Array( n );
	const homeY = new Float32Array( n );
	const x = new Float32Array( n );
	const y = new Float32Array( n );
	const vx = new Float32Array( n );
	const vy = new Float32Array( n );

	// Pre-allocate one sprite per particle. Varying scale, alpha, and
	// tint per particle is what sells the "beautiful" read — a uniform
	// grid of identical dots reads as sterile; a field with subtle
	// variation reads as organic.
	const sprites: Sprite[] = new Array( n );
	// Authored per-particle scale, before the layout-size factor —
	// computeLayout() multiplies this by the current sprite factor so
	// resizes re-derive from the pristine value instead of compounding.
	const baseScale = new Float32Array( n );
	for ( let i = 0; i < n; i++ ) {
		const sprite: Sprite = new pixi.Sprite( brushTexture );
		sprite.anchor.set( 0.5 );
		sprite.blendMode = 'add';
		sprite.tint =
			PARTICLE_PALETTE[ Math.floor( Math.random() * PARTICLE_PALETTE.length ) ];
		const scale =
			CONFIG.spriteScaleMin +
			Math.random() * ( CONFIG.spriteScaleMax - CONFIG.spriteScaleMin );
		baseScale[ i ] = scale;
		sprite.scale.set( scale );
		sprite.alpha =
			CONFIG.spriteAlphaMin +
			Math.random() * ( CONFIG.spriteAlphaMax - CONFIG.spriteAlphaMin );
		particleLayer.addChild( sprite );
		sprites[ i ] = sprite;
	}

	let logoScale = 1;
	let logoOffsetX = 0;
	let logoOffsetY = 0;

	const computeLayout = (): void => {
		const w = app.canvas.clientWidth;
		const h = app.canvas.clientHeight;
		const target = Math.min(
			CONFIG.targetLogoWidth,
			Math.min( w, h ) * CONFIG.logoShellFraction,
		);
		logoScale = target;
		logoOffsetX = ( w - target ) / 2;
		logoOffsetY = ( h - target ) / 2;

		// Shrink sprites in step with the logo below the reference
		// width (small containers — preview tiles); never above 1×.
		const spriteFactor = Math.min(
			1,
			target / CONFIG.spriteReferenceWidth,
		);

		for ( let i = 0; i < n; i++ ) {
			sprites[ i ].scale.set( baseScale[ i ] * spriteFactor );
			homeX[ i ] = logoOffsetX + homes[ i ][ 0 ] * logoScale;
			homeY[ i ] = logoOffsetY + homes[ i ][ 1 ] * logoScale;
			// First layout seeds current positions to home; subsequent
			// relayouts keep current positions where they are so the
			// animation doesn't snap on a browser resize.
			if ( x[ i ] === 0 && y[ i ] === 0 ) {
				x[ i ] = homeX[ i ];
				y[ i ] = homeY[ i ];
			}
		}
	};
	computeLayout();

	const resizeObserver = new ResizeObserver( () => computeLayout() );
	resizeObserver.observe( container );

	// Pointer tracking — container-local coordinates so the drag math
	// stays correct under any scroll/scale. Default to far-offscreen so
	// particles aren't affected on mount before the user has moved the
	// cursor. `pointerActive` distinguishes "genuinely idle" from "just
	// teleported in from offscreen" — the first pointermove after a
	// leave/initial-mount should NOT inject a giant delta.
	let pointerX = -1e6;
	let pointerY = -1e6;
	let pointerActive = false;

	// Cursor displacement accumulated between animation ticks. Each
	// tick consumes the delta (applies the drag force, then zeros) so
	// a stationary cursor doesn't keep dragging particles forever.
	// Multiple pointermoves within one frame accumulate — total
	// cursor travel for the frame becomes the drag impulse.
	let mouseDx = 0;
	let mouseDy = 0;

	const onPointerMove = ( e: PointerEvent ): void => {
		const rect = app.canvas.getBoundingClientRect();
		const nx = e.clientX - rect.left;
		const ny = e.clientY - rect.top;
		if ( pointerActive ) {
			// Clamp so a stale frame (e.g. cursor entered the window
			// from far offscreen between events) can't inject a wild
			// delta and launch the whole logo into orbit.
			const rawDx = nx - pointerX;
			const rawDy = ny - pointerY;
			const cap = CONFIG.maxMouseDelta;
			mouseDx += Math.max( -cap, Math.min( cap, rawDx ) );
			mouseDy += Math.max( -cap, Math.min( cap, rawDy ) );
		}
		pointerX = nx;
		pointerY = ny;
		pointerActive = true;
	};
	const onPointerLeave = (): void => {
		pointerX = -1e6;
		pointerY = -1e6;
		pointerActive = false;
		mouseDx = 0;
		mouseDy = 0;
	};
	// Listen on the container so pointer events bubble from windows too
	// (they float above the wallpaper layer, but `pointer-events: none`
	// on our layer means events pass through to the elements underneath
	// anyway — we grab from `window` to get the raw position). Falling
	// back to window covers the case where the wallpaper sits behind
	// other pointer-event owners.
	window.addEventListener( 'pointermove', onPointerMove, { passive: true } );
	window.addEventListener( 'pointerleave', onPointerLeave );

	// Reduced-motion: render one static frame and never start the
	// ticker. Homes are already populated, so a single paint gives a
	// clean still image of the logo.
	let animating = ! prefersReducedMotion;

	const syncSprites = (): void => {
		for ( let i = 0; i < n; i++ ) {
			sprites[ i ].x = x[ i ];
			sprites[ i ].y = y[ i ];
		}
	};

	const tick = (): void => {
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
				pointerActive ? mouseDx : 0,
				pointerActive ? mouseDy : 0,
			);
		}
		// Consume the cursor-delta: after one tick applies its force,
		// subsequent frames without new pointermove events see zero
		// delta and the drag effect stops, letting springs take over.
		mouseDx = 0;
		mouseDy = 0;
		syncSprites();
	};

	app.ticker.add( tick );
	// Even when not animating we need one paint to show the logo.
	syncSprites();
	if ( ! animating ) {
		// Force a render before stopping so the user sees the still
		// frame instead of an unpainted canvas.
		app.renderer.render( app.stage );
		app.ticker.stop();
	}

	return {
		destroy(): void {
			resizeObserver.disconnect();
			window.removeEventListener( 'pointermove', onPointerMove );
			window.removeEventListener( 'pointerleave', onPointerLeave );
			// Destroy the app first so the renderer stops referencing
			// the brush texture; THEN release the texture explicitly
			// so its backing canvas doesn't linger in GPU memory.
			// `{ removeView: true }`, NEVER `true`: a literal `true`
			// runs `releaseGlobalResources()`, wiping Pixi's
			// page-global pools out from under every other live
			// Application (active wallpaper vs. OS Settings preview).
			app.destroy( { removeView: true }, {
				children: true,
				texture: true,
				textureSource: true,
				context: true,
			} as object );
			try {
				brushTexture.destroy( true );
			} catch {
				/* already released by app.destroy when children:true is set */
			}
			// Put the container's inline background back however we
			// found it — next wallpaper's apply() takes over from
			// there via `--desktop-mode-bg`.
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
 * Integration step — spring toward home, damp, drag with the cursor,
 * integrate. Flat Float32Arrays keep the loop allocation-free.
 *
 * Cursor interaction is a "sand drag," not a force field: particles
 * within the brush radius inherit a fraction of the cursor's frame-
 * to-frame displacement (`mouseDx` / `mouseDy`). A stationary cursor
 * applies zero force — particles can rest under a parked cursor. A
 * moving cursor carries them along in its direction, with faster
 * cursor movement producing super-linearly stronger drag (lazy pans
 * barely stir the surface; whip-fast flicks genuinely fling sand).
 *
 * Once a particle's velocity drops below a small floor AND it's close
 * enough to its home to be visually at rest AND the cursor isn't
 * actively dragging it, we snap to home and zero velocity. This
 * keeps the resting logo pixel-identical frame-to-frame — no shimmer.
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
	mouseDx: number,
	mouseDy: number,
): void {
	const {
		springK,
		damping,
		dragRadius,
		dragStrength,
		dragBoost,
		dragBoostRefSpeed,
		restVelocityEpsilon,
	} = CONFIG;
	const dragRadiusSq = dragRadius * dragRadius;
	const restEpsSq = restVelocityEpsilon * restVelocityEpsilon;
	const restPosEps = 0.25; // sub-pixel — imperceptible snap.
	const restPosEpsSq = restPosEps * restPosEps;

	// Compute the cursor's speed magnitude once; every particle in
	// range applies the same boost factor. Super-linear: 1 + (speed /
	// ref) * boost — a lazy pan at 5 px/f sees a near-1.0× multiplier,
	// a whipping flick at 80 px/f sees ~2.6×.
	const mouseSpeed = Math.sqrt( mouseDx * mouseDx + mouseDy * mouseDy );
	const speedMultiplier = 1 + ( mouseSpeed / dragBoostRefSpeed ) * dragBoost;
	const dragFx = mouseDx * dragStrength * speedMultiplier;
	const dragFy = mouseDy * dragStrength * speedMultiplier;
	const cursorMoving = mouseDx !== 0 || mouseDy !== 0;

	for ( let i = 0; i < n; i++ ) {
		// Spring force toward home — always on, always pulling.
		const dhx = homeX[ i ] - x[ i ];
		const dhy = homeY[ i ] - y[ i ];
		let fx = dhx * springK;
		let fy = dhy * springK;

		// Sand-drag: cheap squared-distance gate, quadratic falloff
		// from the cursor's center. The drag force vector is the
		// cursor's velocity × strength × boost × falloff — same
		// direction as cursor motion, so particles are carried with
		// the cursor rather than pushed away.
		const dx = x[ i ] - pointerX;
		const dy = y[ i ] - pointerY;
		const distSq = dx * dx + dy * dy;
		let disturbed = false;
		if ( cursorMoving && distSq < dragRadiusSq ) {
			const t = 1 - Math.sqrt( distSq ) / dragRadius; // 0..1
			const falloff = t * t;
			fx += dragFx * falloff;
			fy += dragFy * falloff;
			disturbed = true;
		}

		// Velocity Verlet-ish integration with damping.
		const nvx = ( vx[ i ] + fx ) * damping;
		const nvy = ( vy[ i ] + fy ) * damping;

		// Snap-to-rest: only when the particle is both slow AND
		// essentially at home AND not being carried by the cursor.
		// Without all three conditions, a particle decelerating
		// through the rest threshold mid-flight would get stuck
		// off-home — the snap would "freeze" it en route.
		if (
			! disturbed &&
			nvx * nvx + nvy * nvy < restEpsSq &&
			dhx * dhx + dhy * dhy < restPosEpsSq
		) {
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
 * Build the particle "brush" — a single soft radial-gradient texture
 * drawn once into an offscreen canvas and wrapped as a Pixi Texture.
 * Every particle sprite shares this texture (Pixi batches them in a
 * single draw call), with per-sprite tint and alpha providing the
 * visual variety.
 *
 * The gradient is front-loaded toward transparent so the alpha falls
 * off aggressively past the core — prevents the entire sprite area
 * from registering as a washed-out square under additive blending.
 */
function buildBrushTexture( pixi: typeof import( 'pixi.js' ) ): Texture {
	const size = CONFIG.brushSize;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		throw new Error( '[animated-logo-wallpaper] 2D canvas context unavailable.' );
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
	// A tight bright core blended into a long soft halo. The extra
	// mid-stops shape the falloff so the halo reads as a smoke-soft
	// glow instead of a linear ramp.
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
 * Load the logo PNG, rasterize it to an offscreen canvas, and sample
 * the alpha channel on a fixed grid. Returns unit-coordinate pairs
 * (each in [0, 1]) that can be scaled to fit any render surface.
 *
 * The grid walk samples at CONFIG.sampleStride — slightly offset per
 * row by half a stride so particles don't line up on a perfectly
 * rectangular lattice (visible as visual banding).
 */
async function sampleLogoHomes( url: string ): Promise<Array<[ number, number ]>> {
	const img = await loadImage( url );

	const maxSide = 400;
	const ratio = img.naturalWidth / img.naturalHeight;
	const sampleWidth = ratio >= 1 ? maxSide : Math.round( maxSide * ratio );
	const sampleHeight = ratio >= 1 ? Math.round( maxSide / ratio ) : maxSide;

	const off = document.createElement( 'canvas' );
	off.width = sampleWidth;
	off.height = sampleHeight;
	const ctx = off.getContext( '2d', { willReadFrequently: true } );
	if ( ! ctx ) {
		return [];
	}
	ctx.drawImage( img, 0, 0, sampleWidth, sampleHeight );

	const data = ctx.getImageData( 0, 0, sampleWidth, sampleHeight ).data;
	const homes: Array<[ number, number ]> = [];
	const stride = CONFIG.sampleStride;
	const threshold = CONFIG.alphaThreshold;

	for ( let row = 0; row < sampleHeight; row += stride ) {
		const rowOffset = ( row / stride ) % 2 === 0 ? 0 : stride / 2;
		for ( let col = 0; col < sampleWidth; col += stride ) {
			const px = Math.min( sampleWidth - 1, Math.round( col + rowOffset ) );
			const py = row;
			const alpha = data[ ( py * sampleWidth + px ) * 4 + 3 ];
			if ( alpha > threshold ) {
				// Unit coordinates relative to the max dimension so
				// non-square logos stay aspect-correct when scaled.
				homes.push( [ px / sampleWidth, py / sampleHeight ] );
			}
		}
	}

	return homes;
}

function loadImage( url: string ): Promise<HTMLImageElement> {
	return new Promise( ( resolve, reject ) => {
		const img = new Image();
		// crossOrigin not strictly needed (same-origin) but future-proofs
		// the loader if the URL ever comes from a CDN.
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

