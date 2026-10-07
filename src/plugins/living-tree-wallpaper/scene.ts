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
import { canopyHue } from './palette';
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
import { ButterflyLayer } from './render/butterflies';
import { FallingLeaves } from './render/falling';
import { FireflyLayer } from './render/fireflies';
import { FlowerField } from './render/flowers';
import { GroundLayer } from './render/ground';
import { IvyLayer } from './render/ivy';
import { LeafGenerator } from './render/leaves';
import type { BranchNode, SceneHandle, TreeSnapshot } from './types';
import { WindField } from './wind';

interface SceneOptions {
	container: HTMLElement;

	snapshot: TreeSnapshot | null;
	prefersReducedMotion: boolean;
}

const BACKDROP_CSS = '#141a2e';

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
	};
}

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

	let dna = snapshot ?? sproutSnapshot();
	let hormones = buildHormones( dna );
	let rng = mulberry32( hash32( `${ dna.siteUrl }|${ dna.siteName }|${ dna.installEpoch }` ) );
	let envelope = buildEnvelope( hormones.age01, hormones.vigor01, rng );
	let cfg = buildGrowthConfig( envelope, hormones.vigor01 );
	let canopy = canopyHue( `${ dna.siteUrl }|${ dna.siteName }` );
	const wind = new WindField();
	wind.setStrength( prefersReducedMotion ? 0 : hormones.wind01 );

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

	let revealCount = prefersReducedMotion ? targetCount : 2;
	let revealed: BranchNode[] = revealSkeleton( fullNodes, revealCount, depthCap );

	let finalRevealed: BranchNode[] = revealSkeleton( fullNodes, targetCount, depthCap );

	const currentTrunkBase = (): number => trunkGirthForAge( hormones.age01 );

	const finalExtent = (): { height: number; halfWidth: number } => {
		let height = 40;
		let halfWidth = 30;
		for ( const node of finalRevealed ) {
			height = Math.max( height, -node.pos.y );
			halfWidth = Math.max( halfWidth, Math.abs( node.pos.x ) );
		}
		return { height: height + cfg.segLen * 2, halfWidth: halfWidth + cfg.segLen * 2 };
	};

	const sky = new SkyLayer( pixi, app.stage );

	const treeRoot: PixiContainer = new pixi.Container();
	const treeBody: PixiContainer = new pixi.Container();
	const groundLayer: PixiContainer = new pixi.Container();
	const flowerFieldLayer: PixiContainer = new pixi.Container();
	const canopyBackLayer: PixiContainer = new pixi.Container();
	const branchLayer: PixiContainer = new pixi.Container();
	const ivyLayer: PixiContainer = new pixi.Container();
	const leafLayer: PixiContainer = new pixi.Container();
	const flowerLayer: PixiContainer = new pixi.Container();

	const butterflyLayer: PixiContainer = new pixi.Container();
	const fireflyLayer: PixiContainer = new pixi.Container();
	treeBody.addChild(
		groundLayer,
		flowerFieldLayer,
		canopyBackLayer,
		branchLayer,
		ivyLayer,
		leafLayer,
		flowerLayer,
		butterflyLayer,
	);
	treeRoot.addChild( treeBody, fireflyLayer );
	app.stage.addChild( treeRoot );

	const refreshSky = (): void => {
		const state = skyForTime( currentHour() );
		sky.applyState( state );
		treeBody.alpha = 0.62 + 0.38 * state.light01;
		fireflyLayer.alpha = 0.15 + 0.85 * ( 1 - state.light01 );
	};

	const ground = new GroundLayer( groundLayer, pixi );
	const flowerField = new FlowerField( flowerFieldLayer, pixi );

	let meadowDepth = 20;
	const buildGround = (): void => {
		const scale = treeRoot.scale.x || 1;
		const canvasW = app.canvas.clientWidth || container.clientWidth || 800;
		const canvasH = app.canvas.clientHeight || container.clientHeight || 600;
		const span = finalExtent().halfWidth * 1.3 + 80;
		const coverHalfWidth = canvasW / ( 2 * scale ) + 40;

		meadowDepth = Math.max( 0, canvasH - treeRoot.y ) / scale + 8;
		ground.build( {
			span,
			coverHalfWidth,
			coverDepth: meadowDepth,
			trunkBase: currentTrunkBase(),
			health01: hormones.health01,
			siteKey: `${ dna.siteUrl }|${ dna.siteName }`,
		} );

		flowerField.build( {
			categories: dna.totalCategories,
			fieldHalf: Math.min( coverHalfWidth * 0.95, span * 1.35 + 90 ),
			coverDepth: meadowDepth,
			trunkBase: currentTrunkBase(),
			siteKey: `${ dna.siteUrl }|${ dna.siteName }`,
		} );
	};

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
	const butterflies = new ButterflyLayer( butterflyLayer, pixi );
	const fireflies = new FireflyLayer( fireflyLayer, pixi );

	const fit = (): void => {
		const w = app.canvas.clientWidth || container.clientWidth || 800;
		const h = app.canvas.clientHeight || container.clientHeight || 600;
		const extent = finalExtent();
		const scale = Math.min(
			( h * 0.84 ) / Math.max( 160, extent.height ),
			( w * 0.8 ) / Math.max( 160, extent.halfWidth * 2 ),

			1.6,
		);
		treeRoot.scale.set( scale );
		treeRoot.x = w / 2;
		treeRoot.y = h - Math.max( 12, h * 0.04 );

		sky.resize( w, h, treeRoot.y - 4 * scale );
	};
	fit();
	refreshSky();
	buildGround();
	const resizeObserver = new ResizeObserver( () => fit() );
	resizeObserver.observe( container );

	let t = 0;
	let decorated = false;
	let animating = ! prefersReducedMotion;

	const decorate = (): void => {
		decorated = true;
		computeGirth( revealed, currentTrunkBase() );

		drawBranches( branchGraphics, currentChains(), revealed, null );
		branchGraphics.cacheAsTexture?.( true );
		leaves.populate( revealed, hormones, canopy, dna, rng );
		falling.setSources( leaves.sources( 48 ) );
		ivy.populate( revealed, hormones.structure01, rng );
		bloom.apply( hormones.bloom01, leaves.placements(), rng );
		const extent = finalExtent();

		butterflies.populate(
			dna.totalTags,
			flowerField.targets(),
			{
				minX: -extent.halfWidth,
				maxX: extent.halfWidth,
				minY: -extent.height * 0.55,
				maxY: Math.max( 4, meadowDepth * 0.6 ),
			},
			rng,
		);
		fireflies.setBounds( {
			minX: -extent.halfWidth,
			maxX: extent.halfWidth,
			minY: -extent.height,
			maxY: -extent.height * 0.35,
		} );
		fireflies.setCount( hormones.spark );
	};

	let skyClock = 0;
	let foliageFlip = false;
	let foliageDt = 0;
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

		foliageDt += dt;
		foliageFlip = ! foliageFlip;
		if ( foliageFlip ) {
			leaves.update( foliageDt, wind, t );
			bloom.update( foliageDt, t, ( x, y ) => wind.sample( x, y, t ) );
			flowerField.update( foliageDt, t, ( x, y ) => wind.sample( x, y, t ) );
			foliageDt = 0;
		}
		falling.update( dt, wind, t );
		ivy.update( dt, t );
		butterflies.update( dt, t );
		fireflies.update( dt, t );
	};

	app.ticker.add( tick );

	const growInstantly = (): void => {
		revealCount = targetCount;
		revealed = revealSkeleton( fullNodes, revealCount, depthCap );
		computeGirth( revealed, currentTrunkBase() );
		drawBranches( branchGraphics, currentChains(), revealed, null );
		decorate();

		leaves.update( 60, wind, t );
		ivy.update( 60, t );
		bloom.update( 60, t, () => ( { x: 0, y: 0 } ) );
		flowerField.update( 60, t, () => ( { x: 0, y: 0 } ) );
	};

	const applyDna = ( next: TreeSnapshot, instant: boolean ): void => {
		dna = next;
		hormones = buildHormones( dna );
		rng = mulberry32( hash32( `${ dna.siteUrl }|${ dna.siteName }|${ dna.installEpoch }` ) );
		envelope = buildEnvelope( hormones.age01, hormones.vigor01, rng );
		cfg = buildGrowthConfig( envelope, hormones.vigor01 );
		canopy = canopyHue( `${ dna.siteUrl }|${ dna.siteName }` );
		wind.setStrength( prefersReducedMotion ? 0 : hormones.wind01 );

		branchGraphics.cacheAsTexture?.( false );
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

		leaves.populate( [], hormones, canopy, dna, rng );
		falling.setSources( [] );
		ivy.populate( [], 0, rng );
		bloom.apply( 0, [], rng );
		butterflies.clear();
		fireflies.setCount( 0 );
		fit();
		refreshSky();
		buildGround();
		drawBranches( branchGraphics, currentChains(), revealed, null );
		if ( instant || prefersReducedMotion ) {
			growInstantly();
		}
		if ( prefersReducedMotion ) {
			app.renderer.render( app.stage );
		}
	};

	if ( prefersReducedMotion ) {
		growInstantly();
		animating = false;
		app.renderer.render( app.stage );
		app.ticker.stop();
	}

	const setHourOverride = ( hour: number | null ): void => {
		const w = window as unknown as {
			openStationLivingTreeHourOverride?: number;
		};
		if ( hour === null ) {
			delete w.openStationLivingTreeHourOverride;
		} else {
			w.openStationLivingTreeHourOverride = hour;
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
			butterflies.destroy();
			fireflies.destroy();
			flowerField.destroy();
			ground.destroy();
			sky.destroy();

			app.destroy( { removeView: true }, { children: true, texture: true } );
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
