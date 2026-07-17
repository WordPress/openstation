/**
 * Inkfall — minimal Pixi type surface.
 *
 * PixiJS is loaded as a vendor script (`window.PIXI`) via
 * `wp.desktop.loadModules(['pixijs'])`, NOT imported. We declare the
 * narrow set of Pixi types this bundle uses, mirroring
 * `src/content-graph/pixi-types.ts`.
 *
 * Destroy contract (repo-wide footgun): always
 * `app.destroy( { removeView: true }, { children: true, texture: true } )`
 * — never `destroy( true )`, which runs `releaseGlobalResources()`
 * and corrupts every other live Pixi Application on the page (the
 * active wallpaper, content graph, OS Settings previews).
 *
 * @since 0.9.6
 */

export interface PixiContainer {
	x: number;
	y: number;
	alpha: number;
	rotation: number;
	visible: boolean;
	zIndex: number;
	scale: { x: number; y: number; set( s: number ): void };
	addChild( ...children: unknown[] ): void;
	removeChild( child: unknown ): void;
	removeChildren(): void;
	destroy( opts?: unknown ): void;
}

export interface PixiGraphics extends PixiContainer {
	clear(): PixiGraphics;
	circle( x: number, y: number, r: number ): PixiGraphics;
	ellipse( x: number, y: number, hw: number, hh: number ): PixiGraphics;
	rect( x: number, y: number, w: number, h: number ): PixiGraphics;
	moveTo( x: number, y: number ): PixiGraphics;
	lineTo( x: number, y: number ): PixiGraphics;
	stroke( style: {
		color: number;
		width: number;
		alpha?: number;
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
	};
	resolution?: number;
}

export interface PixiText extends PixiContainer {
	text: string;
	width: number;
	height: number;
	anchor: { set( v: number ): void };
	style: { fill: number };
}

export interface PixiTicker {
	deltaMS: number;
	add( cb: () => void ): void;
	remove( cb: () => void ): void;
	start(): void;
	stop(): void;
}

export interface PixiApp {
	canvas: HTMLCanvasElement;
	stage: PixiContainer & { sortableChildren?: boolean };
	ticker: PixiTicker;
	renderer: {
		width: number;
		height: number;
		render( container?: unknown ): void;
	};
	init( opts: unknown ): Promise< void >;
	/**
	 * Re-measure the `resizeTo` target and resize the renderer NOW.
	 * Pixi's ResizePlugin only listens to `window` resize events, so
	 * resizing the desktop-mode window (which never fires them) needs
	 * an explicit call from our own ResizeObserver.
	 */
	resize(): void;
	destroy( rendererOpts?: { removeView?: boolean }, opts?: unknown ): void;
}

export interface PixiNamespace {
	Application: new () => PixiApp;
	Container: new () => PixiContainer;
	Graphics: new () => PixiGraphics;
	Text: new ( opts: PixiTextOpts ) => PixiText;
}

export function getPixi(): PixiNamespace | null {
	const pixi = ( window as unknown as { PIXI?: PixiNamespace } ).PIXI;
	return pixi ?? null;
}
