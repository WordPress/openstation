/**
 * Unit tests for Inkfall's scoring model
 * (`src/games/inkfall/scoring.ts`).
 */
import { describe, expect, test } from 'vitest';
import {
	accuracyPercent,
	buildScoreRow,
	createScoreState,
	recordCompletion,
	recordCorrectKey,
	recordMiss,
	recordTypo,
	streakMultiplier,
	wordPoints,
	wordsPerMinute,
} from '../../src/games/inkfall/scoring';

describe( 'inkfall/scoring.ts', () => {
	test( 'word points formula bounds', () => {
		// Base: 10 × length at the bottom of the page, no streak.
		expect( wordPoints( 4, 0, 0 ) ).toBe( 40 );
		// Finished at the very top: 1.5×.
		expect( wordPoints( 4, 1, 0 ) ).toBe( 60 );
		// Height fraction clamps.
		expect( wordPoints( 4, 5, 0 ) ).toBe( 60 );
		expect( wordPoints( 4, -1, 0 ) ).toBe( 40 );
	} );

	test( 'streak multiplier caps at 2.0×', () => {
		expect( streakMultiplier( 0 ) ).toBe( 1 );
		expect( streakMultiplier( 5 ) ).toBe( 1.5 );
		expect( streakMultiplier( 10 ) ).toBe( 2 );
		expect( streakMultiplier( 50 ) ).toBe( 2 );
	} );

	test( 'clean completions grow the streak; the multiplier lags by one word', () => {
		const state = createScoreState();
		const first = recordCompletion( state, 4, 0 );
		expect( first ).toBe( 40 ); // streak was 0 → 1.0×
		expect( state.streak ).toBe( 1 );
		const second = recordCompletion( state, 4, 0 );
		expect( second ).toBe( 44 ); // streak was 1 → 1.1×
	} );

	test( 'a typo resets the streak and gates the current word', () => {
		const state = createScoreState();
		recordCompletion( state, 4, 0 );
		recordCompletion( state, 4, 0 );
		expect( state.streak ).toBe( 2 );

		recordTypo( state );
		expect( state.streak ).toBe( 0 );

		// The word the typo happened in doesn't restart the streak.
		recordCompletion( state, 4, 0 );
		expect( state.streak ).toBe( 0 );

		// The next clean word does.
		recordCompletion( state, 4, 0 );
		expect( state.streak ).toBe( 1 );
	} );

	test( 'a missed word resets the streak', () => {
		const state = createScoreState();
		recordCompletion( state, 4, 0 );
		recordMiss( state );
		expect( state.streak ).toBe( 0 );
	} );

	test( 'accuracy and WPM math', () => {
		const state = createScoreState();
		expect( accuracyPercent( state ) ).toBe( 100 );

		for ( let i = 0; i < 9; i++ ) {
			recordCorrectKey( state );
		}
		recordTypo( state );
		expect( accuracyPercent( state ) ).toBe( 90 );

		// 25 correct chars over 60 s → 5 words/min.
		const wpmState = createScoreState();
		for ( let i = 0; i < 25; i++ ) {
			recordCorrectKey( wpmState );
		}
		expect( wordsPerMinute( wpmState, 60 ) ).toBe( 5 );
		expect( wordsPerMinute( wpmState, 0 ) ).toBe( 0 );
	} );

	test( 'the score row matches the registered columns', () => {
		const state = createScoreState();
		for ( let i = 0; i < 10; i++ ) {
			recordCorrectKey( state );
		}
		recordCompletion( state, 10, 0.5 );
		const row = buildScoreRow( state, 90, 4 );
		expect( row.score ).toBe( state.score );
		expect( row.meta ).toEqual( {
			words: 1,
			wpm: wordsPerMinute( state, 90 ),
			accuracy: 100,
			time: 90,
			level: 4,
		} );
	} );
} );
