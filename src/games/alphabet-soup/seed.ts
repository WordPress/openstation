import {
	hash32,
	mulberry32,
} from '../../plugins/living-tree-wallpaper/rng';
import type { SoupMode, SoupSize } from './modes';

export function formatDailySeed( date: Date ): string {
	const day = String( date.getUTCDate() ).padStart( 2, '0' );
	const month = String( date.getUTCMonth() + 1 ).padStart( 2, '0' );
	const year = String( date.getUTCFullYear() );
	return `${ day }-${ month }-${ year }`;
}

export function runSeedString(
	dateSeed: string,
	mode: SoupMode,
	size: SoupSize,
): string {
	return 'time-attack' === mode
		? `${ dateSeed }#time-attack#${ size }`
		: `${ dateSeed }#${ size }`;
}

export function waveRng( seedString: string, wave: number ): () => number {
	return mulberry32( hash32( `${ seedString }#wave-${ wave }` ) );
}
