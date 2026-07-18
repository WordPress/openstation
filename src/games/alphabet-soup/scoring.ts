/**
 * Alphabet Soup — scoring model.
 *
 * Pure. Finding a word scores with its length and the current
 * streak; the streak grows on every find and resets on a wrong
 * selection (dragging a non-word):
 *
 *   points     = round( 15 × length × streakMult )
 *   streakMult = 1 + 0.15 × min( streak, 10 )      // caps at 2.5×
 *
 * Like Inkfall, the multiplier applied is the streak BEFORE the
 * find, so the first word after a miss scores at 1.0×. Clearing a
 * wave pays a flat, growing bonus. Accuracy is correct selections
 * over total selections; "WPM" is whole words found per minute —
 * a soup spoon is not a keyboard.
 *
 * @since 0.9.8
 */

export interface SoupScoreState {
	score: number;
	wordsFound: number;
	/** Consecutive correct selections. */
	streak: number;
	/** Best streak of the run — the shareable one. */
	bestStreak: number;
	/** Correct selections (found words). */
	correctSelections: number;
	/** All completed selections of 2+ cells (correct + wrong). */
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

/** The multiplier for a given streak length. */
export function streakMultiplier( streak: number ): number {
	return 1 + 0.15 * Math.min( Math.max( 0, streak ), 10 );
}

/** Points for one found word at a given pre-find streak. */
export function wordPoints( length: number, streak: number ): number {
	return Math.round( 15 * length * streakMultiplier( streak ) );
}

/** Record a found word; returns the points it paid. */
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

/** Record a wrong selection — the streak resets. */
export function recordMissSelection( state: SoupScoreState ): void {
	state.totalSelections++;
	state.streak = 0;
}

/** Flat bonus for clearing a wave; grows with the wave number. */
export function waveClearBonus( wave: number ): number {
	return 150 + 50 * Math.max( 0, wave - 1 );
}

/** Record a cleared wave; returns the bonus it paid. */
export function recordWaveClear( state: SoupScoreState, wave: number ): number {
	const bonus = waveClearBonus( wave );
	state.score += bonus;
	return bonus;
}

/** Accuracy percent (100 before the first selection). */
export function accuracyPercent( state: SoupScoreState ): number {
	if ( 0 === state.totalSelections ) {
		return 100;
	}
	return Math.round(
		( state.correctSelections / state.totalSelections ) * 100,
	);
}

/** Whole words found per minute. */
export function wordsPerMinute(
	state: SoupScoreState,
	elapsedSeconds: number,
): number {
	if ( elapsedSeconds <= 0 ) {
		return 0;
	}
	return Math.round( state.wordsFound * ( 60 / elapsedSeconds ) );
}

/**
 * The flexible score row submitted to the framework — keys match
 * the game's registered `score_columns`.
 */
export function buildSoupScoreRow(
	state: SoupScoreState,
	opts: {
		mode: string;
		/** Board-size label, e.g. `12×12`. */
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
