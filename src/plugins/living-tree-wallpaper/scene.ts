/**
 * The Living Tree — Pixi scene mount.
 *
 * Owns the PixiJS application, the five back→front render layers, the
 * §A.10 main loop, and teardown. The tree simulates in a fixed reference
 * space (root at the origin, up = -y) inside a `treeRoot` container; a
 * resize only re-fits that container's transform — the seed, and
 * therefore the skeleton topology, never change (§A.11).
 *
 * Flow: grow (SCA iterations per frame, bottom→top, ~3–6 s) → settle →
 * leaf-out (staggered fade) → steady state where only wind, fireflies,
 * flowers, and lianas animate.
 *
 * Assumes `window.PIXI` is defined — the wallpaper def declares
 * `needs: ['pixijs']`, so the shell loads it before mount.
 *
 * @since 0.9.4
 */

import {
	createClickCounter,
	isDeveloperModeEnabled,
	isTrunkHit,
	openDebugPanel,
	TUNER_CLICK_THRESHOLD,
	TUNER_CLICK_WINDOW_MS,
} from './debug-panel';
import { buildHormones } from './dna';
import {
	buildEnvelope,
	buildGrowthConfig,
	maxDepthForAge,
	revealCountForAge,
	trunkGirthForAge,
} from './growth/envelope';
import { GrowthSimulator } from './growth/space-colonization';
import { computeGirth } from './growth/girth';
import { countWithinDepth, revealSkeleton } from './growth/reveal';
import { buildCategoryPalette } from './palette';
import {
	getPixi,
	type PixiApp,
	type PixiContainer,
	type PixiSprite,
} from './pixi-types';
import { hash32, mulberry32 } from './rng';
import { currentHour, skyForTime, SkyLayer } from './sky';
import {
	buildBranchMesh,
	buildChains,
	drawBranches,
	type BranchChain,
} from './render/branch-mesh';
import { BloomEngine } from './render/bloom';
import { FireflyLayer } from './render/fireflies';
import { IvyLayer } from './render/ivy';
import { LeafGenerator } from './render/leaves';
import { LianaSystem } from './render/lianas';
import type { BranchNode, SceneHandle, TreeSnapshot, Vec2 } from './types';
import { WindField } from './wind';

interface SceneOptions {
	container: HTMLElement;
	/** The site DNA. `null` when the snapshot fetch failed — render a sprout. */
	snapshot: TreeSnapshot | null;
	prefersReducedMotion: boolean;
}

/**
 * CSS backdrop — a plain dark fill shown only for the instant before the
 * Pixi {@link SkyLayer} paints the real time-of-day sky over it. The sky
 * sprite covers the whole canvas, so this is just a no-flash fallback.
 */
const BACKDROP_CSS = '#141a2e';

/**
 * Rasterize a soft elliptical gradient once (white core → transparent
 * rim); tinted sprites of it build the ground mound and contact shadow
 * with zero banding and no hard ellipse edges.
 */
function buildGroundGradientTexture(
	pixi: import( './pixi-types' ).PixiNamespace,
): import( './pixi-types' ).PixiTexture {
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

/** Fallback DNA when the snapshot fetch failed: an anonymous sprout. */
function sproutSnapshot(): TreeSnapshot {
	return {
		siteUrl: window.location.origin,
		installEpoch: 0,
		siteAgeDays: 0,
		totalPosts: 0,
		totalPages: 0,
		totalCategories: 0,
		totalTags: 0,
		totalComments: 0,
		activeUsers: 0,
		traffic: 0,
		seoHealth: 0.7,
		performance: 0.8,
		branches: [],
		tagCooccurrence: [],
	};
}

/**
 * Build and mount the Living Tree scene. Returns a handle for
 * pause/resume + teardown given a container, the site snapshot (or `null`
 * to render a sprout), and the reduced-motion preference.
 */
export async function mountScene(
	{ container, snapshot, prefersReducedMotion }: SceneOptions,
): Promise< SceneHandle > {
	const pixi = getPixi();
	if ( ! pixi ) {
		throw new Error(
			'[living-tree-wallpaper] window.PIXI is undefined; declare ' +
				"`needs: ['pixijs']` on the wallpaper def so the shell " +
				'loads it before mount.',
		);
	}

	const priorBackground = container.style.background;
	container.style.background = BACKDROP_CSS;

	const app: PixiApp = new pixi.Application();
	await app.init( {
		resizeTo: container,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min( window.devicePixelRatio || 1, 2 ),
		sharedTicker: false,
	} );
	container.appendChild( app.canvas );

	// ── The DNA → biology chain (§A.2–§A.5). ─────────────────────────────
	// All of it is mutable state behind `applyDna()`: the hidden DNA tuner
	// (developer mode) re-runs the whole chain against edited snapshots so
	// the tree regrows live without a remount.
	//
	// The CANONICAL skeleton is grown to completion up front — a pure
	// function of the seed, never of age. Age then reveals a prefix of it
	// (`revealSkeleton`), so day N+1's tree is exactly day N's tree plus a
	// few more nodes: gradual, monotone growth with no daily reshuffle.
	let dna = snapshot ?? sproutSnapshot();
	let hormones = buildHormones( dna );
	let rng = mulberry32( hash32( `${ dna.siteUrl }|${ dna.installEpoch }` ) );
	let envelope = buildEnvelope( hormones.age01, hormones.vigor01, rng );
	let cfg = buildGrowthConfig( envelope, hormones.vigor01 );
	let palette = buildCategoryPalette( dna );
	const wind = new WindField();
	wind.setStrength( prefersReducedMotion ? 0 : hormones.wind01 );

	/** Grow the canonical skeleton to completion (one-time, ~tens of ms). */
	const growCanonical = (): BranchNode[] => {
		const sim = new GrowthSimulator( envelope, cfg, rng );
		let guard = 0;
		while ( ! sim.done && guard++ < 5000 ) {
			sim.step( 10 );
		}
		return sim.nodes;
	};

	let fullNodes = growCanonical();
	let depthCap = maxDepthForAge( hormones.age01 );
	let targetCount = revealCountForAge(
		countWithinDepth( fullNodes, depthCap ),
		hormones.age01,
	);
	// The reveal animation counter; starts at the sprout end unless the
	// scene must paint a finished tree immediately.
	let revealCount = prefersReducedMotion ? targetCount : 2;
	let revealed: BranchNode[] = revealSkeleton( fullNodes, revealCount, depthCap );
	/** The finished tree of the CURRENT age — sizing derives from this. */
	let finalRevealed: BranchNode[] = revealSkeleton( fullNodes, targetCount, depthCap );

	// Trunk girth follows age alone. (Pages briefly modulated it, but "the
	// trunk is arbitrarily fatter" decoded for nobody — pages render as
	// the trunk-ivy cloak instead.)
	const currentTrunkBase = (): number => trunkGirthForAge( hormones.age01 );

	/** Bounding extent of the finished tree — drives fit + ground + hits. */
	const finalExtent = (): { height: number; halfWidth: number } => {
		let height = 40;
		let halfWidth = 30;
		for ( const node of finalRevealed ) {
			height = Math.max( height, -node.pos.y );
			halfWidth = Math.max( halfWidth, Math.abs( node.pos.x ) );
		}
		return { height: height + cfg.segLen * 2, halfWidth: halfWidth + cfg.segLen * 2 };
	};

	// ── Sky backdrop (screen space, very back). ─────────────────────────
	// Tracks the viewer's local clock through a 24h cycle; supplies the
	// ambient `light01` that dims the tree at night.
	const sky = new SkyLayer( pixi, app.stage );

	// ── Render layers, back → front (§A.11), inside the fitted root. ────
	// `treeRoot` is the fitted transform. `treeBody` (ground → flowers)
	// gets the ambient day/night dim as one unit; `fireflyLayer` rides
	// OUTSIDE it so fireflies glow at night and fade by day (opposite of
	// the body's dimming).
	const treeRoot: PixiContainer = new pixi.Container();
	const treeBody: PixiContainer = new pixi.Container();
	const groundLayer: PixiContainer = new pixi.Container();
	const lianaLayer: PixiContainer = new pixi.Container();
	const canopyBackLayer: PixiContainer = new pixi.Container();
	const branchLayer: PixiContainer = new pixi.Container();
	const ivyLayer: PixiContainer = new pixi.Container();
	const leafLayer: PixiContainer = new pixi.Container();
	const flowerLayer: PixiContainer = new pixi.Container();
	const fireflyLayer: PixiContainer = new pixi.Container();
	// Lianas drape OVER the wood (under the lit leaves) — behind the
	// branches they vanished into the canopy mass and tags read as
	// contributing nothing.
	treeBody.addChild(
		groundLayer,
		canopyBackLayer,
		branchLayer,
		lianaLayer,
		ivyLayer,
		leafLayer,
		flowerLayer,
	);
	treeRoot.addChild( treeBody, fireflyLayer );
	app.stage.addChild( treeRoot );

	/**
	 * Recompute the sky for the current local hour and apply the ambient
	 * light: `treeBody` dims into night, `fireflyLayer` brightens.
	 */
	const refreshSky = (): void => {
		const state = skyForTime( currentHour() );
		sky.applyState( state );
		treeBody.alpha = 0.62 + 0.38 * state.light01;
		fireflyLayer.alpha = 0.15 + 0.85 * ( 1 - state.light01 );
	};

	// The ground the tree stands on: layered soft gradient sprites — a
	// broad dusk-grass mound, a moss ring, and a tight contact shadow at
	// the trunk. No hard ellipse rims anywhere. Rebuilt on every
	// `applyDna()` because span + shadow scale with the envelope.
	const groundTexture = buildGroundGradientTexture( pixi );
	const groundSprites: PixiSprite[] = [];
	const buildGround = (): void => {
		for ( const sprite of groundSprites ) {
			groundLayer.removeChild( sprite );
			sprite.destroy();
		}
		groundSprites.length = 0;
		const groundSpan = finalExtent().halfWidth * 1.3 + 80;
		const addGroundSprite = (
			tint: number,
			alpha: number,
			w: number,
			h: number,
			x: number,
			y: number,
		): void => {
			const sprite = new pixi.Sprite( groundTexture );
			sprite.anchor.set( 0.5 );
			sprite.tint = tint;
			sprite.alpha = alpha;
			sprite.scale.x = w / 256;
			sprite.scale.y = h / 96;
			sprite.x = x;
			sprite.y = y;
			groundLayer.addChild( sprite );
			groundSprites.push( sprite );
		};
		addGroundSprite( 0x131c0c, 0.95, groundSpan * 2.7, 120, 0, 20 );
		addGroundSprite( 0x2a3d1a, 0.55, groundSpan * 1.5, 62, -groundSpan * 0.1, 8 );
		addGroundSprite( 0x1c2a12, 0.5, groundSpan * 1.1, 48, groundSpan * 0.22, 12 );
		addGroundSprite( 0x000000, 0.5, currentTrunkBase() * 10 + 60, 30, 0, 4 );
	};
	buildGround();

	const branchGraphics = buildBranchMesh( revealed, pixi );
	branchLayer.addChild( branchGraphics );
	let chains: BranchChain[] = [];
	let chainNodeCount = -1;
	const currentChains = (): BranchChain[] => {
		if ( revealed.length !== chainNodeCount ) {
			chains = buildChains( revealed );
			chainNodeCount = revealed.length;
		}
		return chains;
	};
	const leaves = new LeafGenerator( canopyBackLayer, leafLayer, pixi );
	const ivy = new IvyLayer( ivyLayer, pixi );
	const bloom = new BloomEngine( flowerLayer, pixi );
	const lianas = new LianaSystem( lianaLayer, pixi );
	const fireflies = new FireflyLayer( fireflyLayer, pixi );

	// ── Fit the reference space to the canvas (resize = transform only). ─
	// Sized to the FINISHED tree of the current age (not the mature
	// canonical envelope), so a young tree reads small and the reveal
	// animation grows INTO a stable frame — no camera zoom while growing.
	const fit = (): void => {
		const w = app.canvas.clientWidth || container.clientWidth || 800;
		const h = app.canvas.clientHeight || container.clientHeight || 600;
		sky.resize( w, h );
		const extent = finalExtent();
		const scale = Math.min(
			( h * 0.84 ) / Math.max( 160, extent.height ),
			( w * 0.8 ) / Math.max( 160, extent.halfWidth * 2 ),
			// Never blow a sprout up to fill a 4K desktop.
			1.6,
		);
		treeRoot.scale.set( scale );
		treeRoot.x = w / 2;
		treeRoot.y = h - Math.max( 12, h * 0.04 );
	};
	fit();
	refreshSky();
	const resizeObserver = new ResizeObserver( () => fit() );
	resizeObserver.observe( container );

	// ── Growth + decoration state. ───────────────────────────────────────
	let t = 0;
	let decorated = false;
	let animating = ! prefersReducedMotion;

	// Wood is stiff: branches take only a fraction of the wind the
	// foliage takes. Real trees sway their leaves far more than their
	// limbs — the earlier 1:1 coupling read as rubber branches with
	// stuck-on leaves.
	const BRANCH_WIND_FACTOR = 0.3;
	const displaceNode = ( node: BranchNode ): Vec2 => {
		const w = wind.sample( node.pos.x, node.pos.y, t );
		return {
			x: w.x * node.compliance * BRANCH_WIND_FACTOR,
			y: w.y * node.compliance * BRANCH_WIND_FACTOR,
		};
	};

	/** Once the reveal settles: girth, canopy, blossom, lianas, fireflies. */
	const decorate = (): void => {
		decorated = true;
		computeGirth( revealed, currentTrunkBase() );
		leaves.populate( revealed, hormones, palette, dna, rng );
		ivy.populate( revealed, hormones.structure01, rng );
		bloom.apply( hormones.bloom01, leaves.placements(), rng );
		lianas.build(
			dna.tagCooccurrence,
			hormones.diversity01,
			leaves.placements().map( ( p ) => p.pos ),
			rng,
		);
		const extent = finalExtent();
		fireflies.setBounds( {
			minX: -extent.halfWidth,
			maxX: extent.halfWidth,
			minY: -extent.height,
			maxY: -extent.height * 0.35,
		} );
		fireflies.setCount( hormones.spark );
	};

	// ── The §A.10 main loop. ─────────────────────────────────────────────
	// The sky drifts slowly — recompute it a few times a minute, not every
	// frame (a 24h cycle moves imperceptibly frame-to-frame), while the
	// stars twinkle every frame.
	let skyClock = 0;
	const tick = ( ticker: { deltaTime: number } ): void => {
		if ( ! animating ) {
			return;
		}
		const dt = ticker.deltaTime / 60;
		t += dt;

		sky.tick( t );
		skyClock += dt;
		if ( skyClock >= 12 ) {
			skyClock = 0;
			refreshSky();
		}

		if ( revealCount < targetCount ) {
			// Growth = revealing more of the canonical skeleton, in the
			// exact order it originally grew — bottom → top.
			revealCount = Math.min( targetCount, revealCount + cfg.growthRate );
			revealed = revealSkeleton( fullNodes, revealCount, depthCap );
			computeGirth( revealed, currentTrunkBase() );
			drawBranches( branchGraphics, currentChains(), revealed, null );
			if ( revealCount >= targetCount ) {
				decorate();
			}
			return;
		}

		if ( ! decorated ) {
			decorate();
		}
		// Steady state: wind sways the skeleton; decoration breathes.
		drawBranches( branchGraphics, currentChains(), revealed, displaceNode );
		leaves.update( dt, wind, t );
		ivy.update( dt, t );
		bloom.update( dt, t, ( x, y ) => wind.sample( x, y, t ) );
		lianas.update( dt, t );
		fireflies.update( dt, t );
	};

	app.ticker.add( tick );

	/** Jump the reveal to its target and decorate at once. */
	const growInstantly = (): void => {
		revealCount = targetCount;
		revealed = revealSkeleton( fullNodes, revealCount, depthCap );
		computeGirth( revealed, currentTrunkBase() );
		drawBranches( branchGraphics, currentChains(), revealed, null );
		decorate();
		// Fast-forward the staggered reveals so the result is immediate.
		leaves.update( 60, wind, t );
		ivy.update( 60, t );
		bloom.update( 60, t, () => ( { x: 0, y: 0 } ) );
		lianas.update( 0, t );
	};

	/**
	 * Re-run the full DNA → biology chain against a new snapshot — the
	 * hidden tuner's live-preview path. Clears the old decoration, then
	 * either regrows instantly (slider drags need immediate feedback) or
	 * lets the ticker replay the bottom→top growth.
	 */
	const applyDna = ( next: TreeSnapshot, instant: boolean ): void => {
		dna = next;
		hormones = buildHormones( dna );
		rng = mulberry32( hash32( `${ dna.siteUrl }|${ dna.installEpoch }` ) );
		envelope = buildEnvelope( hormones.age01, hormones.vigor01, rng );
		cfg = buildGrowthConfig( envelope, hormones.vigor01 );
		palette = buildCategoryPalette( dna );
		wind.setStrength( prefersReducedMotion ? 0 : hormones.wind01 );
		// Regrow the canonical skeleton (same seed → identical tree unless
		// the tuner edited the seed inputs) and re-gate the reveal by age.
		fullNodes = growCanonical();
		depthCap = maxDepthForAge( hormones.age01 );
		targetCount = revealCountForAge(
			countWithinDepth( fullNodes, depthCap ),
			hormones.age01,
		);
		finalRevealed = revealSkeleton( fullNodes, targetCount, depthCap );
		revealCount = instant || prefersReducedMotion ? targetCount : 2;
		revealed = revealSkeleton( fullNodes, revealCount, depthCap );
		chainNodeCount = -1;
		decorated = false;
		// Strip the previous tree's decoration so the new one grows bare.
		leaves.populate( [], hormones, palette, dna, rng );
		ivy.populate( [], 0, rng );
		bloom.apply( 0, [], rng );
		lianas.build( [], 0, [], rng );
		fireflies.setCount( 0 );
		buildGround();
		fit();
		refreshSky();
		drawBranches( branchGraphics, currentChains(), revealed, null );
		if ( instant || prefersReducedMotion ) {
			growInstantly();
		}
		if ( prefersReducedMotion ) {
			app.renderer.render( app.stage );
		}
	};

	if ( prefersReducedMotion ) {
		// Grow instantly, decorate fully, paint one still frame.
		growInstantly();
		animating = false;
		app.renderer.render( app.stage );
		app.ticker.stop();
	}

	// ── Hidden DNA tuner (developer mode only): 20 trunk clicks. ────────
	// The wallpaper layer is pointer-events:none, so clicks are observed
	// at the window and hit-tested geometrically against the trunk column.
	const clickCounter = createClickCounter(
		TUNER_CLICK_THRESHOLD,
		TUNER_CLICK_WINDOW_MS,
	);
	let disposeTuner: ( () => void ) | null = null;
	const onWindowClick = ( event: MouseEvent ): void => {
		if ( disposeTuner || ! isDeveloperModeEnabled() ) {
			return;
		}
		const rect = app.canvas.getBoundingClientRect();
		const scale = treeRoot.scale.x || 1;
		const lx = ( event.clientX - rect.left - treeRoot.x ) / scale;
		const ly = ( event.clientY - rect.top - treeRoot.y ) / scale;
		// Hit-test against the REVEALED tree's proportions, not the
		// mature canonical envelope — a sapling's trunk is short.
		const extent = finalExtent();
		const hitEnvelope = {
			...envelope,
			heightMax: extent.height,
			trunkBaseGirth: currentTrunkBase(),
		};
		if ( ! isTrunkHit( lx, ly, hitEnvelope ) ) {
			clickCounter.reset();
			return;
		}
		if ( ! clickCounter.hit( Date.now() ) ) {
			return;
		}
		disposeTuner = openDebugPanel( {
			snapshot: dna,
			onChange: ( edited ) => applyDna( edited, true ),
			onClose: () => {
				disposeTuner = null;
			},
		} );
	};
	window.addEventListener( 'click', onWindowClick );

	return {
		destroy(): void {
			window.removeEventListener( 'click', onWindowClick );
			if ( disposeTuner ) {
				disposeTuner();
				disposeTuner = null;
			}
			resizeObserver.disconnect();
			app.ticker.stop();
			leaves.destroy();
			ivy.destroy();
			bloom.destroy();
			fireflies.destroy();
			lianas.destroy();
			sky.destroy();
			app.destroy( true, { children: true, texture: true } );
			try {
				groundTexture.destroy( true );
			} catch {
				/* already released by app.destroy when texture:true is set */
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
