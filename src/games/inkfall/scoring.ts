/**
 * Inkfall — scoring model.
 *
 * Pure. Word points scale with length, how high on the page the
 * word was finished, and the current no-typo streak:
 *
 *   points = round( 10 × length × (1 + 0.5 × heightFraction) × streakMult )
 *   streakMult = 1 + 0.1 × min( streak, 10 )        // caps at 2.0×
 *
 * `heightFraction` is the word's remaining distance to the bottom
 * over the playfield height at completion (finish high → up to
 * 1.5× before the streak multiplier). The streak counts consecutive
 * completed words with zero typos and resets on any typo or lost
 * life.
 *
 * @since 0.9.6
 */

export interface ScoreState {
	score: number;
	wordsCompleted: number;
	/** Consecutive no-typo completions. */
	streak: number;
	/** Correctly-matched keystrokes (includes completions). */
	correctKeys: number;
	/** Total letter keystrokes (correct + typos). */
	totalKeys: number;
	/** Whether the current word has had a typo (streak gate). */
	typoInCurrentWord: boolean;
}

export function createScoreState(): ScoreState {
	return {
		score: 0,
		wordsCompleted: 0,
		streak: 0,
		correctKeys: 0,
		totalKeys: 0,
		typoInCurrentWord: false,
	};
}

/** The multiplier for a given streak length. */
export function streakMultiplier( streak: number ): number {
	return 1 + 0.1 * Math.min( Math.max( 0, streak ), 10 );
}

/** Points for one completed word. */
export function wordPoints(
	length: number,
	heightFraction: number,
	streak: number,
): number {
	const height = Math.min( 1, Math.max( 0, heightFraction ) );
	return Math.round(
		10 * length * ( 1 + 0.5 * height ) * streakMultiplier( streak ),
	);
}

/** Record a correctly-matched keystroke. */
export function recordCorrectKey( state: ScoreState ): void {
	state.correctKeys++;
	state.totalKeys++;
}

/** Record a typo — resets the streak immediately. */
export function recordTypo( state: ScoreState ): void {
	state.totalKeys++;
	state.typoInCurrentWord = true;
	state.streak = 0;
}

/**
 * Record a completed word. The streak only grows when the word was
 * typed clean; the multiplier applied is the streak BEFORE this
 * word (so the first clean word after a reset scores at 1.0×).
 */
export function recordCompletion(
	state: ScoreState,
	length: number,
	heightFraction: number,
): number {
	const points = wordPoints( length, heightFraction, state.streak );
	state.score += points;
	state.wordsCompleted++;
	if ( state.typoInCurrentWord ) {
		state.streak = 0;
	} else {
		state.streak++;
	}
	state.typoInCurrentWord = false;
	return points;
}

/** Record a lost life (word reached the bottom) — streak resets. */
export function recordMiss( state: ScoreState ): void {
	state.streak = 0;
	state.typoInCurrentWord = false;
}

/** Accuracy percent (100 when nothing was typed yet). */
export function accuracyPercent( state: ScoreState ): number {
	if ( state.totalKeys === 0 ) {
		return 100;
	}
	return Math.round( ( state.correctKeys / state.totalKeys ) * 100 );
}

/** Words-per-minute: correct characters ÷ 5 per elapsed minute. */
export function wordsPerMinute( state: ScoreState, elapsedSeconds: number ): number {
	if ( elapsedSeconds <= 0 ) {
		return 0;
	}
	return Math.round( ( state.correctKeys / 5 ) * ( 60 / elapsedSeconds ) );
}

/**
 * The flexible score row submitted to the framework — keys match
 * Inkfall's registered `score_columns`.
 */
export function buildScoreRow(
	state: ScoreState,
	elapsedSeconds: number,
	level: number,
	mode?: string,
): { score: number; meta: Record< string, string | number > } {
	const meta: Record< string, string | number > = {
		words: state.wordsCompleted,
		wpm: wordsPerMinute( state, elapsedSeconds ),
		accuracy: accuracyPercent( state ),
		time: Math.round( elapsedSeconds ),
		level,
	};
	if ( mode ) {
		meta.mode = mode;
	}
	return { score: state.score, meta };
}
