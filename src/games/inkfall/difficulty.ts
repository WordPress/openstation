export const MAX_RAMP_SECONDS = 300;

export const STARTING_LIVES = 3;

export const REFERENCE_HEIGHT = 600;

export type DifficultyMode = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_MODES: readonly DifficultyMode[] = [
	'easy',
	'medium',
	'hard',
];

interface DifficultyPreset {

	spawn: [ number, number ];

	speed: [ number, number ];

	concurrentStart: number;
	concurrentSteps: ReadonlyArray< [ number, number ] >;

	bandStart: [ number, number ];
	bandSteps: ReadonlyArray< [ number, number, number ] >;
}

const PRESETS: Record< DifficultyMode, DifficultyPreset > = {

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

	spawnIntervalMs: number;

	fallSpeed: number;

	maxConcurrent: number;

	minLength: number;
	maxLength: number;

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

export function fallSpeed( t: number, mode: DifficultyMode = 'easy' ): number {
	const clamped = clampT( t );
	const [ start, cap ] = preset( mode ).speed;
	return start + ( ( cap - start ) * clamped ) / MAX_RAMP_SECONDS;
}

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

export function level( t: number ): number {
	return Math.min( 15, Math.floor( clampT( t ) / 20 ) );
}

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
