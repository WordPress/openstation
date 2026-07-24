/**
 * Snow wallpaper — minimal Pixi type surface.
 *
 * PixiJS is loaded as a vendor script (`window.PIXI`) via the
 * wallpaper def's `needs: ['pixijs']`, NOT imported. We declare the
 * narrow set of Pixi v8 types this bundle uses — the particle fast
 * path (`ParticleContainer` + `Particle`) rather than the display-
 * list `Sprite` tree the other canvas wallpapers use — mirroring
 * `src/plugins/living-tree-wallpaper/pixi-types.ts` so the two stay
 * type-compatible without a hard dependency on the `pixi.js` package.
 *
 * @since 0.9.5
 */

export interface PixiTexture {
	destroy( destroyBase?: boolean ): void;
}

/**
 * Pixi v8 `Particle` — the flat-property child type of
 * `ParticleContainer`. Unlike `Sprite` there is no `.position` /
 * `.scale` object; `x`, `y`, `scaleX`, `scaleY`, `alpha`, `rotation`
 * are plain fields the render pipeline reads per frame.
 */
export interface PixiParticle {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	alpha: number;
	rotation: number;
	tint: number;
}

export interface PixiParticleContainer {
	addParticle( particle: PixiParticle ): void;
}

export interface PixiTicker {
	deltaMS: number;
	add( cb: ( ticker: PixiTicker ) => void ): void;
	remove( cb: ( ticker: PixiTicker ) => void ): void;
	start(): void;
	stop(): void;
	update(): void;
}

export interface PixiApp {
	canvas: HTMLCanvasElement;
	stage: { addChild( child: unknown ): void };
	ticker: PixiTicker;
	init( opts: {
		resizeTo?: HTMLElement;
		backgroundAlpha?: number;
		antialias?: boolean;
		autoDensity?: boolean;
		resolution?: number;
	} ): Promise< void >;
	/**
	 * First arg is Pixi's `RendererDestroyOptions`. Pass an options
	 * object (e.g. `{ removeView: true }`), never a literal `true` —
	 * `true` triggers `releaseGlobalResources()`, which wipes Pixi's
	 * page-global texture/object pools out from under every OTHER live
	 * Application (active wallpaper vs. OS Settings preview).
	 */
	destroy(
		rendererOpts?: { removeView?: boolean },
		opts?: { children?: boolean; texture?: boolean; textureSource?: boolean },
	): void;
}

export interface PixiNamespace {
	Application: new () => PixiApp;
	/**
	 * `dynamicProperties` declares which per-particle attributes we
	 * mutate each frame so Pixi lays the GPU buffers out for per-frame
	 * updates vs. upload-once. NOTE: there is no `scale` key —
	 * `scaleX`/`scaleY` live in the *vertex* buffer, so `vertex: true`
	 * is what makes per-frame scale writes upload.
	 */
	ParticleContainer: new ( opts: {
		dynamicProperties: {
			position?: boolean;
			vertex?: boolean;
			rotation?: boolean;
			color?: boolean;
		};
	} ) => PixiParticleContainer;
	Particle: new ( opts: {
		texture: PixiTexture;
		anchorX?: number;
		anchorY?: number;
		alpha?: number;
		tint?: number;
	} ) => PixiParticle;
	Texture: { from( source: unknown ): PixiTexture };
}

/**
 * Read the vendor-loaded Pixi namespace off `window`. Returns `null`
 * if the module hasn't loaded — callers bail out gracefully rather
 * than dereferencing null.
 */
export function getPixi(): PixiNamespace | null {
	const pixi = ( window as unknown as { PIXI?: PixiNamespace } ).PIXI;
	return pixi ?? null;
}
