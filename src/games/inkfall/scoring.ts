export interface ScoreState {
	score: number;
	wordsCompleted: number;

	streak: number;

	correctKeys: number;

	totalKeys: number;

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

export function streakMultiplier( streak: number ): number {
	return 1 + 0.1 * Math.min( Math.max( 0, streak ), 10 );
}

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

export function recordCorrectKey( state: ScoreState ): void {
	state.correctKeys++;
	state.totalKeys++;
}

export function recordTypo( state: ScoreState ): void {
	state.totalKeys++;
	state.typoInCurrentWord = true;
	state.streak = 0;
}

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

export function recordMiss( state: ScoreState ): void {
	state.streak = 0;
	state.typoInCurrentWord = false;
}

export function accuracyPercent( state: ScoreState ): number {
	if ( state.totalKeys === 0 ) {
		return 100;
	}
	return Math.round( ( state.correctKeys / state.totalKeys ) * 100 );
}

export function wordsPerMinute( state: ScoreState, elapsedSeconds: number ): number {
	if ( elapsedSeconds <= 0 ) {
		return 0;
	}
	return Math.round( ( state.correctKeys / 5 ) * ( 60 / elapsedSeconds ) );
}

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
