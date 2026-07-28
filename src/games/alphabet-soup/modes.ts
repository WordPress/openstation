/**
 * Alphabet Soup — modes, board sizes, and wave shaping.
 *
 * Two ways to eat the soup, in three pot sizes:
 *
 * - **Daily** — three waves, no clock pressure (the timer counts
 *   up). Everyone worldwide plays the same grids; the leaderboard
 *   compares clean, fast, streaky runs.
 * - **Time Attack** — a countdown. Every found word adds seconds,
 *   clearing a wave adds more, and the waves keep coming until the
 *   pot boils dry. Seeded from the same date but a different
 *   stream, so it is its own shared puzzle.
 *
 * The **board size** (Small 8×8, Medium 12×12, Big 16×16) is picked
 * up front and stays fixed for the run; bigger pots hide more
 * words. Each (mode, size) pair seeds its own puzzle — see
 * `seed.ts` — and each is meant to be played for real ONCE per day:
 * the word positions can be memorized, so replays never earn a
 * share card (the game says so before a replay starts).
 *
 * Pure — fully unit-tested.
 */

export type SoupMode = 'daily' | 'time-attack';

export const SOUP_MODES: readonly SoupMode[] = [ 'daily', 'time-attack' ];

export type SoupSize = 'small' | 'medium' | 'big';

export const SOUP_SIZES: readonly SoupSize[] = [ 'small', 'medium', 'big' ];

/** Waves in a Daily run (Time Attack is unbounded). */
export const DAILY_WAVE_COUNT = 3;

/** Time Attack: starting seconds on the clock. */
export const TIME_ATTACK_START_SECONDS = 90;

/** Time Attack: seconds granted per found word. */
export const TIME_ATTACK_WORD_BONUS_SECONDS = 4;

/** Time Attack: seconds granted for clearing a wave. */
export const TIME_ATTACK_WAVE_BONUS_SECONDS = 15;

/** Countdown threshold where the HUD pulses and the clock ticks. */
export const LOW_TIME_SECONDS = 10;

/** The grid dimension for a board size. */
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

/** Hidden words on wave 1 — bigger pots hide more. */
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
	/** Grid is `gridSize × gridSize` cells (fixed for the run). */
	gridSize: number;
	/** Words hidden in the grid. */
	wordCount: number;
	/** Hidden-word length band. */
	minLen: number;
	maxLen: number;
}

/**
 * The shape of one wave. The pot stays the picked size; waves add
 * words and stretch the length band. Deterministic — part of the
 * worldwide-same-puzzle contract.
 *
 * @param mode Run mode.
 * @param size Board size picked for the run.
 * @param wave 1-based wave number.
 */
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
	// Daily: three fixed, comparable waves.
	return {
		gridSize,
		wordCount: base + step,
		minLen: 4,
		maxLen: Math.min( gridSize, 10, 6 + step ),
	};
}

/** Whether a Daily run is complete after clearing `wave`. */
export function isFinalDailyWave( wave: number ): boolean {
	return wave >= DAILY_WAVE_COUNT;
}
