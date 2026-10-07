import './styles.css';

import type { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { __ } from '../../i18n';
import { createSharedStore } from '../../shared-store';
import { clampToViewport } from '../../ui/util/menu-position';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

async function loadPixi(): Promise< void > {
	const wp = ( window as unknown as {
		wp?: { os?: { loadModules?: ( ids: string[] ) => Promise< void > } };
	} ).wp;
	const fn = wp?.os?.loadModules;
	if ( typeof fn !== 'function' ) {
		throw new Error(
			'wp.os.loadModules is not available — main shell may not have booted yet.',
		);
	}
	await fn( [ 'pixijs' ] );
}

declare global {
	interface Window {
		PIXI?: typeof import( 'pixi.js' );
	}
}

interface WpHeartbeat {
	interval?: () => number;
	connectNow?: () => void;
	hasFocus?: () => boolean;
}
interface WpGlobal {
	heartbeat?: WpHeartbeat;
}
type JQueryLike = ( target: unknown ) => {
	on: ( event: string, handler: ( ...args: unknown[] ) => void ) => unknown;
	off: ( event: string, handler: ( ...args: unknown[] ) => void ) => unknown;
};

interface WpBeatState {
	lastTickAt: number;
	lastSendAt: number;
	intervalSecs: number;
	tickSeq: number;
	booted: boolean;
}

const wpBeatStore = createSharedStore< WpBeatState >(
	'desktop-mode/heartbeat-widget/wp-beats',
	() => ( {
		lastTickAt: 0,
		lastSendAt: 0,
		intervalSecs: 15,
		tickSeq: 0,
		booted: false,
	} ),
);

function bootWpBeatTracker(): void {
	const s = wpBeatStore;
	if ( s.state.booted ) {
		return;
	}
	s.state.booted = true;
	s.state.intervalSecs = wpHeartbeatInterval();

	s.state.lastTickAt = performance.now();

	const jq = ( window as unknown as { jQuery?: JQueryLike } ).jQuery;
	if ( ! jq ) {
		return;
	}
	const $doc = jq( document );
	$doc.on( 'heartbeat-send', () => {
		s.state.lastSendAt = performance.now();
	} );
	$doc.on( 'heartbeat-tick', () => {
		s.state.lastTickAt = performance.now();
		s.state.intervalSecs = wpHeartbeatInterval();

		s.state.tickSeq += 1;
		s.notify();
	} );
}

const HEART_PALETTE = {
	rim: 0x6a0f25,
	deep: 0x991f3a,
	body: 0xd4264f,
	bright: 0xff4d6d,
	hi: 0xffa5b8,
} as const;
const HEART_COLOR_REST = HEART_PALETTE.bright;
const HEART_COLOR_BEAT = HEART_PALETTE.hi;
const HEART_SIZE = 52;

const mount = async (
	container: HTMLElement,
	ctx: WidgetContext,
): Promise< WidgetTeardown > => {
	try {
		await loadPixi();
	} catch ( e ) {
		renderFallback( container, ( e as Error ).message );
		return () => undefined;
	}
	return mountWithPixi( container, ctx );
};

void __;

function logoUrl( ctx: WidgetContext ): string {
	const base = ( ctx?.pluginUrl ?? '' ).replace( /\/+$/, '' );
	return `${ base }/assets/images/wp-logo.png`;
}

function renderFallback( container: HTMLElement, message: string ): void {
	container.classList.add( 'os-widget-heartbeat' );
	container.classList.add( 'os-widget-heartbeat--fallback' );
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-widget-heartbeat__fallback';
	wrap.textContent = message || 'Could not load animation engine.';
	container.appendChild( wrap );
}

const FRAME_HEIGHT_WITH_HEART = 230;

const FRAME_HEIGHT_NO_HEART = 88;

async function mountWithPixi(
	container: HTMLElement,
	ctx: WidgetContext,
): Promise< WidgetTeardown > {
	const pixi = window.PIXI;
	if ( ! pixi ) {
		renderFallback( container, 'PIXI not available.' );
		return () => undefined;
	}

	container.classList.add( 'os-widget-heartbeat' );

	let showHeart = ctx.storage.get< boolean >( 'showHeart' ) ?? true;
	if ( ! showHeart ) {
		container.classList.add( 'os-widget-heartbeat--no-heart' );
	}

	const stage = document.createElement( 'div' );
	stage.className = 'os-widget-heartbeat__stage';
	container.appendChild( stage );

	const meta = document.createElement( 'div' );
	meta.className = 'os-widget-heartbeat__meta';
	const label = document.createElement( 'div' );
	label.className = 'os-widget-heartbeat__label';
	label.textContent = 'Next beat in';
	meta.appendChild( label );
	const remaining = document.createElement( 'div' );
	remaining.className = 'os-widget-heartbeat__remaining';
	remaining.textContent = '—';
	meta.appendChild( remaining );
	container.appendChild( meta );

	const bar = document.createElement( 'div' );
	bar.className = 'os-widget-heartbeat__bar';
	const fill = document.createElement( 'div' );
	fill.className = 'os-widget-heartbeat__bar-fill';
	bar.appendChild( fill );
	container.appendChild( bar );

	const app: Application = new pixi.Application();
	await app.init( {
		resizeTo: stage,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min( window.devicePixelRatio || 1, 2 ),
	} );
	stage.appendChild( app.canvas );

	const halo: Graphics = buildHalo( pixi );
	const { view: heart, body: heartBody } = buildHeart( pixi );
	const logo: Container = buildLogoSprite( pixi, logoUrl( ctx ) );
	app.stage.addChild( halo );
	app.stage.addChild( heart );
	heart.addChild( logo );

	const centre = (): void => {
		halo.x = app.screen.width / 2;
		halo.y = app.screen.height / 2;
		heart.x = app.screen.width / 2;
		heart.y = app.screen.height / 2;
	};
	centre();
	const ro = new ResizeObserver( () => centre() );
	ro.observe( stage );

	bootWpBeatTracker();

	let pulseAccum = 0;
	let bigBeatT = 0;
	let glow = 0;
	let lastSeenSeq = wpBeatStore.state.tickSeq;

	const unsubscribe = wpBeatStore.subscribe( ( s ) => {
		if ( s.tickSeq !== lastSeenSeq ) {
			lastSeenSeq = s.tickSeq;
			bigBeatT = 1;
			glow = 1;
		}
	} );

	const jq = ( window as unknown as { jQuery?: JQueryLike } ).jQuery;
	let simHandle: ReturnType< typeof setInterval > | null = null;
	if ( ! jq ) {
		simHandle = setInterval( () => {
			wpBeatStore.state.lastTickAt = performance.now();
			wpBeatStore.state.tickSeq += 1;
			wpBeatStore.notify();
		}, wpBeatStore.state.intervalSecs * 1000 );
	}
	const detach = (): void => {
		unsubscribe();
		if ( simHandle !== null ) {
			clearInterval( simHandle );
		}
	};

	const tick = (): void => {
		const dt = app.ticker.deltaMS / 1000;
		pulseAccum += dt;

		const restPhase = ( pulseAccum / 4.0 ) * Math.PI * 2;
		const restingScaleBase = 1 + 0.008 * Math.sin( restPhase );
		let restingScale = restingScaleBase;

		let squishX = 0;
		let squishY = 0;
		if ( bigBeatT > 0 ) {
			bigBeatT = Math.max( 0, bigBeatT - dt / 0.9 );
			const t = 1 - bigBeatT;
			let env: number;
			if ( t < 0.10 ) {
				env = 0.55 * ( t / 0.10 );
			} else if ( t < 0.28 ) {
				env = 0.55 - 0.50 * ( ( t - 0.10 ) / 0.18 );
			} else if ( t < 0.55 ) {
				env = 0.05 + 0.10 * Math.sin( ( ( t - 0.28 ) / 0.27 ) * Math.PI );
			} else {
				const k = ( t - 0.55 ) / 0.45;
				env = 0.05 * ( 1 - k ) * Math.exp( -2.5 * k );
			}
			restingScale += env;

			if ( t < 0.20 ) {
				const sP = Math.sin( ( t / 0.20 ) * Math.PI );
				squishX = 0.10 * sP;
				squishY = -0.05 * sP;
			}
		}

		heart.scale.x = restingScale * ( 1 + squishX );
		heart.scale.y = restingScale * ( 1 + squishY );

		glow = Math.max( 0, glow - dt / 1.2 );
		halo.alpha = 0.10 + glow * 0.55;
		const haloScale = 1 + glow * 0.15;
		halo.scale.set( haloScale );

		heartBody.tint = lerpColor(
			HEART_COLOR_REST,
			HEART_COLOR_BEAT,
			Math.min( 1, glow * 0.6 + bigBeatT * 0.4 ),
		);

		const elapsed = ( performance.now() - wpBeatStore.state.lastTickAt ) / 1000;
		const intervalSecs = wpBeatStore.state.intervalSecs;
		const progress = clamp( elapsed / Math.max( intervalSecs, 1 ), 0, 1 );
		fill.style.width = `${ ( progress * 100 ).toFixed( 1 ) }%`;
		const remainSecs = Math.max( 0, intervalSecs - elapsed );
		remaining.textContent = `${ remainSecs.toFixed( 1 ) }s`;
	};
	app.ticker.add( tick );

	const resyncCanvasToStage = (): void => {
		requestAnimationFrame( () => {
			try {
				( app as unknown as { resize?: () => void } ).resize?.();
			} catch ( _e ) {
				try {
					const sw = stage.clientWidth;
					const sh = stage.clientHeight;
					if ( sw > 0 && sh > 0 ) {
						( app.renderer as unknown as { resize: ( w: number, h: number ) => void } ).resize( sw, sh );
					}
				} catch ( _err ) {

				}
			}
			centre();
		} );
	};

	const onContextMenu = ( e: MouseEvent ): void => {
		e.preventDefault();
		e.stopPropagation();
		openHeartbeatMenu( e, showHeart, ( next ) => {
			showHeart = next;
			ctx.storage.set( 'showHeart', next );
			applyHeartVisibility( container, next );
			if ( next ) {
				resyncCanvasToStage();
			}
		} );
	};
	container.addEventListener( 'contextmenu', onContextMenu );

	applyHeartVisibility( container, showHeart );
	if ( showHeart ) {
		resyncCanvasToStage();
	}

	return () => {
		container.removeEventListener( 'contextmenu', onContextMenu );
		detach();
		ro.disconnect();
		app.ticker.remove( tick );

		try {
			( app as unknown as { canvas?: { remove(): void } } ).canvas?.remove();
		} catch {

		}
		container.classList.remove( 'os-widget-heartbeat' );
		container.classList.remove( 'os-widget-heartbeat--no-heart' );
	};
}

function applyHeartVisibility( container: HTMLElement, showHeart: boolean ): void {
	container.classList.toggle( 'os-widget-heartbeat--no-heart', ! showHeart );
	const card = container.closest< HTMLElement >( '.os-widgets__card' );
	if ( card ) {
		card.classList.add( 'os-widgets__card--heartbeat' );
		const h = showHeart ? FRAME_HEIGHT_WITH_HEART : FRAME_HEIGHT_NO_HEART;
		card.style.height = `${ h }px`;
	}
}

function openHeartbeatMenu(
	e: MouseEvent,
	showHeart: boolean,
	onToggle: ( next: boolean ) => void,
): void {
	document
		.querySelectorAll( '.os-widget-heartbeat__menu' )
		.forEach( ( el ) => el.remove() );

	const menu = document.createElement( 'os-context-menu' );
	menu.className = 'os-widget-heartbeat__menu';
	menu.setAttribute( 'open', '' );
	menu.style.position = 'fixed';
	menu.style.left = `${ e.clientX }px`;
	menu.style.top = `${ e.clientY }px`;
	menu.style.zIndex = '10500';

	const opt = document.createElement( 'os-context-menu-option' );
	opt.setAttribute( 'value', 'show-heart' );
	if ( showHeart ) {
		opt.setAttribute( 'checked', '' );
	}
	opt.textContent = 'Show heart';
	menu.appendChild( opt );

	const close = (): void => {
		menu.remove();
		document.removeEventListener( 'pointerdown', onOutside, true );
		document.removeEventListener( 'keydown', onKey, true );
	};
	const onOutside = ( ev: Event ): void => {
		if ( ! menu.contains( ev.target as Node ) ) {
			close();
		}
	};
	const onKey = ( ev: KeyboardEvent ): void => {
		if ( ev.key === 'Escape' ) {
			close();
		}
	};

	menu.addEventListener( 'os-context-menu-pick', () => {
		onToggle( ! showHeart );
		close();
	} );

	document.body.appendChild( menu );

	clampToViewport( menu );

	document.addEventListener( 'pointerdown', onOutside, true );
	document.addEventListener( 'keydown', onKey, true );
}

function buildHalo( pixi: typeof import( 'pixi.js' ) ): Graphics {
	const g = new pixi.Graphics();

	const radii = [ HEART_SIZE * 1.20, HEART_SIZE * 1.05, HEART_SIZE * 0.85 ];
	const alphas = [ 0.12, 0.18, 0.28 ];
	radii.forEach( ( r, i ) => {
		g.circle( 0, 0, r );
		g.fill( { color: HEART_COLOR_BEAT, alpha: alphas[ i ] } );
	} );
	g.alpha = 0.1;
	return g;
}

function heartPath( scaleMul = 1 ): number[] {
	const samples = 240;
	const pts: number[] = [];
	const s = ( HEART_SIZE / 17 ) * scaleMul;
	for ( let i = 0; i <= samples; i++ ) {
		const t = ( i / samples ) * Math.PI * 2;
		const x = 16 * 1.08 * Math.sin( t ) ** 3;
		const y = -(
			13 * Math.cos( t ) -
				5 * Math.cos( 2 * t ) -
				2 * Math.cos( 3 * t ) -
				Math.cos( 4 * t )
		);
		pts.push( x * s, y * s );
	}
	return pts;
}

function buildHeart(
	pixi: typeof import( 'pixi.js' ),
): { view: Container; body: Sprite } {
	const wrap = new pixi.Container();
	const bounds = heartBoundingY();

	const shadow = new pixi.Graphics();
	shadow.poly( heartPath( 1.05 ) );
	shadow.fill( { color: 0x000000, alpha: 0.55 } );
	shadow.y = 5;
	shadow.alpha = 0.55;
	wrap.addChild( shadow );

	const gradientCanvas = makeGradientCanvas();
	const gradientTexture: Texture = pixi.Texture.from( gradientCanvas );
	const gradientSprite = new pixi.Sprite( gradientTexture );
	const heartHeight = bounds.maxY - bounds.minY;
	const overscan = HEART_SIZE * 2.5;
	gradientSprite.width = overscan;
	gradientSprite.height = heartHeight;
	gradientSprite.x = -overscan / 2;
	gradientSprite.y = bounds.minY;

	gradientSprite.tint = HEART_COLOR_REST;

	const mask = new pixi.Graphics();
	mask.poly( heartPath( 1.0 ) );
	mask.fill( { color: 0xffffff, alpha: 1 } );

	gradientSprite.mask = mask;
	wrap.addChild( mask );
	wrap.addChild( gradientSprite );

	const hi1 = new pixi.Graphics();
	hi1.ellipse(
		-HEART_SIZE * 0.32,
		-HEART_SIZE * 0.50,
		HEART_SIZE * 0.18,
		HEART_SIZE * 0.10,
	);
	hi1.fill( { color: 0xffffff, alpha: 0.45 } );
	hi1.rotation = -0.5;
	wrap.addChild( hi1 );

	const hi2 = new pixi.Graphics();
	hi2.ellipse(
		HEART_SIZE * 0.20,
		-HEART_SIZE * 0.38,
		HEART_SIZE * 0.09,
		HEART_SIZE * 0.05,
	);
	hi2.fill( { color: 0xffffff, alpha: 0.22 } );
	hi2.rotation = 0.4;
	wrap.addChild( hi2 );

	const outline = new pixi.Graphics();
	outline.poly( heartPath( 1.0 ) );
	outline.stroke( { color: 0xffffff, alpha: 0.18, width: 1 } );
	wrap.addChild( outline );

	return { view: wrap, body: gradientSprite };
}

function heartBoundingY(): { minY: number; maxY: number } {
	const pts = heartPath( 1.0 );
	let minY = Infinity;
	let maxY = -Infinity;
	for ( let i = 1; i < pts.length; i += 2 ) {
		if ( pts[ i ] < minY ) {
			minY = pts[ i ];
		}
		if ( pts[ i ] > maxY ) {
			maxY = pts[ i ];
		}
	}
	return { minY, maxY };
}

function makeGradientCanvas(): HTMLCanvasElement {
	const c = document.createElement( 'canvas' );
	c.width = 2;
	c.height = 512;
	const ctx = c.getContext( '2d' );
	if ( ! ctx ) {
		return c;
	}
	const grad = ctx.createLinearGradient( 0, 0, 0, 512 );
	grad.addColorStop( 0.00, '#ffd6e3' );
	grad.addColorStop( 0.18, '#ff8ba3' );
	grad.addColorStop( 0.42, '#ff4d6d' );
	grad.addColorStop( 0.72, '#9a1f3d' );
	grad.addColorStop( 1.00, '#3d061a' );
	ctx.fillStyle = grad;
	ctx.fillRect( 0, 0, 2, 512 );
	return c;
}

function buildLogoSprite(
	pixi: typeof import( 'pixi.js' ),
	url: string,
): Container {
	const wrap = new pixi.Container();

	wrap.y = HEART_SIZE * 0.08;

	const shadow = new pixi.Sprite();
	shadow.anchor.set( 0.5 );
	shadow.tint = HEART_PALETTE.rim;
	shadow.alpha = 0.6;
	shadow.y = HEART_SIZE * 0.035;
	wrap.addChild( shadow );

	const mark = new pixi.Sprite();
	mark.anchor.set( 0.5 );
	wrap.addChild( mark );

	const targetWidth = HEART_SIZE * 0.92;

	const img = new Image();
	img.src = url;
	img
		.decode()
		.then( () => {
			const resolution = Math.min( window.devicePixelRatio || 1, 2 );

			const widthPx = Math.ceil( targetWidth * resolution * 1.7 );
			const canvas = rasterizeLogo( img, widthPx );
			const texture: Texture = pixi.Texture.from( canvas );
			const scale = targetWidth / canvas.width;
			shadow.texture = texture;
			shadow.scale.set( scale );
			mark.texture = texture;
			mark.scale.set( scale );
		} )
		.catch( () => {

		} );

	return wrap;
}

function rasterizeLogo(
	img: HTMLImageElement,
	widthPx: number,
): HTMLCanvasElement {
	let src: HTMLImageElement | HTMLCanvasElement = img;
	let w = img.naturalWidth;
	let h = img.naturalHeight;
	while ( w / 2 >= widthPx * 2 ) {
		w = Math.round( w / 2 );
		h = Math.round( h / 2 );
		const step = document.createElement( 'canvas' );
		step.width = w;
		step.height = h;
		const g = step.getContext( '2d' );
		if ( ! g ) {
			break;
		}
		g.imageSmoothingEnabled = true;
		g.imageSmoothingQuality = 'high';
		g.drawImage( src, 0, 0, w, h );
		src = step;
	}
	const out = document.createElement( 'canvas' );
	out.width = Math.max( 1, widthPx );
	out.height = Math.max(
		1,
		Math.round( ( widthPx * img.naturalHeight ) / Math.max( 1, img.naturalWidth ) ),
	);
	const g = out.getContext( '2d' );
	if ( g ) {
		g.imageSmoothingEnabled = true;
		g.imageSmoothingQuality = 'high';
		g.drawImage( src, 0, 0, out.width, out.height );
	}
	return out;
}

function wpHeartbeatInterval(): number {
	const wp = ( window as unknown as { wp?: WpGlobal } ).wp;
	try {
		const fn = wp?.heartbeat?.interval;
		if ( typeof fn === 'function' ) {
			const v = Number( fn() );
			if ( Number.isFinite( v ) && v > 0 ) {
				return v;
			}
		}
	} catch ( e ) {

	}
	return 15;
}

function lerpColor( a: number, b: number, t: number ): number {
	const ar = Math.trunc( a / 65536 ) % 256;
	const ag = Math.trunc( a / 256 ) % 256;
	const ab = a % 256;
	const br = Math.trunc( b / 65536 ) % 256;
	const bg = Math.trunc( b / 256 ) % 256;
	const bb = b % 256;
	const r = Math.round( ar + ( br - ar ) * t );
	const g = Math.round( ag + ( bg - ag ) * t );
	const bv = Math.round( ab + ( bb - ab ) * t );
	return r * 65536 + g * 256 + bv;
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

const w = window as unknown as {
	openStationWidgets?: Record<
		string,
		( container: HTMLElement, ctx: WidgetContext ) => WidgetTeardown | Promise< WidgetTeardown >
	>;
};
w.openStationWidgets = w.openStationWidgets || {};
w.openStationWidgets[ 'desktop-mode/heartbeat' ] = mount;
