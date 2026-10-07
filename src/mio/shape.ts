import type { MioPhysics } from './types';

export const HALF_PI = Math.PI / 2;

export const TAU = Math.PI * 2;

const BLOB_AMPLITUDE = 0.05;

function uprightPhase( angle: number ): number {
	return ( ( ( angle + HALF_PI ) % TAU ) + TAU ) % TAU;
}

function crest( cosine: number, power: number ): number {
	return Math.pow( 0.5 + 0.5 * cosine, power );
}

function ghostDeviation( angle: number ): number {
	const under = Math.max( 0, Math.sin( angle ) );
	const n = 2 + 3.2 * under;
	const c = Math.abs( Math.cos( angle ) );
	const s = Math.abs( Math.sin( angle ) );
	const square =
		1 / Math.pow( Math.pow( c, n ) + Math.pow( s, n ), 1 / n ) - 1;
	const feet = -0.17 * Math.pow( under, 1.4 ) * Math.cos( 6 * angle );
	return square + feet;
}

function potatoDeviation( angle: number ): number {
	return (
		0.16 * Math.cos( 2 * angle + 0.9 ) +
		0.095 * Math.cos( 3 * angle - 2.1 ) +
		0.036 * Math.cos( 5 * angle + 1.3 ) +
		0.019 * Math.cos( 7 * angle - 0.4 )
	);
}

function starDeviation( phase: number ): number {
	return 0.58 * ( crest( Math.cos( 5 * phase ), 3 ) - 0.3125 );
}

function flowerDeviation( phase: number ): number {
	return 0.34 * ( crest( Math.cos( 6 * phase ), 2 ) - 0.375 );
}

function diamondDeviation( phase: number ): number {
	return 0.34 * ( crest( Math.cos( 4 * phase ), 2 ) - 0.375 );
}

function dropDeviation( phase: number ): number {
	return 0.72 * ( Math.pow( Math.max( 0, Math.cos( phase ) ), 8 ) - 0.1367 );
}

function cloudDeviation( phase: number ): number {
	const up = Math.max( 0, Math.cos( phase ) );
	const down = Math.max( 0, -Math.cos( phase ) );
	return (
		0.34 *
		( Math.sqrt( up ) * ( 0.5 + 0.5 * Math.cos( 5 * phase ) ) -
			0.7 * down * down -
			0.0247 )
	);
}

function heartDeviation( phase: number ): number {
	const fold = phase > Math.PI ? TAU - phase : phase;
	const cleft = -0.34 * Math.pow( Math.max( 0, Math.cos( phase ) ), 6 );
	const lobes = 0.3 * Math.pow( Math.max( 0, Math.cos( fold - 1 ) ), 3 );
	const tip = 0.34 * Math.pow( Math.max( 0, -Math.cos( phase ) ), 8 );
	return cleft + lobes + tip + 0.02;
}

function presetDeviation( angle: number, physics: MioPhysics ): number {
	switch ( physics.shapePreset ) {
		case 'circle':
			return 0;
		case 'ghost':
			return ghostDeviation( angle );
		case 'potato':
			return potatoDeviation( angle );
		case 'star':
			return starDeviation( uprightPhase( angle ) );
		case 'flower':
			return flowerDeviation( uprightPhase( angle ) );
		case 'diamond':
			return diamondDeviation( uprightPhase( angle ) );
		case 'drop':
			return dropDeviation( uprightPhase( angle ) );
		case 'cloud':
			return cloudDeviation( uprightPhase( angle ) );
		case 'heart':
			return heartDeviation( uprightPhase( angle ) );
		case 'custom': {
			const lobes = Math.round( physics.shapeLobes );
			if ( lobes < 2 ) {
				return 0;
			}

			return ( 1 / ( 1 + lobes * lobes ) ) * Math.cos( lobes * angle );
		}
		default:

			return BLOB_AMPLITUDE * Math.cos( 3 * ( angle + HALF_PI ) );
	}
}

export function presetRimPoints( physics: MioPhysics ): number {
	switch ( physics.shapePreset ) {
		case 'star':
			return 40;
		case 'flower':
			return 36;
		case 'heart':
		case 'cloud':
			return 32;
		case 'drop':
			return 28;
		case 'ghost':
			return 26;
		case 'potato':
		case 'diamond':
			return 24;
		case 'custom':
			return Math.max( 12, Math.round( physics.shapeLobes ) * 7 );
		default:

			return 12;
	}
}

export function shapeProfile( angle: number, physics: MioPhysics ): number {
	if ( physics.shapeAmount <= 0 ) {
		return 1;
	}
	const upright = angle - ( physics.shapeAngle * Math.PI ) / 180;
	return 1 + physics.shapeAmount * presetDeviation( upright, physics );
}
