export interface MioAppearance {

	radius: number;

	bodyColor: number;

	bodyAlpha: number;

	hueStart: number;

	hueSpan: number;

	hueDrift: number;

	hueLoop: boolean;

	hueAngle: number;

	hueSpin: number;

	saturation: number;

	lightness: number;

	iridescence: number;

	outlineWidth: number;

	linerWidth: number;

	linerColor: number;

	glow: number;

	glowBlur: boolean;

	eyeColor: number;

	eyeScale: number;
}

export type MioShapePreset =
	| 'circle'
	| 'blob'
	| 'ghost'
	| 'potato'
	| 'star'
	| 'flower'
	| 'heart'
	| 'diamond'
	| 'drop'
	| 'cloud'
	| 'custom';

export type MioLookPhysics = Pick<
	MioPhysics,
	| 'shapePreset'
	| 'shapeLobes'
	| 'shapeAmount'
	| 'shapeAngle'
	| 'shapeShuffle'
	| 'idleWobble'
	| 'idleWobbleSpeed'
>;

export interface MioLook {

	appearance: Partial< MioAppearance >;

	physics: Partial< MioLookPhysics >;
}

export interface MioPhysics {

	points: number;

	shapePreset: MioShapePreset;

	shapeLobes: number;

	shapeAmount: number;

	shapeAngle: number;

	shapeShuffle: number;

	radialStiffness: number;

	edgeStiffness: number;

	bendStiffness: number;

	pressure: number;

	damping: number;

	airDamping: number;

	magnetStrength: number;

	magnetRange: number;

	magnetGrip: number;

	magnetDamping: number;

	floatAmplitude: number;

	floatSpeed: number;

	idleWobble: number;

	idleWobbleSpeed: number;

	speedStretch: number;

	friction: number;

	restitution: number;

	dragStiffness: number;

	throwBoost: number;

	minStretch: number;

	maxStretch: number;

	minAngularGap: number;

	limitIterations: number;

	dragMaxAccel: number;

	subStep: number;

	maxSubSteps: number;
}

export interface MioConfig {
	appearance: MioAppearance;
	physics: MioPhysics;
}

export type PartialMioConfig = {
	appearance?: Partial< MioAppearance >;
	physics?: Partial< MioPhysics >;
};

export interface MioMountOptions {

	host: HTMLElement;

	config: MioConfig;

	position: { x: number; y: number } | null;

	savePosition: ( pos: { x: number; y: number } ) => void;
}

export interface MioHandle {

	getPosition: () => { x: number; y: number };

	setPosition: ( x: number, y: number ) => void;

	setAnchor?: ( position: { x: number; y: number } | null, persistent?: boolean ) => void;

	setFloating?: ( floating: boolean ) => void;

	setAnimating: ( animating: boolean ) => void;

	applyConfig: ( config: MioConfig ) => void;

	destroy: () => void;
}

export type MioMountFn = (
	options: MioMountOptions,
) => Promise< MioHandle | null >;

declare global {
	interface Window {

		openStationMountMio?: MioMountFn;
	}
}
