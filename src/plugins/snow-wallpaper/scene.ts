import type { WallpaperSurface } from '../../wallpapers/surfaces';
import type {
	PixiApp,
	PixiNamespace,
	PixiParticle,
	PixiTicker,
} from './pixi-types';
import { backdropCss, SNOW_LIMITS, type SnowSettings } from './settings';

const TEXTURE_SIZE = 64;

const TUNING = {

	spawnPerSecondAtDefault: 90,

	spawnCalibrationCount: 660,

	gravityMin: 28,
	gravityMax: 72,

	windPeriodSec: 11,

	driftAmplitude: 32,
	driftPeriodMin: 2.5,
	driftPeriodMax: 5.5,

	rotationMax: 0.2,
	alphaMin: 0.7,
	alphaMax: 1.0,

	meltDurationSec: 1.8,

	stuckLifeSec: 9.0,
	stuckLifeJitter: 2.5,

	collisionMarginY: 2,

	pileBucketPx: 8,

	pileMaxPx: 48,

	pileContribution: 0.1,

	pileSpread: 0.4,
} as const;

const POOL_SIZE = SNOW_LIMITS.particleCount.max;

export interface SnowScene {

	setAnimating( animating: boolean ): void;

	applySettings( settings: SnowSettings ): void;

	markSurfacesDirty(): void;

	detachFlakesAnchoredTo( element: HTMLElement ): void;

	destroy(): void;
}

export interface SnowSceneOptions {
	container: HTMLElement;
	pixi: PixiNamespace;
	settings: SnowSettings;
	prefersReducedMotion: boolean;

	getSurfaces: ( () => WallpaperSurface[] ) | null;
}

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

	const radius = size / 2 - 1;

	const grad = ctx.createRadialGradient( cx, cy, 0, cx, cy, radius );

	grad.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	grad.addColorStop( 0.3, 'rgba(250, 252, 255, 0.9)' );

	grad.addColorStop( 0.6, 'rgba(235, 245, 255, 0.32)' );

	grad.addColorStop( 0.88, 'rgba(220, 232, 255, 0.07)' );
	grad.addColorStop( 1, 'rgba(210, 228, 255, 0)' );
	ctx.fillStyle = grad;
	ctx.fillRect( 0, 0, size, size );

	return pixi.Texture.from( canvas );
}

function rand( a: number, b: number ): number {
	return a + Math.random() * ( b - a );
}

export async function mountSnowScene(
	opts: SnowSceneOptions,
): Promise< SnowScene > {
	const { container, pixi, getSurfaces } = opts;

	const priorBackground = container.style.background;
	container.style.background = backdropCss( opts.settings.background );

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

	const pState = new Uint8Array( MAX );

	const pAnchor: Array< HTMLElement | null > = new Array( MAX );
	const pAnchorDX = new Float32Array( MAX );
	const pAnchorDY = new Float32Array( MAX );
	const pStuckLife = new Float32Array( MAX );
	const pMelt = new Float32Array( MAX );

	const pSurfaceId: Array< string | null > = new Array( MAX );

	const pBucket = new Int32Array( MAX );

	const pPileAdd = new Float32Array( MAX );

	const pPileRemaining = new Float32Array( MAX );

	const particles: Array< PixiParticle | null > = new Array( MAX );
	const freeList: number[] = new Array( MAX );
	for ( let i = 0; i < MAX; i++ ) {
		const particle = new pixi.Particle( {
			texture,
			anchorX: 0.5,
			anchorY: 0.5,

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

		freeList[ i ] = MAX - 1 - i;
	}
	let freeCount: number = MAX;

	const pileHeights = new Map< string, Float32Array >();

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
		let liveIds: Set< string > | null = null;
		for ( let k = 0; k < all.length; k++ ) {
			const s = all[ k ];

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

		if ( pileHeights.size > 0 ) {
			pileHeights.forEach( ( _arr, id ) => {
				if ( ! liveIds || ! liveIds.has( id ) ) {
					pileHeights.delete( id );
				}
			} );
		}
		surfacesDirty = false;
	}

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
		decrementPileFor( idx );
		pState[ idx ] = 0;
		pAnchor[ idx ] = null;
		pSurfaceId[ idx ] = null;
		pBucket[ idx ] = -1;
		pPileAdd[ idx ] = 0;
		pPileRemaining[ idx ] = 0;

		const particle = particles[ idx ];
		if ( particle ) {
			particle.alpha = 0;
		}
		freeList[ freeCount++ ] = idx;
	}

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
				const add = pSize[ idx ] * TUNING.pileContribution;
				const spread = add * TUNING.pileSpread;

				stick( idx, s.element, vpX - r.x, pileHeight, s.id, bucket, add );

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

	function spawnPerSecond(): number {
		return (
			( TUNING.spawnPerSecondAtDefault * tunables.particleCount ) /
			TUNING.spawnCalibrationCount
		);
	}

	if ( ! animating ) {
		const staticCount = tunables.particleCount * 0.35;
		for ( let s = 0; s < staticCount; s++ ) {
			spawn();
		}
	}

	function tick( ticker: PixiTicker ): void {
		let dt = ticker.deltaMS / 1000;
		if ( dt > 0.1 ) {
			dt = 0.1;
		}
		elapsed += dt;

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

				pVX[ idx ] +=
					( wind + sway - pVX[ idx ] ) * Math.min( 1, dt * 1.5 );

				pX[ idx ] += pVX[ idx ] * dt;
				pY[ idx ] += pVY[ idx ] * dt;
				pRot[ idx ] += pRotVel[ idx ] * dt;

				if ( pX[ idx ] < -16 ) {
					pX[ idx ] += w + 32;
				} else if ( pX[ idx ] > w + 16 ) {
					pX[ idx ] -= w + 32;
				}

				if ( collideWithSurfaces( idx, prevY ) ) {

				} else if ( pY[ idx ] > h + 24 ) {
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
					if ( ! anchorEl.isConnected ) {
						detachToFalling( idx );
					} else if ( anchorEl.offsetParent === null ) {
						startMelt( idx );
					} else {
						const arect = anchorEl.getBoundingClientRect();

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

			app.destroy(
				{ removeView: true },
				{ children: true, texture: true, textureSource: true },
			);

			for ( let i = 0; i < MAX; i++ ) {
				particles[ i ] = null;
				pAnchor[ i ] = null;
			}
			container.style.background = priorBackground;
		},
	};
}
