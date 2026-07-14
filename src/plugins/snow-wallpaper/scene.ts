/**
 * Snow wallpaper — the PixiJS simulation.
 *
 * Simulation contract:
 *   1. A fixed-size sprite pool is built up front (sized to the
 *      settings ceiling so the particle-count knob never forces a
 *      pool rebuild). No per-frame allocations.
 *   2. Each tick, free sprites are spawned off the top of the canvas
 *      with randomized velocity, size, alpha, sway — while the live
 *      count is under the user's `particleCount`.
 *   3. Wind is a slow global sin sweep; per-particle sway layers a
 *      small per-particle sin on top so the field never feels
 *      uniform.
 *   4. Every frame, each falling flake checks the last-frame Y
 *      against the top edge of every visible surface the shell
 *      publishes (windows, widget cards, taskbar, the shell floor).
 *      A crossing sticks the flake at the top of the existing pile in
 *      that column (see the pile model below), with an anchor offset
 *      so the whole pile drags along when the user moves the window.
 *   5. A stuck flake lives for `stuckLifeSec ± jitter` then starts
 *      the melt phase — shrink + fade over `meltDurationSec`, then
 *      returned to the free list and the pile column it occupied is
 *      decremented.
 *
 * Pile model (snow-on-snow stacking):
 *   - Each `top`-face surface gets a per-bucket pile-height array
 *     keyed by surface id. Buckets are `pileBucketPx` wide in
 *     surface-local space; bucket index = floor((vpX - r.x)/bucketPx).
 *   - On collision, the flake's stick Y is offset upward by
 *     `pile[bucket]` so successive flakes in the same column stack.
 *     The bucket's height is then incremented by
 *     `flakeSize * pileContribution`, and immediate neighbors get a
 *     fraction so piles slope naturally instead of forming towers.
 *   - On melt/release/detach, the bucket is decremented by the same
 *     amount this flake added (the bucket id is stored on the
 *     particle so it can be found again).
 *   - Pile arrays are pruned when their surface disappears from the
 *     shell's surface list (window close, widget unmount, minimize).
 *     Stale-pile reads after a prune are safe no-ops.
 *   - Anchored flakes follow their surface element, so dragging a
 *     window moves both flakes AND pile heights (heights are
 *     surface-local; the element's live rect bridges into viewport
 *     space).
 *
 * Deallocation:
 *   - Melted sprites reset alpha/scale and are pushed back on the
 *     free list; particle objects are reused for the life of the
 *     wallpaper.
 *   - Teardown destroys the Pixi Application (WebGL context, texture,
 *     every particle) and restores the container's prior
 *     `background` style. Hook wiring lives in `index.ts`, not here.
 *
 * The OS Settings tile preview reuses this scene with
 * `getSurfaces: null` (no collisions, no piles — surface rects are
 * viewport-space and meaningless inside a tile) and a scaled-down
 * particle count.
 *
 * @since 0.9.5
 */

import type { WallpaperSurface } from '../../wallpapers/surfaces';
import type {
	PixiApp,
	PixiNamespace,
	PixiParticle,
	PixiTicker,
} from './pixi-types';
import { backdropCss, SNOW_LIMITS, type SnowSettings } from './settings';

/**
 * Texture canvas size — the snowflake is rasterized into a square of
 * this many CSS pixels. Particle scale is set so the rendered flake
 * is `pSize[idx]` CSS pixels wide (`scale = size / TEXTURE_SIZE`),
 * keeping the size setting in intuitive on-screen units. 64 px is
 * plenty for a smooth radial gradient — there is no fine structure
 * to preserve because real snow seen by eye reads as a soft sphere,
 * not a Christmas-card crystal.
 */
const TEXTURE_SIZE = 64;

/**
 * Fixed physics / simulation tuning. All values are CSS pixels or
 * seconds unless noted. Adjust together — changing one usually means
 * revisiting the others. The four user-tunable values (wind
 * amplitude, particle count, flake size, backdrop) live in
 * {@link SnowSettings} instead.
 */
const TUNING = {
	/**
	 * Spawn rate (flakes/s) while the field is unsaturated, at the
	 * default particle count. Scaled linearly with the user's
	 * particle count so the pool fills in the same wall-clock time at
	 * every density. The pool cap is the real ceiling — once hit,
	 * spawn pauses until something melts or recycles.
	 */
	spawnPerSecondAtDefault: 90,
	/** The particle count `spawnPerSecondAtDefault` is calibrated for. */
	spawnCalibrationCount: 660,
	/**
	 * Min / max vertical drift (px/s). Real snow falls slowly and
	 * reaches terminal velocity fast — air resistance dominates over
	 * gravity at flake mass — so velocity is modeled as a constant
	 * per particle rather than accelerating. Range chosen for an
	 * atmospheric feel rather than a hailstorm.
	 */
	gravityMin: 28,
	gravityMax: 72,
	/** Period of the global wind sweep (seconds). */
	windPeriodSec: 11,
	/** Per-particle sway amplitude (px/s target). */
	driftAmplitude: 32,
	driftPeriodMin: 2.5,
	driftPeriodMax: 5.5,
	/**
	 * Max rotation speed (rad/s). Spheres are rotation-invariant by
	 * construction — kept tiny only so any minor bilinear-filter
	 * asymmetries don't lock to a fixed orientation across the field.
	 */
	rotationMax: 0.2,
	alphaMin: 0.7,
	alphaMax: 1.0,
	/** Melt duration once a stuck flake starts melting. */
	meltDurationSec: 1.8,
	/**
	 * How long a flake stays stuck before it starts melting. Visible
	 * piles take time to build — a short lifetime barely lets a
	 * column reach 2–3 flakes before the bottom one melts. A small
	 * jitter is applied per flake so an entire windowful doesn't melt
	 * in lockstep.
	 */
	stuckLifeSec: 9.0,
	stuckLifeJitter: 2.5,
	/**
	 * A small inset on the window top so flakes don't visibly overlap
	 * the title-bar drop shadow.
	 */
	collisionMarginY: 2,
	/**
	 * Width of one pile-height bucket in CSS px (surface-local X).
	 * Each surface keeps a Float32Array of bucket heights; a falling
	 * flake's bucket index is `floor((vpX - r.x) / bucket)`. 8 px is
	 * roughly half a flake wide — narrow enough that two flakes
	 * landing in the same column visibly stack rather than overlap,
	 * wide enough that buckets feel continuous rather than discrete
	 * bins.
	 */
	pileBucketPx: 8,
	/**
	 * Cap on per-column pile height in CSS px. Beyond this, further
	 * flakes still stick but don't push the pile higher — surfaces
	 * visually "saturate" with snow rather than growing unbounded
	 * towers. ~3 flakes deep at the largest default flake size reads
	 * as a small drift edge.
	 */
	pileMaxPx: 48,
	/**
	 * Fraction of a flake's size added to its bucket's pile height on
	 * landing. Successive flakes' centres sit only
	 * `pileContribution * size` apart, so 0.1 puts new flake centres
	 * just 10% of a diameter above the previous one. The bright cores
	 * (~30% of the size) heavily overlap, reading as a continuous
	 * mass of snow rather than a stack of discrete dots with visible
	 * interstitial halo. Lower = denser pile, slower vertical growth.
	 */
	pileContribution: 0.1,
	/**
	 * Fraction of `pileContribution` that bleeds into the two
	 * neighbor buckets — gives piles a natural slope instead of
	 * letting one column tower over its neighbors.
	 */
	pileSpread: 0.4,
} as const;

/**
 * Pool capacity — the settings ceiling, allocated up front so the
 * particle-count setting can move live without rebuilding typed
 * arrays or the particle list. Inactive slots cost a few bytes each
 * and are hidden via alpha.
 */
const POOL_SIZE = SNOW_LIMITS.particleCount.max;

/** What the scene hands back to the wallpaper entry. */
export interface SnowScene {
	/** Pause / resume the ticker (visibility, reduced motion). */
	setAnimating( animating: boolean ): void;
	/** Live-apply new user settings — no remount needed. */
	applySettings( settings: SnowSettings ): void;
	/** Flag the surface cache stale (window moved / state changed). */
	markSurfacesDirty(): void;
	/**
	 * Drop every flake stuck to the given element back into the
	 * falling state — the surface under them is disappearing, so
	 * gravity takes over rather than melting in place.
	 */
	detachFlakesAnchoredTo( element: HTMLElement ): void;
	/** Full teardown — WebGL context, texture, listeners, backdrop. */
	destroy(): void;
}

export interface SnowSceneOptions {
	container: HTMLElement;
	pixi: PixiNamespace;
	settings: SnowSettings;
	prefersReducedMotion: boolean;
	/**
	 * Live surface supplier (`wp.desktop.getWallpaperSurfaces`), or
	 * `null` to disable collisions entirely (tile previews — surface
	 * rects are viewport-space and meaningless inside a tile).
	 */
	getSurfaces: ( () => WallpaperSurface[] ) | null;
}

/**
 * Rasterize a soft white sphere on a `TEXTURE_SIZE` × `TEXTURE_SIZE`
 * canvas and hand it to Pixi as a shared texture. One texture is used
 * by every particle — the hot loop only varies scale, alpha,
 * rotation, position.
 *
 * This is intentionally NOT the stylized six-armed crystal of a
 * Christmas-card snowflake. Real falling snow seen by eye reads as a
 * soft, slightly-blue-white blob — the dendrite structure is far too
 * small to resolve at any realistic viewing distance, and rendering
 * it on a handful of pixels would alias to noise anyway.
 *
 * Single radial gradient: bright white core, fading to a faint
 * cool-blue edge, fully transparent at the texture rim so adjacent
 * sprites don't overlap with a hard rectangular border.
 */
function buildSnowflakeTexture( pixi: PixiNamespace ) {
	const size = TEXTURE_SIZE;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	if ( ! ctx ) {
		return pixi.Texture.from( canvas );
	}
	const cx = size / 2;
	const cy = size / 2;
	// Use slightly less than half the canvas so the outermost alpha=0
	// stop falls inside the texture — eliminates any 1-px-wide rim
	// from edge-clipping when the sprite is sampled at non-integer
	// positions.
	const radius = size / 2 - 1;

	const grad = ctx.createRadialGradient( cx, cy, 0, cx, cy, radius );
	// Solid white core — the bright "mass" of the flake, ~30% of the
	// radius. Beyond that the alpha rolls off so the glow occupies
	// the outer 70% as a soft halo. The whole envelope reads as a
	// single sphere; the inner ~30% is the dense centre, the rest is
	// the softness that gives the flake its "real" rather than
	// "pixelated" quality.
	grad.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	grad.addColorStop( 0.3, 'rgba(250, 252, 255, 0.9)' );
	// Mid rolloff — visible but clearly fading. Without this midpoint
	// the alpha drops too sharply and the flake reads as a
	// hard-edged dot.
	grad.addColorStop( 0.6, 'rgba(235, 245, 255, 0.32)' );
	// Faint halo trailing off into the rim.
	grad.addColorStop( 0.88, 'rgba(220, 232, 255, 0.07)' );
	grad.addColorStop( 1, 'rgba(210, 228, 255, 0)' );
	ctx.fillStyle = grad;
	ctx.fillRect( 0, 0, size, size );

	return pixi.Texture.from( canvas );
}

function rand( a: number, b: number ): number {
	return a + Math.random() * ( b - a );
}

/**
 * Create the Pixi application, build the particle pool, and start the
 * simulation. Resolves to the scene handle; rejects if Pixi fails to
 * initialize (no WebGL, context limit) — the caller restores the
 * backdrop and reports through the shell's mount-failure path.
 */
export async function mountSnowScene(
	opts: SnowSceneOptions,
): Promise< SnowScene > {
	const { container, pixi, getSurfaces } = opts;

	// Backdrop: pure CSS; the transparent Pixi canvas overlays it and
	// gives the field its sense of depth.
	const priorBackground = container.style.background;
	container.style.background = backdropCss( opts.settings.background );

	// Live-tunable copy of the user settings — applySettings() swaps
	// the values and the hot loop reads them per frame.
	const tunables: SnowSettings = { ...opts.settings };

	const app: PixiApp = new pixi.Application();
	try {
		await app.init( {
			resizeTo: container,
			backgroundAlpha: 0,
			antialias: true,
			autoDensity: true,
			resolution: Math.min( window.devicePixelRatio || 1, 2 ),
		} );
	} catch ( err ) {
		container.style.background = priorBackground;
		throw err;
	}

	container.appendChild( app.canvas );
	app.canvas.style.position = 'absolute';
	app.canvas.style.inset = '0';
	app.canvas.style.width = '100%';
	app.canvas.style.height = '100%';
	app.canvas.style.pointerEvents = 'none';

	const texture = buildSnowflakeTexture( pixi );

	// Pixi v8's ParticleContainer is the fast path for many sprites
	// sharing a single texture: it bypasses the full display-list
	// tree and batches per-particle attributes into tight vertex
	// buffers. `dynamicProperties` declares which fields we mutate
	// each frame — NOTE `vertex: true` is what makes scaleX/scaleY
	// upload per-frame (there is no `scale` key; see pixi-types.ts).
	const stage = new pixi.ParticleContainer( {
		dynamicProperties: {
			position: true,
			vertex: true,
			rotation: true,
			color: true,
		},
	} );
	app.stage.addChild( stage );

	const MAX = POOL_SIZE;

	// Flat typed arrays — the tick loop does zero heap allocations
	// per particle per frame.
	const pX = new Float32Array( MAX );
	const pY = new Float32Array( MAX );
	const pVX = new Float32Array( MAX );
	const pVY = new Float32Array( MAX );
	const pSize = new Float32Array( MAX );
	const pRot = new Float32Array( MAX );
	const pRotVel = new Float32Array( MAX );
	const pDriftPhase = new Float32Array( MAX );
	const pDriftFreq = new Float32Array( MAX );
	const pDriftAmp = new Float32Array( MAX );
	const pBaseAlpha = new Float32Array( MAX );
	/** 0 free · 1 falling · 2 stuck · 3 melting */
	const pState = new Uint8Array( MAX );
	/** Surface element this flake is stuck to (null = synthetic). */
	const pAnchor: Array< HTMLElement | null > = new Array( MAX );
	const pAnchorDX = new Float32Array( MAX );
	const pAnchorDY = new Float32Array( MAX );
	const pStuckLife = new Float32Array( MAX );
	const pMelt = new Float32Array( MAX );
	/**
	 * Surface id (e.g. `window:foo`, `shell:floor`) this flake is
	 * stuck to. Used at release/detach time to find the pile bucket
	 * array and decrement the height this flake added. `null` when
	 * the flake isn't stuck.
	 */
	const pSurfaceId: Array< string | null > = new Array( MAX );
	/**
	 * Index into the per-surface pile array — the column this flake
	 * landed in. `-1` when not stuck. Stored separately from
	 * `pAnchorDX` because the bucket is a discrete integer while DX
	 * is a sub-pixel float used for positioning.
	 */
	const pBucket = new Int32Array( MAX );
	/**
	 * Pile height this flake contributed when it landed (in CSS px).
	 * Recomputable from `pSize * pileContribution`, but storing the
	 * exact value handles tuning changes mid-session without
	 * orphaning pile height.
	 */
	const pPileAdd = new Float32Array( MAX );
	/**
	 * How much of `pPileAdd` is still in the pile right now. As the
	 * flake melts, this gets gradually decremented (and the pile
	 * height with it). On release, any residual is returned in one
	 * shot. Tracked separately so a partially-melted flake can be
	 * detached early (window close mid-melt) and still return the
	 * correct amount to the pile without double-counting against the
	 * gradual decrement that was already happening.
	 */
	const pPileRemaining = new Float32Array( MAX );

	const particles: Array< PixiParticle | null > = new Array( MAX );
	const freeList: number[] = new Array( MAX );
	for ( let i = 0; i < MAX; i++ ) {
		const particle = new pixi.Particle( {
			texture,
			anchorX: 0.5,
			anchorY: 0.5,
			// Free particles are hidden via alpha rather than removed
			// from the container — the mutation is already on the
			// GPU's dynamic-color path, so this is cheaper than
			// churning the particle list.
			alpha: 0,
			tint: 0xffffff,
		} );
		stage.addParticle( particle );
		particles[ i ] = particle;
		pState[ i ] = 0;
		pAnchor[ i ] = null;
		pSurfaceId[ i ] = null;
		pBucket[ i ] = -1;
		pPileAdd[ i ] = 0;
		pPileRemaining[ i ] = 0;
		// Populate the free-list in reverse so we spawn from index 0
		// onward — a minor quality-of-life for debugging.
		freeList[ i ] = MAX - 1 - i;
	}
	let freeCount: number = MAX;

	/**
	 * Per-surface snow-pile height profile, keyed by `surface.id`.
	 * Each value is a `Float32Array` indexed by bucket — bucket width
	 * is `TUNING.pileBucketPx` and indices run from the surface's
	 * left edge in surface-local coordinates. Stored in the closure
	 * rather than on the surface object so piles survive surface
	 * refreshes; pruned when their surface disappears from the
	 * shell's surface list.
	 *
	 * Indexed reads/writes are bounds-checked at the call site — a
	 * stale `pBucket` for a now-pruned surface harmlessly hits the
	 * `pileHeights.get(...) === undefined` path and skips the
	 * decrement.
	 */
	const pileHeights = new Map< string, Float32Array >();

	// Cached list of solid surfaces with a `top` face — the shell
	// owns the authoritative list (windows, taskbar, widget cards,
	// shell floor, plus anything plugin filters push in via
	// `desktop-mode.wallpaper.surfaces`) and hands it back via
	// `getSurfaces`. Refreshed on a 20Hz cadence, and eagerly
	// whenever the entry flips the dirty bit on a window-geometry
	// hook so stuck-flake positions track fast-moving windows
	// without a one-tick lag.
	const surfaces: WallpaperSurface[] = [];
	let surfacesDirty = true;
	let canvasRect = app.canvas.getBoundingClientRect();

	function refreshCanvasRect(): void {
		canvasRect = app.canvas.getBoundingClientRect();
	}

	function refreshSurfacesIfDirty(): void {
		if ( ! surfacesDirty ) {
			return;
		}
		surfaces.length = 0;
		if ( ! getSurfaces ) {
			surfacesDirty = false;
			return;
		}
		const all = getSurfaces();
		let liveIds: Set< string > | null = null; // only build the set if there are piles to prune
		for ( let k = 0; k < all.length; k++ ) {
			const s = all[ k ];
			// Accumulation is only defined for horizontal tops.
			// Vertical surfaces (dock edge) are in the list but snow
			// doesn't pile on them — skip.
			if ( s.face !== 'top' ) {
				continue;
			}
			if ( s.rect.width <= 0 || s.rect.height <= 0 ) {
				continue;
			}
			surfaces.push( s );
			if ( pileHeights.size > 0 ) {
				if ( liveIds === null ) {
					liveIds = new Set();
				}
				liveIds.add( s.id );
			}
		}
		// Prune pile entries whose surface is no longer in the
		// shell's list (window closed, widget removed, virtual-
		// desktop switch). Stuck flakes pointing at the pruned
		// surface have already been detached or are about to be (the
		// per-particle stuck branch detects `isConnected` false /
		// `offsetParent` null on the next tick); after detach their
		// `pSurfaceId` is reset to null so a later release won't try
		// to decrement the gone pile.
		if ( pileHeights.size > 0 ) {
			pileHeights.forEach( ( _arr, id ) => {
				if ( ! liveIds || ! liveIds.has( id ) ) {
					pileHeights.delete( id );
				}
			} );
		}
		surfacesDirty = false;
	}

	/**
	 * Fetch (and lazily allocate / resize) the pile-height array for
	 * a surface. Bucket count tracks the surface's current width — if
	 * the surface resizes between calls we reallocate and copy what
	 * fits, which preserves accumulated snow on the left side of a
	 * window during a right-edge resize and only sacrifices the
	 * columns that fell off.
	 */
	function getPileForSurface( surface: WallpaperSurface ): Float32Array {
		const bucketCount = Math.max(
			1,
			Math.ceil( surface.rect.width / TUNING.pileBucketPx ),
		);
		const existing = pileHeights.get( surface.id );
		if ( existing && existing.length === bucketCount ) {
			return existing;
		}
		const fresh = new Float32Array( bucketCount );
		if ( existing ) {
			// Preserve overlapping range so a horizontal resize keeps
			// the snow that's still under the window's footprint
			// rather than blanking the pile.
			const copyLen = Math.min( existing.length, bucketCount );
			for ( let i = 0; i < copyLen; i++ ) {
				fresh[ i ] = existing[ i ];
			}
		}
		pileHeights.set( surface.id, fresh );
		return fresh;
	}

	function spawn(): void {
		if ( freeCount === 0 ) {
			return;
		}
		const idx = freeList[ --freeCount ];
		const w = app.canvas.clientWidth;
		const sizeMax = tunables.flakeSize;
		const sizeMin = sizeMax / 2;
		pX[ idx ] = Math.random() * w;
		// Spawn well above the canvas top so the flake drifts down
		// for ~1–3 s before becoming visible — by the time it crosses
		// the viewport edge it already has a horizontal wind/sway
		// component and varied alpha, which reads as "entering from
		// above" rather than "popping into existence at the top
		// edge". The wide range (50–180 px) also staggers the entry
		// timing so the field never has a visible horizontal "front"
		// of fresh flakes.
		pY[ idx ] = -rand( 50, 180 );
		pVX[ idx ] = rand( -8, 8 );
		pVY[ idx ] = rand( TUNING.gravityMin, TUNING.gravityMax );
		pSize[ idx ] = rand( sizeMin, sizeMax );
		pRot[ idx ] = Math.random() * Math.PI * 2;
		pRotVel[ idx ] = rand( -TUNING.rotationMax, TUNING.rotationMax );
		pDriftPhase[ idx ] = Math.random() * Math.PI * 2;
		pDriftFreq[ idx ] =
			( 2 * Math.PI ) /
			rand( TUNING.driftPeriodMin, TUNING.driftPeriodMax );
		pDriftAmp[ idx ] = rand( 6, TUNING.driftAmplitude );
		pBaseAlpha[ idx ] = rand( TUNING.alphaMin, TUNING.alphaMax );
		pMelt[ idx ] = 0;
		pStuckLife[ idx ] = 0;
		pAnchor[ idx ] = null;
		pSurfaceId[ idx ] = null;
		pBucket[ idx ] = -1;
		pPileAdd[ idx ] = 0;
		pState[ idx ] = 1;
		pPileRemaining[ idx ] = 0;

		const particle = particles[ idx ];
		if ( ! particle ) {
			return;
		}
		const scale = pSize[ idx ] / TEXTURE_SIZE;
		particle.scaleX = scale;
		particle.scaleY = scale;
		particle.alpha = pBaseAlpha[ idx ];
		particle.rotation = pRot[ idx ];
		particle.x = pX[ idx ];
		particle.y = pY[ idx ];
	}

	/**
	 * Subtract this flake's REMAINING pile contribution from the pile
	 * column it occupies — used by release() and detachToFalling().
	 * `pPileRemaining` tracks how much of the landing-time `pPileAdd`
	 * is still in the pile; melt-phase ticks gradually return
	 * contribution to the pile, so by the time release fires this is
	 * usually zero. Detaches that happen mid-melt (window close)
	 * still return any residual.
	 */
	function decrementPileFor( idx: number ): void {
		const sid = pSurfaceId[ idx ];
		if ( sid === null ) {
			return;
		}
		const pile = pileHeights.get( sid );
		if ( ! pile ) {
			return;
		}
		const b = pBucket[ idx ];
		if ( b < 0 || b >= pile.length ) {
			return;
		}
		const add = pPileRemaining[ idx ];
		if ( add <= 0 ) {
			return;
		}
		const spread = add * TUNING.pileSpread;
		pile[ b ] = Math.max( 0, pile[ b ] - add );
		if ( b > 0 ) {
			pile[ b - 1 ] = Math.max( 0, pile[ b - 1 ] - spread );
		}
		if ( b + 1 < pile.length ) {
			pile[ b + 1 ] = Math.max( 0, pile[ b + 1 ] - spread );
		}
		pPileRemaining[ idx ] = 0;
	}

	function release( idx: number ): void {
		// Returns any residual pile contribution; a naturally-melted
		// flake's `pPileRemaining` is already zero by this point.
		decrementPileFor( idx );
		pState[ idx ] = 0;
		pAnchor[ idx ] = null;
		pSurfaceId[ idx ] = null;
		pBucket[ idx ] = -1;
		pPileAdd[ idx ] = 0;
		pPileRemaining[ idx ] = 0;
		// Hide via alpha — the particle stays in the container and is
		// reused when the free-list hands this index back out from
		// spawn().
		const particle = particles[ idx ];
		if ( particle ) {
			particle.alpha = 0;
		}
		freeList[ freeCount++ ] = idx;
	}

	/**
	 * Anchor a freshly-collided flake to a surface, with its vertical
	 * offset set so it sits on top of the existing pile in its bucket
	 * (DY is negative because the surface rect's top is the reference
	 * — pile grows upward in screen space).
	 */
	function stick(
		idx: number,
		anchorEl: HTMLElement | null,
		dx: number,
		pileHeight: number,
		surfaceId: string,
		bucket: number,
		pileAdd: number,
	): void {
		pState[ idx ] = 2;
		pAnchor[ idx ] = anchorEl;
		pAnchorDX[ idx ] = dx;
		// Anchor is the surface's top edge; subtract the pile so the
		// flake renders on top of the existing column.
		// `collisionMarginY` keeps the bottom of the pile a hair
		// below the surface edge so the title-bar shadow doesn't poke
		// through.
		pAnchorDY[ idx ] = TUNING.collisionMarginY - pileHeight;
		pSurfaceId[ idx ] = surfaceId;
		pBucket[ idx ] = bucket;
		pPileAdd[ idx ] = pileAdd;
		pPileRemaining[ idx ] = pileAdd;
		pVX[ idx ] = 0;
		pVY[ idx ] = 0;
		pRotVel[ idx ] = 0;
		pStuckLife[ idx ] = rand(
			TUNING.stuckLifeSec - TUNING.stuckLifeJitter,
			TUNING.stuckLifeSec + TUNING.stuckLifeJitter,
		);
	}

	function startMelt( idx: number ): void {
		pState[ idx ] = 3;
		pMelt[ idx ] = 0;
	}

	/**
	 * Drop a stuck flake back into the falling state — used when the
	 * surface under it disappears (window closes) rather than melts.
	 * Physically: the "ground" has been yanked away, so gravity takes
	 * over and the flake resumes its descent from wherever it was
	 * resting.
	 *
	 * Velocity is the full freshly-spawned gravity range — a reduced
	 * "gentle restart" velocity reads as flakes floating in place at
	 * these sizes. Real snow detached from a surface reaches the same
	 * terminal velocity as snow falling from the sky, so the model
	 * uses the spawn-time range.
	 */
	function detachToFalling( idx: number ): void {
		decrementPileFor( idx );
		pState[ idx ] = 1;
		pAnchor[ idx ] = null;
		pSurfaceId[ idx ] = null;
		pBucket[ idx ] = -1;
		pPileAdd[ idx ] = 0;
		pPileRemaining[ idx ] = 0;
		pVX[ idx ] = rand( -6, 6 );
		pVY[ idx ] = rand( TUNING.gravityMin, TUNING.gravityMax );
		pRotVel[ idx ] = rand( -TUNING.rotationMax, TUNING.rotationMax );
	}

	/**
	 * Collision test — falling flake vs every `top` surface the shell
	 * publishes, AND the running pile of snow that has already
	 * settled on each surface's columns. Crossing is detected by
	 * comparing last-frame Y to this-frame Y against the
	 * pile-adjusted edge line, so fast-moving flakes can't "tunnel"
	 * through in a single tick.
	 *
	 * Coordinates: pX / pY live in the Pixi canvas's local space
	 * (0,0 = top-left of the wallpaper layer). Surface rects come in
	 * viewport coordinates (see `WallpaperSurface`), so we bridge
	 * through canvasRect.
	 *
	 * The shell's surface list already covers the floor (as
	 * `shell:floor`), taskbar top, widget-card tops, and every
	 * non-minimized window top — no separate floor path needed.
	 */
	function collideWithSurfaces( idx: number, prevY: number ): boolean {
		const vpX = pX[ idx ] + canvasRect.left;
		const vpY = pY[ idx ] + canvasRect.top;
		const prevVpY = prevY + canvasRect.top;
		for ( let k = 0; k < surfaces.length; k++ ) {
			const s = surfaces[ k ];
			const r = s.rect;
			if ( vpX < r.x || vpX > r.x + r.width ) {
				continue;
			}

			// Resolve which pile bucket this flake's X column falls
			// into (surface-local). Clamp to valid range — a
			// sub-pixel rounding error at the surface's right edge
			// can push the index one past the end.
			const pile = getPileForSurface( s );
			let bucket = Math.floor( ( vpX - r.x ) / TUNING.pileBucketPx );
			if ( bucket < 0 ) {
				bucket = 0;
			} else if ( bucket >= pile.length ) {
				bucket = pile.length - 1;
			}
			const pileHeight = pile[ bucket ];
			const top = r.y + TUNING.collisionMarginY - pileHeight;

			if ( prevVpY <= top && vpY >= top ) {
				// Compute this flake's contribution before we stick —
				// once stuck the size is fixed so we can record the
				// exact amount for an accurate decrement at release
				// time.
				const add = pSize[ idx ] * TUNING.pileContribution;
				const spread = add * TUNING.pileSpread;

				// Stick first, then grow the pile. The `pileHeight`
				// just read is what THIS flake sits on top of —
				// successive flakes in this bucket will see a taller
				// pile and land higher up.
				stick( idx, s.element, vpX - r.x, pileHeight, s.id, bucket, add );

				// Pile growth caps at `pileMaxPx` per bucket — beyond
				// that the surface is "saturated" and further flakes
				// still stick but don't push the column higher
				// (visually they pile up invisibly inside the cap).
				pile[ bucket ] = Math.min( TUNING.pileMaxPx, pile[ bucket ] + add );
				if ( bucket > 0 ) {
					pile[ bucket - 1 ] = Math.min(
						TUNING.pileMaxPx,
						pile[ bucket - 1 ] + spread,
					);
				}
				if ( bucket + 1 < pile.length ) {
					pile[ bucket + 1 ] = Math.min(
						TUNING.pileMaxPx,
						pile[ bucket + 1 ] + spread,
					);
				}
				return true;
			}
		}
		return false;
	}

	let elapsed = 0;
	let lastRectRefresh = -1;
	let spawnAccum = 0;
	let animating = ! opts.prefersReducedMotion;

	/** Spawn rate scaled so every density fills in the same time. */
	function spawnPerSecond(): number {
		return (
			( TUNING.spawnPerSecondAtDefault * tunables.particleCount ) /
			TUNING.spawnCalibrationCount
		);
	}

	if ( ! animating ) {
		// A static frame: spawn a partial field once, pause.
		const staticCount = tunables.particleCount * 0.35;
		for ( let s = 0; s < staticCount; s++ ) {
			spawn();
		}
	}

	function tick( ticker: PixiTicker ): void {
		let dt = ticker.deltaMS / 1000;
		if ( dt > 0.1 ) {
			dt = 0.1; // clamp tab-restore hiccups
		}
		elapsed += dt;

		// Cheap refresh cadence — the surface cache is only stale by
		// one frame during a drag, imperceptible to the eye. The
		// window-geometry hooks additionally flip the dirty bit
		// mid-interval during active drags, so stuck flakes track
		// fast-moving windows smoothly.
		if ( elapsed - lastRectRefresh > 0.05 ) {
			surfacesDirty = true;
			lastRectRefresh = elapsed;
		}
		refreshCanvasRect();
		refreshSurfacesIfDirty();

		const wind =
			Math.sin( ( elapsed / TUNING.windPeriodSec ) * Math.PI * 2 ) *
			tunables.wind;

		if ( animating ) {
			spawnAccum += dt * spawnPerSecond();
			while ( spawnAccum >= 1 ) {
				// The user's particle count is the live ceiling — the
				// pool itself is allocated at the settings maximum so
				// the knob can move without a rebuild.
				if ( MAX - freeCount >= tunables.particleCount ) {
					spawnAccum = 0;
					break;
				}
				spawn();
				spawnAccum -= 1;
			}
		}

		const w = app.canvas.clientWidth;
		const h = app.canvas.clientHeight;

		for ( let idx = 0; idx < MAX; idx++ ) {
			const st = pState[ idx ];
			if ( st === 0 ) {
				continue;
			}
			const particle = particles[ idx ];
			if ( ! particle ) {
				continue;
			}

			if ( st === 1 ) {
				const prevY = pY[ idx ];

				const sway =
					Math.sin( elapsed * pDriftFreq[ idx ] + pDriftPhase[ idx ] ) *
					pDriftAmp[ idx ];
				// Ease vx toward (wind + sway) so gusts feel inertial
				// rather than snapping.
				pVX[ idx ] +=
					( wind + sway - pVX[ idx ] ) * Math.min( 1, dt * 1.5 );

				pX[ idx ] += pVX[ idx ] * dt;
				pY[ idx ] += pVY[ idx ] * dt;
				pRot[ idx ] += pRotVel[ idx ] * dt;

				// Horizontal wrap — keeps the field dense without
				// spawning sideways edge cases.
				if ( pX[ idx ] < -16 ) {
					pX[ idx ] += w + 32;
				} else if ( pX[ idx ] > w + 16 ) {
					pX[ idx ] -= w + 32;
				}

				if ( collideWithSurfaces( idx, prevY ) ) {
					// Position already handled by stick().
				} else if ( pY[ idx ] > h + 24 ) {
					// Fell past every surface — the shell floor should
					// have caught the flake, but if no surfaces exist
					// (tile preview, or no shell) recycle anyway.
					release( idx );
					continue;
				}

				if ( pState[ idx ] === 1 ) {
					particle.x = pX[ idx ];
					particle.y = pY[ idx ];
					particle.rotation = pRot[ idx ];
				}
			}

			if ( pState[ idx ] === 2 ) {
				const anchorEl = pAnchor[ idx ];
				if ( anchorEl ) {
					// Two distinct "anchor is gone" modes:
					//
					//   `!isConnected` → the anchor element has been
					//   removed from the DOM entirely (the underlying
					//   window / widget / card has been destroyed).
					//   Physically this is "someone yanked the ground
					//   away" — the realistic response is gravity, so
					//   we detach the flake back into the falling
					//   state and let it continue its descent.
					//
					//   `offsetParent === null` → the element is still
					//   in the DOM but not rendering (minimized
					//   window, switched virtual desktop, collapsed
					//   widget). Physically the ground is still there,
					//   just hidden — the flake has nowhere to fall
					//   to, so it melts in place. This also prevents a
					//   minimize/restore cycle from visually
					//   "respawning" flakes mid-air.
					if ( ! anchorEl.isConnected ) {
						detachToFalling( idx );
					} else if ( anchorEl.offsetParent === null ) {
						startMelt( idx );
					} else {
						const arect = anchorEl.getBoundingClientRect();
						// Resize-shrink guard: the flake's anchored
						// X-offset is relative to the surface's left
						// edge AT THE MOMENT OF STICKING. If the user
						// has since resized the window such that the
						// flake's column is no longer over the surface
						// (width shrank past it, or left edge moved
						// right past it), physically the ground under
						// the flake is gone. Detach to falling — same
						// "ground yanked away" reasoning as a window
						// close — rather than render the flake
						// floating outside the live rect.
						if (
							pAnchorDX[ idx ] < 0 ||
							pAnchorDX[ idx ] > arect.width
						) {
							detachToFalling( idx );
							continue;
						}
						const ax =
							arect.left - canvasRect.left + pAnchorDX[ idx ];
						const ay =
							arect.top - canvasRect.top + pAnchorDY[ idx ];
						pX[ idx ] = ax;
						pY[ idx ] = ay;
						particle.x = ax;
						particle.y = ay;
					}
				} else {
					particle.x = pX[ idx ];
					particle.y = pY[ idx ];
				}

				if ( pState[ idx ] === 2 ) {
					pStuckLife[ idx ] -= dt;
					if ( pStuckLife[ idx ] <= 0 ) {
						startMelt( idx );
					}
				}
			}

			if ( pState[ idx ] === 3 ) {
				pMelt[ idx ] += dt / TUNING.meltDurationSec;
				const t = pMelt[ idx ] > 1 ? 1 : pMelt[ idx ];
				particle.alpha = pBaseAlpha[ idx ] * ( 1 - t );
				const meltScale =
					( pSize[ idx ] / TEXTURE_SIZE ) * ( 1 - t * 0.6 );
				particle.scaleX = meltScale;
				particle.scaleY = meltScale;

				// Gradual pile decrement + slide-above-flakes-down. As
				// this flake fades visually, its pile contribution is
				// returned proportionally — same fraction of
				// `pPileAdd` as `dt / meltDurationSec`. Each frame we
				// also slide every flake stacked above this one (same
				// surface, same bucket, smaller `pAnchorDY`) down by
				// the same delta, so the column compacts smoothly
				// instead of leaving upper flakes hanging in mid-air
				// when this one finishes melting.
				if ( pPileRemaining[ idx ] > 0 && pSurfaceId[ idx ] !== null ) {
					const meltStep = dt / TUNING.meltDurationSec;
					const rawDelta = pPileAdd[ idx ] * meltStep;
					const delta =
						rawDelta < pPileRemaining[ idx ]
							? rawDelta
							: pPileRemaining[ idx ];
					pPileRemaining[ idx ] -= delta;

					const pile = pileHeights.get( pSurfaceId[ idx ] as string );
					if (
						pile &&
						pBucket[ idx ] >= 0 &&
						pBucket[ idx ] < pile.length
					) {
						const bk = pBucket[ idx ];
						const spread = delta * TUNING.pileSpread;
						pile[ bk ] = Math.max( 0, pile[ bk ] - delta );
						if ( bk > 0 ) {
							pile[ bk - 1 ] = Math.max(
								0,
								pile[ bk - 1 ] - spread,
							);
						}
						if ( bk + 1 < pile.length ) {
							pile[ bk + 1 ] = Math.max(
								0,
								pile[ bk + 1 ] - spread,
							);
						}
					}

					// Slide everything stacked above this flake in the
					// same surface + bucket down by `delta`. "Above" =
					// smaller `pAnchorDY` (= higher on screen, in
					// pAnchorDY's down-positive convention). The cost
					// of iterating the pool per melting flake per
					// frame is modest — even the maximum pool with a
					// few dozen simultaneous melts stays well under a
					// millisecond per frame in practice.
					const mySid = pSurfaceId[ idx ];
					const myBucket = pBucket[ idx ];
					const myDY = pAnchorDY[ idx ];
					for ( let j = 0; j < MAX; j++ ) {
						if (
							pState[ j ] === 2 &&
							pSurfaceId[ j ] === mySid &&
							pBucket[ j ] === myBucket &&
							pAnchorDY[ j ] < myDY
						) {
							pAnchorDY[ j ] += delta;
						}
					}
				}

				if ( t >= 1 ) {
					release( idx );
				}
			}
		}
	}

	app.ticker.add( tick );
	if ( ! animating ) {
		// Render one frame so the static field populates, then hold.
		app.ticker.update();
		app.ticker.stop();
	}

	let destroyed = false;

	return {
		setAnimating( next: boolean ): void {
			if ( destroyed ) {
				return;
			}
			animating = next && ! opts.prefersReducedMotion;
			if ( animating ) {
				app.ticker.start();
			} else {
				app.ticker.stop();
			}
		},
		applySettings( next: SnowSettings ): void {
			if ( destroyed ) {
				return;
			}
			// Wind applies on the next frame; flake size on the next
			// spawn (the field turns over within seconds); a lowered
			// particle count drains through natural recycling while a
			// raised one fills at the scaled spawn rate.
			tunables.wind = next.wind;
			tunables.particleCount = next.particleCount;
			tunables.flakeSize = next.flakeSize;
			if ( next.background !== tunables.background ) {
				tunables.background = next.background;
				container.style.background = backdropCss( next.background );
			}
		},
		markSurfacesDirty(): void {
			surfacesDirty = true;
		},
		detachFlakesAnchoredTo( element: HTMLElement ): void {
			if ( destroyed ) {
				return;
			}
			surfacesDirty = true;
			for ( let i = 0; i < MAX; i++ ) {
				if ( pState[ i ] === 2 && pAnchor[ i ] === element ) {
					detachToFalling( i );
				}
			}
		},
		destroy(): void {
			if ( destroyed ) {
				return;
			}
			destroyed = true;
			app.ticker.stop();
			app.ticker.remove( tick );
			// Destroy the Pixi app — releases the WebGL context, the
			// canvas, every particle, and the generated texture.
			app.destroy(
				{ removeView: true },
				{ children: true, texture: true, textureSource: true },
			);
			// Break references the GC might not reclaim otherwise.
			for ( let i = 0; i < MAX; i++ ) {
				particles[ i ] = null;
				pAnchor[ i ] = null;
			}
			container.style.background = priorBackground;
		},
	};
}
