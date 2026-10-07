import type { MioAppearance, MioLook, MioLookPhysics } from './types';

const APPEARANCE_KEYS: readonly ( keyof MioAppearance )[] = [
	'radius',
	'bodyColor',
	'bodyAlpha',
	'hueStart',
	'hueSpan',
	'hueDrift',
	'hueLoop',
	'hueAngle',
	'hueSpin',
	'saturation',
	'lightness',
	'iridescence',
	'outlineWidth',
	'linerWidth',
	'linerColor',
	'glow',
	'glowBlur',
	'eyeColor',
	'eyeScale',
];

export const LOOK_PHYSICS_KEYS: readonly ( keyof MioLookPhysics )[] = [
	'shapePreset',
	'shapeLobes',
	'shapeAmount',
	'shapeAngle',
	'shapeShuffle',
	'idleWobble',
	'idleWobbleSpeed',
];

export function emptyMioLook(): MioLook {
	return { appearance: {}, physics: {} };
}

function storable( value: unknown ): boolean {
	return (
		typeof value === 'boolean' ||
		typeof value === 'string' ||
		( typeof value === 'number' && Number.isFinite( value ) )
	);
}

function pick< T extends object >(
	raw: unknown,
	keys: readonly ( keyof T )[],
): Partial< T > {
	const out: Partial< T > = {};
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return out;
	}
	const source = raw as Record< string, unknown >;
	for ( const key of keys ) {
		const value = source[ key as string ];
		if ( value !== undefined && storable( value ) ) {
			Object.assign( out, { [ key ]: value } );
		}
	}
	return out;
}

export function sanitizeMioLook( raw: unknown ): MioLook {
	if ( ! raw || typeof raw !== 'object' || Array.isArray( raw ) ) {
		return emptyMioLook();
	}
	const source = raw as { appearance?: unknown; physics?: unknown };
	return {
		appearance: pick< MioAppearance >( source.appearance, APPEARANCE_KEYS ),
		physics: pick< MioLookPhysics >( source.physics, LOOK_PHYSICS_KEYS ),
	};
}

export function splitMioLook(
	partial: Partial< MioAppearance & MioLookPhysics >,
): MioLook {
	return {
		appearance: pick< MioAppearance >( partial, APPEARANCE_KEYS ),
		physics: pick< MioLookPhysics >( partial, LOOK_PHYSICS_KEYS ),
	};
}

export function isEmptyMioLook( look: MioLook ): boolean {
	return (
		Object.keys( look.appearance ).length === 0 &&
		Object.keys( look.physics ).length === 0
	);
}
