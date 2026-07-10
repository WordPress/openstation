/**
 * The Living Tree — minimal Pixi type surface.
 *
 * PixiJS is loaded as a vendor script (`window.PIXI`) via the wallpaper
 * def's `needs: ['pixijs']`, NOT imported. We declare the narrow set of
 * Pixi types this bundle uses, mirroring `src/content-graph/pixi-types.ts`
 * so the two stay type-compatible without a hard dependency on the
 * `pixi.js` package.
 *
 * @since 0.9.4
 */

export interface PixiContainer {
	x: number;
	y: number;
	alpha: number;
	rotation: number;
	scale: { x: number; y: number; set( s: number ): void };
	addChild( ...children: unknown[] ): void;
	removeChild( child: unknown ): void;
	removeChildren(): void;
	destroy( opts?: unknown ): void;
	visible: boolean;
	zIndex: number;
	/**
	 * Pixi v8 render-group caching: bake this subtree into a texture so
	 * static, geometry-heavy content (the turf, the settled skeleton)
	 * costs one quad per frame instead of thousands of vertices.
	 * Optional in the type so a stale vendor bundle degrades gracefully.
	 */
	cacheAsTexture?: ( enabled: boolean ) => void;
}

export interface PixiStrokeStyle {
	color: number;
	width: number;
	alpha?: number;
	alignment?: number;
	cap?: 'butt' | 'round' | 'square';
	join?: 'bevel' | 'miter' | 'round';
}

export interface PixiGraphics extends PixiContainer {
	clear(): PixiGraphics;
	circle( x: number, y: number, r: number ): PixiGraphics;
	ellipse( x: number, y: number, rx: number, ry: number ): PixiGraphics;
	moveTo( x: number, y: number ): PixiGraphics;
	lineTo( x: number, y: number ): PixiGraphics;
	bezierCurveTo(
		cp1x: number,
		cp1y: number,
		cp2x: number,
		cp2y: number,
		x: number,
		y: number,
	): PixiGraphics;
	poly( points: number[], close?: boolean ): PixiGraphics;
	stroke( style: PixiStrokeStyle ): PixiGraphics;
	fill( style: { color: number; alpha?: number } | number ): PixiGraphics;
}

export interface PixiTexture {
	destroy( destroyBase?: boolean ): void;
}

export interface PixiSprite extends PixiContainer {
	tint: number;
	blendMode: string;
	texture: PixiTexture;
	anchor: { set( v: number ): void };
}

export interface PixiTicker {
	add( cb: ( ticker: { deltaTime: number } ) => void ): void;
	remove( cb: ( ticker: { deltaTime: number } ) => void ): void;
	start(): void;
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
	destroy( clearStage?: boolean, opts?: unknown ): void;
}

export interface PixiNamespace {
	Application: new () => PixiApp;
	Container: new () => PixiContainer;
	Graphics: new () => PixiGraphics;
	Sprite: new ( texture: PixiTexture ) => PixiSprite;
	Texture: { from( source: unknown ): PixiTexture };
}

/**
 * Read the vendor-loaded Pixi namespace off `window`. Returns `null` if
 * the module hasn't loaded — callers throw a descriptive error rather
 * than dereferencing null.
 */
export function getPixi(): PixiNamespace | null {
	const pixi = ( window as unknown as { PIXI?: PixiNamespace } ).PIXI;
	return pixi ?? null;
}
