import { MIO_DEFAULTS } from '../../../src/mio/config';
import { mioPortraitDataUri } from '../../../src/mio/portrait';
import { mulberry32, randomMioLook } from '../../../src/mio/randomize';
import type { MioLook } from '../../../src/agents-types';

export const FACE_CANDIDATES = 12;

export function faceFromSeed( seed: number ): MioLook {
	const look = randomMioLook( mulberry32( seed ) );
	return {
		appearance: look.appearance as Record< string, unknown >,
		physics: look.physics as Record< string, unknown >,
	};
}

export function faceCandidates(
	seed: number,
	count: number = FACE_CANDIDATES,
): { seed: number; look: MioLook }[] {
	return Array.from( { length: count }, ( _, i ) => ( {
		seed: seed + i,
		look: faceFromSeed( seed + i ),
	} ) );
}

export function faceSrc( look: MioLook | null, size: number ): string {
	return mioPortraitDataUri( ( look ?? {} ) as never, size );
}

export function hasFace( look: MioLook | null | undefined ): boolean {
	if ( ! look ) {
		return false;
	}
	return (
		Object.keys( look.appearance ?? {} ).length > 0 ||
		Object.keys( look.physics ?? {} ).length > 0
	);
}

export function faceShapeName( look: MioLook | null ): string {
	const preset = look?.physics?.shapePreset;
	return typeof preset === 'string' && preset !== ''
		? preset
		: MIO_DEFAULTS.physics.shapePreset;
}

const HUE_NAMES = [
	'rose',
	'amber',
	'gold',
	'lime',
	'green',
	'mint',
	'teal',
	'azure',
	'blue',
	'violet',
	'purple',
	'magenta',
];

export function faceHueName( look: MioLook | null ): string {
	const raw = look?.appearance?.hueStart;
	const start =
		typeof raw === 'number' && Number.isFinite( raw )
			? raw
			: MIO_DEFAULTS.appearance.hueStart;
	const hue = ( ( start % 360 ) + 360 ) % 360;
	return HUE_NAMES[ Math.floor( ( ( hue + 15 ) % 360 ) / 30 ) ];
}
