export interface SoupScoreState {
	score: number;
	wordsFound: number;

	streak: number;

	bestStreak: number;

	correctSelections: number;

	totalSelections: number;
}

export function createSoupScore(): SoupScoreState {
	return {
		score: 0,
		wordsFound: 0,
		streak: 0,
		bestStreak: 0,
		correctSelections: 0,
		totalSelections: 0,
	};
}

export function streakMultiplier( streak: number ): number {
	return 1 + 0.15 * Math.min( Math.max( 0, streak ), 10 );
}

export function wordPoints( length: number, streak: number ): number {
	return Math.round( 15 * length * streakMultiplier( streak ) );
}

export function recordFind( state: SoupScoreState, length: number ): number {
	const points = wordPoints( length, state.streak );
	state.score += points;
	state.wordsFound++;
	state.correctSelections++;
	state.totalSelections++;
	state.streak++;
	state.bestStreak = Math.max( state.bestStreak, state.streak );
	return points;
}

export function recordMissSelection( state: SoupScoreState ): void {
	state.totalSelections++;
	state.streak = 0;
}

export function waveClearBonus( wave: number ): number {
	return 150 + 50 * Math.max( 0, wave - 1 );
}

export function recordWaveClear( state: SoupScoreState, wave: number ): number {
	const bonus = waveClearBonus( wave );
	state.score += bonus;
	return bonus;
}

export function accuracyPercent( state: SoupScoreState ): number {
	if ( 0 === state.totalSelections ) {
		return 100;
	}
	return Math.round(
		( state.correctSelections / state.totalSelections ) * 100,
	);
}

export function wordsPerMinute(
	state: SoupScoreState,
	elapsedSeconds: number,
): number {
	if ( elapsedSeconds <= 0 ) {
		return 0;
	}
	return Math.round( state.wordsFound * ( 60 / elapsedSeconds ) );
}

export function buildSoupScoreRow(
	state: SoupScoreState,
	opts: {
		mode: string;

		size: string;
		wave: number;
		elapsedSeconds: number;
	},
): { score: number; meta: Record< string, string | number > } {
	const elapsed = Math.max( 0, Math.round( opts.elapsedSeconds ) );
	return {
		score: state.score,
		meta: {
			mode: opts.mode,
			size: opts.size,
			words: state.wordsFound,
			wpm: wordsPerMinute( state, Math.max( 1, elapsed ) ),
			accuracy: accuracyPercent( state ),
			streak: state.bestStreak,
			wave: opts.wave,
			time: elapsed,
		},
	};
}
