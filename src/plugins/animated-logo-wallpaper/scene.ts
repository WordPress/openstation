import type { Application, Container, Sprite, Texture } from 'pixi.js';

declare global {
	interface Window {
		PIXI?: typeof import( 'pixi.js' );
	}
}

export interface SceneHandle {

	destroy(): void;

	setAnimating( playing: boolean ): void;
}

interface SceneOptions {
	container: HTMLElement;
	logoUrl: string;
	prefersReducedMotion: boolean;
}

const CONFIG = {

	sampleStride: 7,

	alphaThreshold: 128,

	targetLogoWidth: 1000,

	logoShellFraction: 0.72,

	spriteReferenceWidth: 700,

	springK: 0.015,

	damping: 0.86,

	restVelocityEpsilon: 0.02,

	dragRadius: 150,

	dragStrength: 0.22,

	dragBoost: 0.3,

	dragBoostRefSpeed: 40,

	maxMouseDelta: 80,

	brushSize: 128,

	spriteScaleMin: 0.1,
	spriteScaleMax: 0.26,

	spriteAlphaMin: 0.55,
	spriteAlphaMax: 0.92,
};

const PARTICLE_PALETTE = [

	0xff3b3b, 0xff3b3b,
	0xff8c2a, 0xff8c2a,
	0xffd93d, 0xffd93d,
	0x4cd964, 0x4cd964,
	0x3ea0ff, 0x3ea0ff,
	0xa86bff, 0xa86bff,

	0xffb3c7,
	0x7fdfff,
	0xffffff,

	0xc8804a,
];

const BACKDROP_CSS =
	'radial-gradient(circle at 50% 50%, #1e40af 0%, #152a6b 45%, #0a1024 100%)';

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

	const homes = await sampleLogoHomes( logoUrl );

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

	const brushTexture: Texture = buildBrushTexture( pixi );

	const particleLayer: Container = new pixi.Container();
	app.stage.addChild( particleLayer );

	const n = homes.length;
	const homeX = new Float32Array( n );
	const homeY = new Float32Array( n );
	const x = new Float32Array( n );
	const y = new Float32Array( n );
	const vx = new Float32Array( n );
	const vy = new Float32Array( n );

	const sprites: Sprite[] = new Array( n );

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

		const spriteFactor = Math.min(
			1,
			target / CONFIG.spriteReferenceWidth,
		);

		for ( let i = 0; i < n; i++ ) {
			sprites[ i ].scale.set( baseScale[ i ] * spriteFactor );
			homeX[ i ] = logoOffsetX + homes[ i ][ 0 ] * logoScale;
			homeY[ i ] = logoOffsetY + homes[ i ][ 1 ] * logoScale;

			if ( x[ i ] === 0 && y[ i ] === 0 ) {
				x[ i ] = homeX[ i ];
				y[ i ] = homeY[ i ];
			}
		}
	};
	computeLayout();

	const resizeObserver = new ResizeObserver( () => computeLayout() );
	resizeObserver.observe( container );

	let pointerX = -1e6;
	let pointerY = -1e6;
	let pointerActive = false;

	let mouseDx = 0;
	let mouseDy = 0;

	const onPointerMove = ( e: PointerEvent ): void => {
		const rect = app.canvas.getBoundingClientRect();
		const nx = e.clientX - rect.left;
		const ny = e.clientY - rect.top;
		if ( pointerActive ) {
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

	window.addEventListener( 'pointermove', onPointerMove, { passive: true } );
	window.addEventListener( 'pointerleave', onPointerLeave );

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
			window.removeEventListener( 'pointermove', onPointerMove );
			window.removeEventListener( 'pointerleave', onPointerLeave );

			app.destroy( { removeView: true }, {
				children: true,
				texture: true,
				textureSource: true,
				context: true,
			} as object );
			try {
				brushTexture.destroy( true );
			} catch {

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
	const restPosEps = 0.25;
	const restPosEpsSq = restPosEps * restPosEps;

	const mouseSpeed = Math.sqrt( mouseDx * mouseDx + mouseDy * mouseDy );
	const speedMultiplier = 1 + ( mouseSpeed / dragBoostRefSpeed ) * dragBoost;
	const dragFx = mouseDx * dragStrength * speedMultiplier;
	const dragFy = mouseDy * dragStrength * speedMultiplier;
	const cursorMoving = mouseDx !== 0 || mouseDy !== 0;

	for ( let i = 0; i < n; i++ ) {
		const dhx = homeX[ i ] - x[ i ];
		const dhy = homeY[ i ] - y[ i ];
		let fx = dhx * springK;
		let fy = dhy * springK;

		const dx = x[ i ] - pointerX;
		const dy = y[ i ] - pointerY;
		const distSq = dx * dx + dy * dy;
		let disturbed = false;
		if ( cursorMoving && distSq < dragRadiusSq ) {
			const t = 1 - Math.sqrt( distSq ) / dragRadius;
			const falloff = t * t;
			fx += dragFx * falloff;
			fy += dragFy * falloff;
			disturbed = true;
		}

		const nvx = ( vx[ i ] + fx ) * damping;
		const nvy = ( vy[ i ] + fy ) * damping;

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

	gradient.addColorStop( 0, 'rgba(255, 255, 255, 1)' );
	gradient.addColorStop( 0.18, 'rgba(255, 255, 255, 0.85)' );
	gradient.addColorStop( 0.42, 'rgba(255, 255, 255, 0.28)' );
	gradient.addColorStop( 0.75, 'rgba(255, 255, 255, 0.06)' );
	gradient.addColorStop( 1, 'rgba(255, 255, 255, 0)' );

	ctx.fillStyle = gradient;
	ctx.fillRect( 0, 0, size, size );

	return pixi.Texture.from( canvas );
}

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
				homes.push( [ px / sampleWidth, py / sampleHeight ] );
			}
		}
	}

	return homes;
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
