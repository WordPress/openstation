export type SoupMode = 'daily' | 'time-attack';

export const SOUP_MODES: readonly SoupMode[] = [ 'daily', 'time-attack' ];

export type SoupSize = 'small' | 'medium' | 'big';

export const SOUP_SIZES: readonly SoupSize[] = [ 'small', 'medium', 'big' ];

export const DAILY_WAVE_COUNT = 3;

export const TIME_ATTACK_START_SECONDS = 90;

export const TIME_ATTACK_WORD_BONUS_SECONDS = 4;

export const TIME_ATTACK_WAVE_BONUS_SECONDS = 15;

export const LOW_TIME_SECONDS = 10;

export function sizeCells( size: SoupSize ): number {
	switch ( size ) {
		case 'big':
			return 16;
		case 'medium':
			return 12;
		default:
			return 8;
	}
}

export function baseWordCount( size: SoupSize ): number {
	switch ( size ) {
		case 'big':
			return 14;
		case 'medium':
			return 10;
		default:
			return 6;
	}
}

export interface WaveConfig {

	gridSize: number;

	wordCount: number;

	minLen: number;
	maxLen: number;
}

export function waveConfig(
	mode: SoupMode,
	size: SoupSize,
	wave: number,
): WaveConfig {
	const step = Math.max( 0, wave - 1 );
	const gridSize = sizeCells( size );
	const base = baseWordCount( size );
	if ( 'time-attack' === mode ) {
		return {
			gridSize,
			wordCount: Math.min( base + 4, base + step ),
			minLen: 4,
			maxLen: Math.min( gridSize, 9, 6 + step ),
		};
	}

	return {
		gridSize,
		wordCount: base + step,
		minLen: 4,
		maxLen: Math.min( gridSize, 10, 6 + step ),
	};
}

export function isFinalDailyWave( wave: number ): boolean {
	return wave >= DAILY_WAVE_COUNT;
}
