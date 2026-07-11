/**
 * Content Graph — minimal Pixi type surface.
 *
 * PixiJS is loaded as a vendor script (`window.PIXI`) via
 * `wp.desktop.loadModules(['pixijs'])`, NOT imported. We declare the
 * narrow set of Pixi types this bundle uses, mirroring the shape used
 * by `posts-window/categories-mindmap.ts` so the two stay
 * type-compatible without a hard dependency on the `pixi.js` package.
 *
 * @public
 * @since 0.8.2
 */

export interface PixiPoint {
	x: number;
	y: number;
}

export interface PixiContainer {
	x: number;
	y: number;
	alpha: number;
	scale: { x: number; y: number; set( s: number ): void };
	addChild( ...children: unknown[] ): void;
	removeChild( child: unknown ): void;
	removeChildren(): void;
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
	roundRect(
		x: number,
		y: number,
		w: number,
		h: number,
		r: number,
	): PixiGraphics;
	moveTo( x: number, y: number ): PixiGraphics;
	bezierCurveTo(
		cp1x: number,
		cp1y: number,
		cp2x: number,
		cp2y: number,
		x: number,
		y: number,
	): PixiGraphics;
	lineTo( x: number, y: number ): PixiGraphics;
	stroke( style: {
		color: number;
		width: number;
		alpha?: number;
		alignment?: number;
	} ): PixiGraphics;
	fill( style: { color: number; alpha?: number } | number ): PixiGraphics;
}

export interface PixiTextOpts {
	text: string;
	style: {
		fill: number;
		fontSize?: number;
		fontFamily?: string;
		fontWeight?: string;
		align?: string;
	};
	resolution?: number;
	anchor?: { x: number; y: number };
}

export interface PixiText extends PixiContainer {
	text: string;
	width: number;
	height: number;
	anchor: { set( v: number ): void; x?: number; y?: number };
	style: { fill: number; fontSize?: number; fontFamily?: string; fontWeight?: string };
	resolution: number;
}

export interface PixiTicker {
	add( cb: ( ticker: { deltaTime: number } ) => void ): void;
	remove( cb: ( ticker: { deltaTime: number } ) => void ): void;
	// Pixi's auto-render also lives on the ticker; calling `stop()`
	// at teardown silences it before we destroy graphics children,
	// which otherwise can crash mid-frame in the batched renderer.
	stop(): void;
}

export interface PixiApp {
	canvas: HTMLCanvasElement;
	stage: PixiContainer;
	ticker: PixiTicker;
	renderer: {
		resize( w: number, h: number ): void;
		width: number;
		height: number;
		render( container?: unknown ): void;
	};
	init( opts: unknown ): Promise< void >;
	render(): void;
	/**
	 * First arg is Pixi's `RendererDestroyOptions`. Pass an options
	 * object, never a literal `true` — `true` triggers
	 * `releaseGlobalResources()` and corrupts every other live
	 * Application on the page.
	 */
	destroy( rendererOpts?: { removeView?: boolean }, opts?: unknown ): void;
}

export interface PixiNamespace {
	Application: new () => PixiApp;
	Container: new () => PixiContainer;
	Graphics: new () => PixiGraphics;
	Text: new ( opts: PixiTextOpts ) => PixiText;
	Rectangle: new ( x: number, y: number, w: number, h: number ) => unknown;
	Circle: new ( x: number, y: number, r: number ) => unknown;
}

export interface DesktopApiLike {
	loadModules?: ( ids: string[] ) => Promise< void >;
}

export function getPixi(): PixiNamespace | null {
	const pixi = ( window as unknown as { PIXI?: PixiNamespace } ).PIXI;
	return pixi ?? null;
}
