/**
 * Inkfall — difficulty curve.
 *
 * Pure functions of `t` (the pausable elapsed play time in seconds)
 * and a difficulty mode chosen on the pre-game menu. Every mode
 * fits its whole ramp inside five minutes: interval and speed lerp
 * linearly from their start values to their ceilings at t=300 and
 * hold there; concurrency and the word-length band are step
 * functions.
 *
 * `easy` is the original tuning; `medium` starts brisk and ramps
 * harder; `hard` opens close to easy's mid-game and ends past
 * easy's ceiling.
 */

/** The hard ceiling — past this, every parameter holds at max. */
export const MAX_RAMP_SECONDS = 300;

/** Lives at game start. */
export const STARTING_LIVES = 3;

/** Reference playfield height the fall speeds are tuned against. */
export const REFERENCE_HEIGHT = 600;

export type DifficultyMode = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_MODES: readonly DifficultyMode[] = [
	'easy',
	'medium',
	'hard',
];

interface DifficultyPreset {
	/** [start, floor] spawn interval in ms, lerped over the ramp. */
	spawn: [ number, number ];
	/** [start, cap] fall speed in px/s at the reference height. */
	speed: [ number, number ];
	/** Concurrency: the value before the first step, then [t, value] steps. */
	concurrentStart: number;
	concurrentSteps: ReadonlyArray< [ number, number ] >;
	/** Length bands: the band before the first step, then [t, min, max] steps. */
	bandStart: [ number, number ];
	bandSteps: ReadonlyArray< [ number, number, number ] >;
}

const PRESETS: Record< DifficultyMode, DifficultyPreset > = {
	// The original tuning — genuinely gentle for the first minute.
	easy: {
		spawn: [ 3200, 900 ],
		speed: [ 40, 170 ],
		concurrentStart: 1,
		concurrentSteps: [
			[ 20, 2 ],
			[ 60, 3 ],
			[ 120, 4 ],
			[ 200, 5 ],
		],
		bandStart: [ 3, 4 ],
		bandSteps: [
			[ 30, 3, 5 ],
			[ 75, 3, 6 ],
			[ 150, 4, 8 ],
			[ 225, 5, 10 ],
			[ 300, 6, 12 ],
		],
	},
	// Brisk from the first word; two words on screen almost
	// immediately, six by the end.
	medium: {
		spawn: [ 2400, 700 ],
		speed: [ 75, 230 ],
		concurrentStart: 1,
		concurrentSteps: [
			[ 10, 2 ],
			[ 40, 3 ],
			[ 90, 4 ],
			[ 150, 5 ],
			[ 240, 6 ],
		],
		bandStart: [ 3, 5 ],
		bandSteps: [
			[ 20, 4, 6 ],
			[ 60, 4, 8 ],
			[ 120, 5, 10 ],
			[ 200, 6, 12 ],
			[ 300, 7, 12 ],
		],
	},
	// Opens near easy's mid-game and keeps going: fast ink, long
	// words, up to seven at once.
	hard: {
		spawn: [ 1700, 550 ],
		speed: [ 110, 300 ],
		concurrentStart: 2,
		concurrentSteps: [
			[ 10, 3 ],
			[ 30, 4 ],
			[ 70, 5 ],
			[ 120, 6 ],
			[ 200, 7 ],
		],
		bandStart: [ 4, 6 ],
		bandSteps: [
			[ 15, 5, 8 ],
			[ 45, 6, 10 ],
			[ 90, 7, 12 ],
			[ 150, 8, 12 ],
		],
	},
};

export interface DifficultySnapshot {
	/** Milliseconds between word spawns. */
	spawnIntervalMs: number;
	/** Fall speed in px/s at the reference 600px playfield height. */
	fallSpeed: number;
	/** Maximum simultaneous falling words. */
	maxConcurrent: number;
	/** Inclusive word-length band to draw from. */
	minLength: number;
	maxLength: number;
	/** Coarse 0–15 level indicator for the HUD + score row. */
	level: number;
}

function clampT( t: number ): number {
	if ( ! Number.isFinite( t ) || t < 0 ) {
		return 0;
	}
	return Math.min( t, MAX_RAMP_SECONDS );
}

function preset( mode: DifficultyMode ): DifficultyPreset {
	return PRESETS[ mode ] ?? PRESETS.easy;
}

/** Spawn interval, lerping from the preset's start to its floor. */
export function spawnIntervalMs(
	t: number,
	mode: DifficultyMode = 'easy',
): number {
	const clamped = clampT( t );
	const [ start, floor ] = preset( mode ).spawn;
	return Math.round(
		start - ( ( start - floor ) * clamped ) / MAX_RAMP_SECONDS,
	);
}

/** Fall speed, lerping from the preset's start to its cap. */
export function fallSpeed( t: number, mode: DifficultyMode = 'easy' ): number {
	const clamped = clampT( t );
	const [ start, cap ] = preset( mode ).speed;
	return start + ( ( cap - start ) * clamped ) / MAX_RAMP_SECONDS;
}

/** Max simultaneous words, stepping up at the preset's thresholds. */
export function maxConcurrent(
	t: number,
	mode: DifficultyMode = 'easy',
): number {
	const clamped = clampT( t );
	const { concurrentStart, concurrentSteps } = preset( mode );
	let value = concurrentStart;
	for ( const [ threshold, stepValue ] of concurrentSteps ) {
		if ( clamped >= threshold ) {
			value = stepValue;
		}
	}
	return value;
}

/** Word-length band, widening and shifting up over the run. */
export function lengthBand(
	t: number,
	mode: DifficultyMode = 'easy',
): { min: number; max: number } {
	const clamped = clampT( t );
	const { bandStart, bandSteps } = preset( mode );
	let band: { min: number; max: number } = {
		min: bandStart[ 0 ],
		max: bandStart[ 1 ],
	};
	for ( const [ threshold, min, max ] of bandSteps ) {
		if ( clamped >= threshold ) {
			band = { min, max };
		}
	}
	return band;
}

/** Coarse level indicator: one step every 20 seconds, capped at 15. */
export function level( t: number ): number {
	return Math.min( 15, Math.floor( clampT( t ) / 20 ) );
}

/** The full snapshot for a moment in the run. */
export function difficultyAt(
	t: number,
	mode: DifficultyMode = 'easy',
): DifficultySnapshot {
	const band = lengthBand( t, mode );
	return {
		spawnIntervalMs: spawnIntervalMs( t, mode ),
		fallSpeed: fallSpeed( t, mode ),
		maxConcurrent: maxConcurrent( t, mode ),
		minLength: band.min,
		maxLength: band.max,
		level: level( t ),
	};
}
