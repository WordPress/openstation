export interface PixiTexture {
	destroy( destroyBase?: boolean ): void;
}

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

	destroy(
		rendererOpts?: { removeView?: boolean },
		opts?: { children?: boolean; texture?: boolean; textureSource?: boolean },
	): void;
}

export interface PixiNamespace {
	Application: new () => PixiApp;

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

export function getPixi(): PixiNamespace | null {
	const pixi = ( window as unknown as { PIXI?: PixiNamespace } ).PIXI;
	return pixi ?? null;
}
