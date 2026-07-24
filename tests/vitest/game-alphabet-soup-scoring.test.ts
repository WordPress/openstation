/**
 * Unit tests for Alphabet Soup's scoring model
 * (`src/games/alphabet-soup/scoring.ts`) and mode shaping
 * (`src/games/alphabet-soup/modes.ts`).
 */
import { describe, expect, test } from 'vitest';
import {
	DAILY_WAVE_COUNT,
	SOUP_SIZES,
	baseWordCount,
	isFinalDailyWave,
	sizeCells,
	waveConfig,
} from '../../src/games/alphabet-soup/modes';
import {
	accuracyPercent,
	buildSoupScoreRow,
	createSoupScore,
	recordFind,
	recordMissSelection,
	recordWaveClear,
	streakMultiplier,
	waveClearBonus,
	wordPoints,
	wordsPerMinute,
} from '../../src/games/alphabet-soup/scoring';

describe( 'alphabet-soup/scoring.ts', () => {
	test( 'streak multiplier grows and caps at 2.5×', () => {
		expect( streakMultiplier( 0 ) ).toBe( 1 );
		expect( streakMultiplier( 4 ) ).toBeCloseTo( 1.6 );
		expect( streakMultiplier( 10 ) ).toBeCloseTo( 2.5 );
		expect( streakMultiplier( 25 ) ).toBeCloseTo( 2.5 );
	} );

	test( 'a find pays with the PRE-find streak multiplier', () => {
		const state = createSoupScore();
		// First find: streak 0 → 1.0×.
		expect( recordFind( state, 4 ) ).toBe( wordPoints( 4, 0 ) );
		// Second find: streak 1 → 1.15×.
		expect( recordFind( state, 4 ) ).toBe( wordPoints( 4, 1 ) );
		expect( state.wordsFound ).toBe( 2 );
		expect( state.streak ).toBe( 2 );
	} );

	test( 'a wrong selection resets the streak but not bestStreak', () => {
		const state = createSoupScore();
		recordFind( state, 5 );
		recordFind( state, 5 );
		recordFind( state, 5 );
		expect( state.bestStreak ).toBe( 3 );
		recordMissSelection( state );
		expect( state.streak ).toBe( 0 );
		expect( state.bestStreak ).toBe( 3 );
		expect( state.totalSelections ).toBe( 4 );
	} );

	test( 'wave-clear bonus grows with the wave', () => {
		expect( waveClearBonus( 1 ) ).toBe( 150 );
		expect( waveClearBonus( 3 ) ).toBe( 250 );
		const state = createSoupScore();
		recordWaveClear( state, 2 );
		expect( state.score ).toBe( 200 );
	} );

	test( 'accuracy is 100 before the first selection', () => {
		const state = createSoupScore();
		expect( accuracyPercent( state ) ).toBe( 100 );
		recordFind( state, 4 );
		recordMissSelection( state );
		expect( accuracyPercent( state ) ).toBe( 50 );
	} );

	test( 'wpm counts whole words per minute', () => {
		const state = createSoupScore();
		recordFind( state, 4 );
		recordFind( state, 4 );
		recordFind( state, 4 );
		expect( wordsPerMinute( state, 90 ) ).toBe( 2 );
		expect( wordsPerMinute( state, 0 ) ).toBe( 0 );
	} );

	test( 'the score row matches the registered columns', () => {
		const state = createSoupScore();
		recordFind( state, 6 );
		const row = buildSoupScoreRow( state, {
			mode: 'time-attack',
			size: '12×12',
			wave: 4,
			elapsedSeconds: 123.6,
		} );
		expect( row.score ).toBe( state.score );
		expect( row.meta ).toEqual( {
			mode: 'time-attack',
			size: '12×12',
			words: 1,
			wpm: wordsPerMinute( state, 124 ),
			accuracy: 100,
			streak: 1,
			wave: 4,
			time: 124,
		} );
	} );
} );

describe( 'alphabet-soup/modes.ts', () => {
	test( 'three pot sizes, bigger pots hide more words', () => {
		expect( SOUP_SIZES ).toEqual( [ 'small', 'medium', 'big' ] );
		expect( sizeCells( 'small' ) ).toBe( 8 );
		expect( sizeCells( 'medium' ) ).toBe( 12 );
		expect( sizeCells( 'big' ) ).toBe( 16 );
		expect( baseWordCount( 'small' ) ).toBe( 6 );
		expect( baseWordCount( 'medium' ) ).toBe( 10 );
		expect( baseWordCount( 'big' ) ).toBe( 14 );
	} );

	test( 'daily serves exactly three growing waves at a fixed size', () => {
		expect( isFinalDailyWave( DAILY_WAVE_COUNT ) ).toBe( true );
		expect( isFinalDailyWave( DAILY_WAVE_COUNT - 1 ) ).toBe( false );
		const w1 = waveConfig( 'daily', 'medium', 1 );
		const w3 = waveConfig( 'daily', 'medium', 3 );
		expect( w1.gridSize ).toBe( 12 );
		expect( w3.gridSize ).toBe( 12 );
		expect( w1.wordCount ).toBe( 10 );
		expect( w3.wordCount ).toBe( 12 );
		expect( w3.maxLen ).toBeGreaterThan( w1.maxLen );
	} );

	test( 'time attack keeps the picked pot and caps the word ramp', () => {
		const early = waveConfig( 'time-attack', 'small', 1 );
		const late = waveConfig( 'time-attack', 'small', 30 );
		expect( early.gridSize ).toBe( 8 );
		expect( late.gridSize ).toBe( 8 );
		expect( early.wordCount ).toBe( 6 );
		expect( late.wordCount ).toBe( 10 );
		expect( late.maxLen ).toBeLessThanOrEqual( late.gridSize );
	} );

	test( 'wave words always fit the grid', () => {
		for ( const mode of [ 'daily', 'time-attack' ] as const ) {
			for ( const size of SOUP_SIZES ) {
				for ( let wave = 1; wave <= 12; wave++ ) {
					const cfg = waveConfig( mode, size, wave );
					expect( cfg.maxLen ).toBeLessThanOrEqual( cfg.gridSize );
					expect( cfg.minLen ).toBeLessThanOrEqual( cfg.maxLen );
				}
			}
		}
	} );
} );
