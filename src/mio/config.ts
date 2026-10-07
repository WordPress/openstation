import type {
	MioAppearance,
	MioConfig,
	MioPhysics,
	MioShapePreset,
	PartialMioConfig,
} from './types';

export const MIO_DEFAULTS: MioConfig = {
	appearance: {
		radius: 56,

		bodyColor: 0x0c0b0f,
		bodyAlpha: 1,

		hueStart: 296.5,
		hueSpan: -52.5,
		hueAngle: 225,

		hueDrift: 0,
		hueSpin: 0,
		hueLoop: true,

		saturation: 1,

		lightness: 0.75,

		iridescence: 0,

		outlineWidth: 4,

		linerWidth: 2,

		linerColor: 0xfffbff,

		glow: 10,
		glowBlur: true,

		eyeColor: 0xfffbff,
		eyeScale: 0.3,
	},
	physics: {

		points: 12,

		shapePreset: 'blob',

		shapeLobes: 3,
		shapeAmount: 1,
		shapeAngle: 0,

		shapeShuffle: 60,

		radialStiffness: 460,
		edgeStiffness: 540,
		bendStiffness: 170,
		pressure: 2400,

		damping: 9,
		airDamping: 0.5,
		magnetStrength: 2200,
		magnetRange: 260,
		magnetGrip: 0.24,
		magnetDamping: 7,
		floatAmplitude: 10,
		floatSpeed: 1.1,
		idleWobble: 0.085,
		idleWobbleSpeed: 0.55,
		speedStretch: 0.3,
		friction: 0.86,
		restitution: 0.2,
		dragStiffness: 480,
		throwBoost: 1,
		minStretch: 0.55,
		maxStretch: 1.7,
		minAngularGap: 0.25,
		limitIterations: 3,
		dragMaxAccel: 9000,
		subStep: 1 / 240,
		maxSubSteps: 8,
	},
};

const LIMITS = {
	radius: [ 16, 220 ],
	bodyAlpha: [ 0, 1 ],
	hueStart: [ -720, 720 ],
	hueSpan: [ -360, 360 ],
	hueDrift: [ -180, 180 ],
	hueAngle: [ -360, 360 ],
	hueSpin: [ -180, 180 ],
	saturation: [ 0, 1 ],
	lightness: [ 0.15, 1 ],
	iridescence: [ 0, 2 ],
	outlineWidth: [ 0.5, 24 ],

	linerWidth: [ 0, 12 ],

	glow: [ 0, 20 ],
	eyeScale: [ 0.05, 0.6 ],
	points: [ 12, 128 ],
	shapeLobes: [ 0, 8 ],
	shapeAmount: [ 0, 1.4 ],
	shapeAngle: [ -360, 360 ],
	shapeShuffle: [ 0, 3600 ],
	radialStiffness: [ 0, 2000 ],
	edgeStiffness: [ 0, 4000 ],
	bendStiffness: [ 0, 2000 ],
	pressure: [ 0, 8000 ],
	damping: [ 0, 30 ],
	airDamping: [ 0, 20 ],
	magnetStrength: [ 0, 8000 ],
	magnetRange: [ 0, 2000 ],
	magnetGrip: [ 0, 0.6 ],
	magnetDamping: [ 0, 40 ],
	floatAmplitude: [ 0, 200 ],
	floatSpeed: [ 0, 20 ],
	idleWobble: [ 0, 0.4 ],
	idleWobbleSpeed: [ 0, 8 ],
	speedStretch: [ 0, 0.8 ],
	friction: [ 0, 1 ],
	restitution: [ 0, 1 ],
	dragStiffness: [ 1, 4000 ],
	throwBoost: [ 0, 4 ],
	minStretch: [ 0.1, 1 ],
	maxStretch: [ 1, 4 ],
	minAngularGap: [ 0, 0.9 ],
	limitIterations: [ 0, 8 ],
	dragMaxAccel: [ 100, 200000 ],
	subStep: [ 1 / 1000, 1 / 30 ],
	maxSubSteps: [ 1, 32 ],
} as const satisfies Record< string, readonly [ number, number ] >;

function num(
	candidate: unknown,
	fallback: number,
	range: readonly [ number, number ],
): number {
	if ( typeof candidate !== 'number' || ! Number.isFinite( candidate ) ) {
		return fallback;
	}
	return Math.min( range[ 1 ], Math.max( range[ 0 ], candidate ) );
}

function color( candidate: unknown, fallback: number ): number {
	if ( typeof candidate === 'number' && Number.isFinite( candidate ) ) {
		return Math.min( 0xffffff, Math.max( 0, Math.floor( candidate ) ) );
	}
	if ( typeof candidate === 'string' ) {
		const hex = candidate.trim().replace( /^#/, '' );
		if ( /^[0-9a-fA-F]{6}$/.test( hex ) ) {
			return Number.parseInt( hex, 16 );
		}
		if ( /^[0-9a-fA-F]{3}$/.test( hex ) ) {
			const [ r, g, b ] = hex.split( '' );
			return Number.parseInt( `${ r }${ r }${ g }${ g }${ b }${ b }`, 16 );
		}
	}
	return fallback;
}

function bool( candidate: unknown, fallback: boolean ): boolean {
	return typeof candidate === 'boolean' ? candidate : fallback;
}

const SHAPE_PRESETS: readonly MioShapePreset[] = [
	'circle',
	'blob',
	'ghost',
	'potato',
	'star',
	'flower',
	'heart',
	'diamond',
	'drop',
	'cloud',
	'custom',
];

function preset(
	candidate: unknown,
	fallback: MioShapePreset,
): MioShapePreset {
	return SHAPE_PRESETS.includes( candidate as MioShapePreset )
		? ( candidate as MioShapePreset )
		: fallback;
}

export function sanitizeMioConfig(
	raw: unknown,
	base: MioConfig = MIO_DEFAULTS,
): MioConfig {
	const partial: PartialMioConfig =
		raw && typeof raw === 'object' && ! Array.isArray( raw )
			? ( raw as PartialMioConfig )
			: {};
	const a = partial.appearance ?? {};
	const p = partial.physics ?? {};

	const appearance: MioAppearance = {
		radius: num( a.radius, base.appearance.radius, LIMITS.radius ),
		bodyColor: color( a.bodyColor, base.appearance.bodyColor ),
		bodyAlpha: num( a.bodyAlpha, base.appearance.bodyAlpha, LIMITS.bodyAlpha ),
		hueStart: num( a.hueStart, base.appearance.hueStart, LIMITS.hueStart ),
		hueSpan: num( a.hueSpan, base.appearance.hueSpan, LIMITS.hueSpan ),
		hueDrift: num( a.hueDrift, base.appearance.hueDrift, LIMITS.hueDrift ),
		hueLoop: bool( a.hueLoop, base.appearance.hueLoop ),
		hueAngle: num( a.hueAngle, base.appearance.hueAngle, LIMITS.hueAngle ),
		hueSpin: num( a.hueSpin, base.appearance.hueSpin, LIMITS.hueSpin ),
		saturation: num(
			a.saturation,
			base.appearance.saturation,
			LIMITS.saturation,
		),
		lightness: num( a.lightness, base.appearance.lightness, LIMITS.lightness ),
		iridescence: num(
			a.iridescence,
			base.appearance.iridescence,
			LIMITS.iridescence,
		),
		outlineWidth: num(
			a.outlineWidth,
			base.appearance.outlineWidth,
			LIMITS.outlineWidth,
		),
		linerWidth: num(
			a.linerWidth,
			base.appearance.linerWidth,
			LIMITS.linerWidth,
		),
		linerColor: color( a.linerColor, base.appearance.linerColor ),
		glow: num( a.glow, base.appearance.glow, LIMITS.glow ),
		glowBlur: bool( a.glowBlur, base.appearance.glowBlur ),
		eyeColor: color( a.eyeColor, base.appearance.eyeColor ),
		eyeScale: num( a.eyeScale, base.appearance.eyeScale, LIMITS.eyeScale ),
	};

	const physics: MioPhysics = {

		points: Math.round( num( p.points, base.physics.points, LIMITS.points ) ),
		shapePreset: preset( p.shapePreset, base.physics.shapePreset ),

		shapeLobes: Math.round(
			num( p.shapeLobes, base.physics.shapeLobes, LIMITS.shapeLobes ),
		),
		shapeAmount: num(
			p.shapeAmount,
			base.physics.shapeAmount,
			LIMITS.shapeAmount,
		),
		shapeAngle: num( p.shapeAngle, base.physics.shapeAngle, LIMITS.shapeAngle ),
		shapeShuffle: num(
			p.shapeShuffle,
			base.physics.shapeShuffle,
			LIMITS.shapeShuffle,
		),
		radialStiffness: num(
			p.radialStiffness,
			base.physics.radialStiffness,
			LIMITS.radialStiffness,
		),
		edgeStiffness: num(
			p.edgeStiffness,
			base.physics.edgeStiffness,
			LIMITS.edgeStiffness,
		),
		bendStiffness: num(
			p.bendStiffness,
			base.physics.bendStiffness,
			LIMITS.bendStiffness,
		),
		pressure: num( p.pressure, base.physics.pressure, LIMITS.pressure ),
		damping: num( p.damping, base.physics.damping, LIMITS.damping ),
		airDamping: num(
			p.airDamping,
			base.physics.airDamping,
			LIMITS.airDamping,
		),
		magnetStrength: num(
			p.magnetStrength,
			base.physics.magnetStrength,
			LIMITS.magnetStrength,
		),
		magnetRange: num(
			p.magnetRange,
			base.physics.magnetRange,
			LIMITS.magnetRange,
		),
		magnetGrip: num( p.magnetGrip, base.physics.magnetGrip, LIMITS.magnetGrip ),
		magnetDamping: num(
			p.magnetDamping,
			base.physics.magnetDamping,
			LIMITS.magnetDamping,
		),
		floatAmplitude: num(
			p.floatAmplitude,
			base.physics.floatAmplitude,
			LIMITS.floatAmplitude,
		),
		floatSpeed: num( p.floatSpeed, base.physics.floatSpeed, LIMITS.floatSpeed ),
		idleWobble: num( p.idleWobble, base.physics.idleWobble, LIMITS.idleWobble ),
		idleWobbleSpeed: num(
			p.idleWobbleSpeed,
			base.physics.idleWobbleSpeed,
			LIMITS.idleWobbleSpeed,
		),
		speedStretch: num(
			p.speedStretch,
			base.physics.speedStretch,
			LIMITS.speedStretch,
		),
		friction: num( p.friction, base.physics.friction, LIMITS.friction ),
		restitution: num(
			p.restitution,
			base.physics.restitution,
			LIMITS.restitution,
		),
		dragStiffness: num(
			p.dragStiffness,
			base.physics.dragStiffness,
			LIMITS.dragStiffness,
		),
		throwBoost: num( p.throwBoost, base.physics.throwBoost, LIMITS.throwBoost ),

		minStretch: num( p.minStretch, base.physics.minStretch, LIMITS.minStretch ),
		maxStretch: num( p.maxStretch, base.physics.maxStretch, LIMITS.maxStretch ),
		minAngularGap: num(
			p.minAngularGap,
			base.physics.minAngularGap,
			LIMITS.minAngularGap,
		),
		dragMaxAccel: num(
			p.dragMaxAccel,
			base.physics.dragMaxAccel,
			LIMITS.dragMaxAccel,
		),
		limitIterations: Math.round(
			num(
				p.limitIterations,
				base.physics.limitIterations,
				LIMITS.limitIterations,
			),
		),
		subStep: num( p.subStep, base.physics.subStep, LIMITS.subStep ),
		maxSubSteps: Math.round(
			num( p.maxSubSteps, base.physics.maxSubSteps, LIMITS.maxSubSteps ),
		),
	};

	return { appearance, physics };
}
