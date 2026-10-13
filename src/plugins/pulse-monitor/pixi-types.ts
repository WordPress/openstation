/**
 * Pulse Monitor — minimal Pixi type surface.
 *
 * PixiJS is loaded as a vendor script (`window.PIXI`) via the
 * wallpaper def's `needs: ['pixijs']`, NOT imported. We declare the
 * narrow set of Pixi v8 types this bundle uses — `Graphics` paths for
 * the trace and an optional `BlurFilter` for the phosphor glow —
 * mirroring the other canvas wallpapers' `pixi-types.ts`.
 */

export interface PixiStrokeStyle {
	color: number;
	width: number;
	alpha?: number;
	cap?: 'butt' | 'round' | 'square';
	join?: 'bevel' | 'miter' | 'round';
}

export interface PixiContainer {
	alpha: number;
	visible: boolean;
	filters: unknown[] | null;
	addChild( ...children: unknown[] ): void;
	destroy( opts?: unknown ): void;
}

export interface PixiGraphics extends PixiContainer {
	clear(): PixiGraphics;
	moveTo( x: number, y: number ): PixiGraphics;
	lineTo( x: number, y: number ): PixiGraphics;
	circle( x: number, y: number, r: number ): PixiGraphics;
	stroke( style: PixiStrokeStyle ): PixiGraphics;
	fill( style: { color: number; alpha?: number } ): PixiGraphics;
}

export interface PixiTicker {
	deltaMS: number;
	add( cb: ( ticker: PixiTicker ) => void ): void;
	remove( cb: ( ticker: PixiTicker ) => void ): void;
	start(): void;
	stop(): void;
}

export interface PixiApp {
	canvas: HTMLCanvasElement;
	stage: PixiContainer;
	screen: { width: number; height: number };
	ticker: PixiTicker;
	init( opts: {
		resizeTo?: HTMLElement;
		backgroundAlpha?: number;
		antialias?: boolean;
		autoDensity?: boolean;
		resolution?: number;
	} ): Promise< void >;
	render(): void;
	/**
	 * Pass an options object, never a literal `true` — `true` releases
	 * Pixi's page-global pools out from under every other live
	 * Application (the active wallpaper vs. an OS Settings preview).
	 */
	destroy(
		rendererOpts?: { removeView?: boolean },
		opts?: { children?: boolean; texture?: boolean; textureSource?: boolean },
	): void;
}

export interface PixiNamespace {
	Application: new () => PixiApp;
	Container: new () => PixiContainer;
	Graphics: new () => PixiGraphics;
	BlurFilter?: new ( opts?: { strength?: number; quality?: number } ) => unknown;
}

/** Read the vendor-loaded Pixi namespace off `window`, or null. */
export function getPixi(): PixiNamespace | null {
	const pixi = ( window as unknown as { PIXI?: PixiNamespace } ).PIXI;
	return pixi ?? null;
}
