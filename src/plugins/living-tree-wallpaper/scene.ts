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
	createTrunkClickGesture,
	isDeveloperModeEnabled,
	isTrunkHit,
	openDebugPanel,
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
import { getPixi, type PixiApp, type PixiContainer } from './pixi-types';
import { hash32, mulberry32 } from './rng';
import { currentHour, skyForTime, SkyLayer } from './sky';
import {
	buildBranchMesh,
	buildChains,
	drawBranches,
	type BranchChain,
} from './render/branch-mesh';
import { BloomEngine } from './render/bloom';
import { FallingLeaves } from './render/falling';
import { FireflyLayer } from './render/fireflies';
import { GroundLayer } from './render/ground';
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

/** Fallback DNA when the snapshot fetch failed: an anonymous sprout. */
function sproutSnapshot(): TreeSnapshot {
	return {
		siteUrl: window.location.origin,
		siteName: document.title || '',
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
	let rng = mulberry32( hash32( `${ dna.siteUrl }|${ dna.siteName }|${ dna.installEpoch }` ) );
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

	// The meadow the tree stands in: soil mounds, per-blade grass clumps
	// swaying in the wind, a contact shadow, and fallen leaves near the
	// trunk. Rebuilt on every `applyDna()` — its span scales with the
	// tree's extent and its greens dry out with `health01`.
	const ground = new GroundLayer( groundLayer, pixi );
	const buildGround = (): void => {
		ground.build( {
			span: finalExtent().halfWidth * 1.3 + 80,
			trunkBase: currentTrunkBase(),
			health01: hormones.health01,
			wind01: prefersReducedMotion ? 0 : hormones.wind01,
			siteKey: `${ dna.siteUrl }|${ dna.siteName }`,
		} );
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
	const falling = new FallingLeaves( leafLayer, pixi );
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
		falling.setSources( leaves.sources( 48 ) );
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
		ground.update( t );
		leaves.update( dt, wind, t );
		falling.update( dt, wind, t );
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
		rng = mulberry32( hash32( `${ dna.siteUrl }|${ dna.siteName }|${ dna.installEpoch }` ) );
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
		falling.setSources( [] );
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
	/** Set / clear the debug time-of-day override the sky reads. */
	const setHourOverride = ( hour: number | null ): void => {
		const w = window as unknown as {
			desktopModeLivingTreeHourOverride?: number;
		};
		if ( hour === null ) {
			delete w.desktopModeLivingTreeHourOverride;
		} else {
			w.desktopModeLivingTreeHourOverride = hour;
		}
	};
	let disposeTuner: ( () => void ) | null = null;
	const onWindowClick = createTrunkClickGesture( {
		isEnabled: () => ! disposeTuner && isDeveloperModeEnabled(),
		toLocal: ( clientX, clientY ) => {
			const rect = app.canvas.getBoundingClientRect();
			const scale = treeRoot.scale.x || 1;
			return {
				lx: ( clientX - rect.left - treeRoot.x ) / scale,
				ly: ( clientY - rect.top - treeRoot.y ) / scale,
			};
		},
		// Hit-test against the REVEALED tree's proportions, not the
		// mature canonical envelope — a sapling's trunk is short.
		isHit: ( lx, ly ) => {
			const extent = finalExtent();
			return isTrunkHit( lx, ly, {
				...envelope,
				heightMax: extent.height,
				trunkBaseGirth: currentTrunkBase(),
			} );
		},
		onTrigger: () => {
			disposeTuner = openDebugPanel( {
				snapshot: dna,
				hour: currentHour(),
				onChange: ( edited ) => applyDna( edited, true ),
				onHourChange: ( hour ) => {
					setHourOverride( hour );
					refreshSky();
					if ( prefersReducedMotion ) {
						app.renderer.render( app.stage );
					}
				},
				onClose: () => {
					disposeTuner = null;
					// Closing the tuner hands the sky back to the real clock.
					setHourOverride( null );
					refreshSky();
				},
			} );
		},
	} );
	window.addEventListener( 'click', onWindowClick );

	return {
		destroy(): void {
			window.removeEventListener( 'click', onWindowClick );
			if ( disposeTuner ) {
				disposeTuner();
				disposeTuner = null;
				setHourOverride( null );
			}
			resizeObserver.disconnect();
			app.ticker.stop();
			leaves.destroy();
			falling.destroy();
			ivy.destroy();
			bloom.destroy();
			fireflies.destroy();
			lianas.destroy();
			ground.destroy();
			sky.destroy();
			app.destroy( true, { children: true, texture: true } );
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
