import { MIO_DEFAULTS } from './config';
import type { MioLook, MioShapePreset } from './types';

const RANDOM_SHAPES: readonly MioShapePreset[] = [
	'blob',
	'ghost',
	'potato',
	'star',
	'flower',
	'heart',
	'diamond',
	'drop',
	'cloud',
];

export function randomMioLook( random: () => number = Math.random ): MioLook {
	const between = ( lo: number, hi: number ): number => lo + random() * ( hi - lo );
	const chance = ( p: number ): boolean => random() < p;
	const pick = < T >( list: readonly T[] ): T =>
		list[ Math.floor( random() * list.length ) % list.length ];
	const round = ( value: number, step: number ): number =>
		Math.round( value / step ) * step;

	const span = round( between( 55, 215 ), 1 ) * ( chance( 0.5 ) ? 1 : -1 );
	const outlineWidth = round( between( 2, 7 ), 0.5 );

	return {
		appearance: {
			hueStart: round( between( 0, 360 ), 1 ),
			hueSpan: span,
			hueAngle: round( between( 0, 360 ), 1 ),

			hueLoop: true,

			hueSpin: chance( 0.25 ) ? round( between( -14, 14 ), 1 ) : 0,
			hueDrift: chance( 0.15 ) ? round( between( -8, 8 ), 1 ) : 0,
			saturation: round( between( 0.68, 1 ), 0.01 ),
			lightness: round( between( 0.52, 0.78 ), 0.01 ),
			outlineWidth,

			linerWidth: Math.max( 1, round( outlineWidth / 2, 0.5 ) ),

			linerColor: MIO_DEFAULTS.appearance.linerColor,

			glow: round( between( 4, 16 ), 0.1 ),

			iridescence: chance( 0.34 ) ? round( between( 0.45, 1.25 ), 0.05 ) : 0,

			bodyColor: chance( 0.25 )
				? randomInk( random )
				: MIO_DEFAULTS.appearance.bodyColor,
			bodyAlpha: chance( 0.2 ) ? round( between( 0.78, 1 ), 0.01 ) : 1,

			eyeColor: MIO_DEFAULTS.appearance.eyeColor,
			eyeScale: round( between( 0.2, 0.42 ), 0.01 ),
		},
		physics: {
			shapePreset: pick( RANDOM_SHAPES ),
			shapeAmount: round( between( 0.7, 1.15 ), 0.05 ),

			shapeAngle: 0,

			idleWobble: round( between( 0.03, 0.16 ), 0.005 ),
			idleWobbleSpeed: round( between( 0.35, 1.1 ), 0.05 ),
		},
	};
}

function randomInk( random: () => number ): number {
	const channel = (): number => Math.floor( random() * 42 );

	return ( channel() << 16 ) | ( channel() << 8 ) | channel();
}

export function mulberry32( seed: number ): () => number {
	let a = seed >>> 0;
	return (): number => {
		a = ( a + 0x6d2b79f5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
}
