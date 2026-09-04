/**
 * Posts app — the PixiJS surface the term canvases draw on.
 *
 * The narrow structural types the Categories mind map and the Tags
 * cloud use (PixiJS is loaded through the shell's module registry, so
 * there is no package to import types from), the loader, the
 * application bootstrap, and the colour / text helpers both canvases
 * share.
 *
 * @public
 */

import { __ } from '@openstation/app';

export interface PixiPoint {
	x: number;
	y: number;
}
export interface PixiContainer {
	x: number;
	y: number;
	alpha: number;
	rotation: number;
	scale: { x: number; y: number; set( s: number ): void };
	addChild( ...children: unknown[] ): void;
	removeChild( child: unknown ): void;
	destroy( opts?: unknown ): void;
	visible: boolean;
	eventMode: string;
	cursor: string;
	on( event: string, cb: ( e: unknown ) => void ): void;
	hitArea: unknown;
	zIndex: number;
}
export interface PixiGraphics extends PixiContainer {
	clear(): PixiGraphics;
	circle( x: number, y: number, r: number ): PixiGraphics;
	roundRect( x: number, y: number, w: number, h: number, r: number ): PixiGraphics;
	moveTo( x: number, y: number ): PixiGraphics;
	bezierCurveTo( cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number ): PixiGraphics;
	lineTo( x: number, y: number ): PixiGraphics;
	stroke( style: { color: number; width: number; alpha?: number; alignment?: number } ): PixiGraphics;
	fill( style: { color: number; alpha?: number } | number ): PixiGraphics;
}
export interface PixiApp {
	canvas: HTMLCanvasElement;
	stage: PixiContainer;
	renderer: {
		resize( w: number, h: number ): void;
		width: number;
		height: number;
		render( container?: unknown ): void;
	};
	ticker?: { stop(): void };
	init( opts: unknown ): Promise< void >;
	render(): void;
	/**
	 * First arg is Pixi's `RendererDestroyOptions`. Pass an options
	 * object, never a literal `true` — `true` triggers
	 * `releaseGlobalResources()` and corrupts every other live
	 * Application on the page (the Content Graph's batcher crash-looped).
	 */
	destroy( rendererOpts?: { removeView?: boolean }, opts?: unknown ): void;
}
export interface PixiText extends PixiContainer {
	text: string;
	width: number;
	height: number;
	anchor: { set( v: number ): void; x?: number; y?: number };
	style: { fill: number; fontSize?: number; fontFamily?: string; fontWeight?: string };
	resolution: number;
}
export interface PixiTextOpts {
	text: string;
	style: { fill: number; fontSize?: number; fontFamily?: string; fontWeight?: string; align?: string };
	resolution?: number;
	anchor?: { x: number; y: number };
}
export interface PixiNamespace {
	Application: new () => PixiApp;
	Container: new () => PixiContainer;
	Graphics: new () => PixiGraphics;
	Text: new ( opts: PixiTextOpts ) => PixiText;
	Rectangle: new ( x: number, y: number, w: number, h: number ) => unknown;
	Circle: new ( x: number, y: number, r: number ) => unknown;
}

/** A Pixi pointer event, as far as the canvases read it. */
export interface PixiPointerEvent {
	global: PixiPoint;
	stopPropagation?: () => void;
}

export const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/**
 * Chip text rasterisation resolution: every glyph at 4× detail, crisp
 * through the world's full zoom range and on HiDPI displays.
 */
export const CHIP_TEXT_RES = 4;

/** Cut a label to `max` characters with an ellipsis. */
export function truncate( text: string, max: number ): string {
	return text.length > max ? text.slice( 0, max - 1 ) + '…' : text;
}

/**
 * Load PixiJS through the shell's module registry. On failure the
 * host says so and `null` comes back — the canvas simply does not
 * mount.
 */
export async function loadPixi( host: HTMLElement, unavailable: string ): Promise< PixiNamespace | null > {
	const api = window.wp?.os;
	if ( ! api || typeof api.loadModules !== 'function' ) {
		host.textContent = `${ unavailable } ${ __( 'Shell modules API missing.' ) }`;
		return null;
	}
	try {
		await api.loadModules( [ 'pixijs' ] );
	} catch {
		host.textContent = unavailable;
		return null;
	}
	const pixi = ( window as unknown as { PIXI?: PixiNamespace } ).PIXI;
	if ( ! pixi ) {
		host.textContent = unavailable;
	}
	return pixi ?? null;
}

/** A transparent, antialiased Application sized to the stage, with the world container. */
export async function createPixiApp(
	pixi: PixiNamespace,
	stage: HTMLElement,
	canvasClass: string,
): Promise< { app: PixiApp; world: PixiContainer } > {
	const app = new pixi.Application();
	await app.init( {
		resizeTo: stage,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min( window.devicePixelRatio || 1, 2 ),
	} );
	stage.appendChild( app.canvas );
	app.canvas.classList.add( canvasClass );
	const world = new pixi.Container();
	world.x = stage.clientWidth / 2;
	world.y = stage.clientHeight / 2;
	app.stage.addChild( world );
	app.stage.eventMode = 'static';
	app.stage.hitArea = new pixi.Rectangle( 0, 0, stage.clientWidth, stage.clientHeight );
	return { app, world };
}

/**
 * Destroy an Application without touching Pixi's page-global pools
 * (see the note on `PixiApp.destroy`), and empty the host.
 */
export function destroyPixiApp( app: PixiApp, host: HTMLElement, hostClasses: string[] ): void {
	try {
		app.ticker?.stop();
	} catch {
		// Best-effort.
	}
	try {
		app.destroy( { removeView: true }, { children: true } );
	} catch {
		// Best-effort — Pixi sometimes throws on teardown races.
	}
	host.replaceChildren();
	host.classList.remove( ...hostClasses );
}

export function readAdminThemeHue(): number {
	try {
		const value = getComputedStyle( document.documentElement ).getPropertyValue( '--wp-admin-theme-color' ).trim();
		if ( ! value ) {
			return 210;
		}
		const c = document.createElement( 'span' );
		c.style.color = value;
		document.body.appendChild( c );
		const rgb = getComputedStyle( c ).color;
		c.remove();
		const m = rgb.match( /\d+/g );
		if ( ! m || m.length < 3 ) {
			return 210;
		}
		return rgbToHue( parseInt( m[ 0 ], 10 ), parseInt( m[ 1 ], 10 ), parseInt( m[ 2 ], 10 ) );
	} catch {
		return 210;
	}
}

function rgbToHue( r: number, g: number, b: number ): number {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max( rn, gn, bn );
	const min = Math.min( rn, gn, bn );
	const d = max - min;
	if ( d === 0 ) {
		return 210;
	}
	let h: number;
	switch ( max ) {
		case rn:
			h = ( gn - bn ) / d + ( gn < bn ? 6 : 0 );
			break;
		case gn:
			h = ( bn - rn ) / d + 2;
			break;
		default:
			h = ( rn - gn ) / d + 4;
			break;
	}
	return Math.round( h * 60 );
}

export function hslToInt( h: number, s: number, l: number ): number {
	const sn = s / 100;
	const ln = l / 100;
	const c = ( 1 - Math.abs( 2 * ln - 1 ) ) * sn;
	const hp = h / 60;
	const x = c * ( 1 - Math.abs( ( hp % 2 ) - 1 ) );
	let r = 0;
	let g = 0;
	let b = 0;
	if ( hp < 1 ) {
		r = c;
		g = x;
	} else if ( hp < 2 ) {
		r = x;
		g = c;
	} else if ( hp < 3 ) {
		g = c;
		b = x;
	} else if ( hp < 4 ) {
		g = x;
		b = c;
	} else if ( hp < 5 ) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}
	const m = ln - c / 2;
	return Math.round( ( r + m ) * 255 ) * 0x10000 + Math.round( ( g + m ) * 255 ) * 0x100 + Math.round( ( b + m ) * 255 );
}

/**
 * Lighten or darken a 0xRRGGBB colour. `delta` in (-1, +1): negative
 * darkens, positive lightens. No bitwise ops — the lint rule bans
 * them, so channel extraction goes through Math.floor + modulo.
 */
export function shadeColor( color: number, delta: number ): number {
	const r = Math.floor( color / 0x10000 ) % 256;
	const g = Math.floor( color / 0x100 ) % 256;
	const b = color % 256;
	const adj = ( ch: number ): number =>
		delta >= 0 ? Math.round( ch + ( 255 - ch ) * delta ) : Math.round( ch * ( 1 + delta ) );
	return adj( r ) * 0x10000 + adj( g ) * 0x100 + adj( b );
}

/** `#rrggbb` for a 0xRRGGBB colour. */
export function hexOf( color: number ): string {
	return `#${ color.toString( 16 ).padStart( 6, '0' ) }`;
}

/** The text of an HTML fragment (a rendered post title). */
export function stripTags( html: string ): string {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;
	return tmp.textContent || tmp.innerText || '';
}
