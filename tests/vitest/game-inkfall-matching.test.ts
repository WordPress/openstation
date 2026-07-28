/**
 * Unit tests for Inkfall's matcher (`src/games/inkfall/matching.ts`).
 */
import { describe, expect, test } from 'vitest';
import {
	createMatcher,
	type MatchableWord,
} from '../../src/games/inkfall/matching';

const words = ( ...list: Array< [ number, string, number ] > ): MatchableWord[] =>
	list.map( ( [ id, text, y ] ) => ( { id, text, y } ) );

describe( 'inkfall/matching.ts', () => {
	test( 'first keystroke locks the lowest word sharing the initial', () => {
		const matcher = createMatcher();
		const live = words( [ 1, 'sun', 40 ], [ 2, 'sea', 180 ], [ 3, 'ink', 90 ] );

		const result = matcher.handleKey( 's', live );
		expect( result ).toEqual( {
			kind: 'locked',
			targetId: 2,
			matchedCount: 1,
		} );
	} );

	test( 'no candidate → ignored, no lock', () => {
		const matcher = createMatcher();
		const result = matcher.handleKey( 'z', words( [ 1, 'sun', 40 ] ) );
		expect( result.kind ).toBe( 'ignored' );
		expect( matcher.state().targetId ).toBeNull();
	} );

	test( 'advance / typo / complete transitions', () => {
		const matcher = createMatcher();
		const live = words( [ 1, 'note', 40 ] );

		matcher.handleKey( 'n', live );
		expect( matcher.handleKey( 'x', live ) ).toEqual( {
			kind: 'typo',
			targetId: 1,
		} );
		// Typo keeps the lock — the next correct letter advances.
		expect( matcher.handleKey( 'o', live ) ).toEqual( {
			kind: 'advanced',
			targetId: 1,
			matchedCount: 2,
		} );
		matcher.handleKey( 't', live );
		expect( matcher.handleKey( 'e', live ) ).toEqual( {
			kind: 'completed',
			targetId: 1,
		} );
		// Completion clears the lock.
		expect( matcher.state().targetId ).toBeNull();
	} );

	test( 'backspace steps back one char but never unlocks', () => {
		const matcher = createMatcher();
		const live = words( [ 1, 'paper', 10 ] );
		matcher.handleKey( 'p', live );
		matcher.handleKey( 'a', live );
		matcher.handleBackspace();
		expect( matcher.state() ).toEqual( { targetId: 1, matchedCount: 1 } );
		// Backspacing at 1 stays at 1 — the lock is release()'s job.
		matcher.handleBackspace();
		expect( matcher.state() ).toEqual( { targetId: 1, matchedCount: 1 } );
	} );

	test( 'escape releases the lock', () => {
		const matcher = createMatcher();
		matcher.handleKey( 'p', words( [ 1, 'paper', 10 ] ) );
		matcher.release();
		expect( matcher.state().targetId ).toBeNull();
	} );

	test( 'a vanished locked word retargets the keystroke', () => {
		const matcher = createMatcher();
		matcher.handleKey( 's', words( [ 1, 'sun', 40 ], [ 2, 'ink', 90 ] ) );
		// Word 1 reached the bottom; the same keystroke now finds ink.
		const result = matcher.handleKey( 'i', words( [ 2, 'ink', 90 ] ) );
		expect( result ).toEqual( { kind: 'locked', targetId: 2, matchedCount: 1 } );
	} );

	test( 'forget clears only a matching lock', () => {
		const matcher = createMatcher();
		matcher.handleKey( 's', words( [ 1, 'sun', 40 ] ) );
		matcher.forget( 99 );
		expect( matcher.state().targetId ).toBe( 1 );
		matcher.forget( 1 );
		expect( matcher.state().targetId ).toBeNull();
	} );

	test( 'non-letter keys are ignored', () => {
		const matcher = createMatcher();
		expect( matcher.handleKey( '1', words( [ 1, 'one', 5 ] ) ).kind ).toBe(
			'ignored',
		);
		expect( matcher.handleKey( ' ', words( [ 1, 'one', 5 ] ) ).kind ).toBe(
			'ignored',
		);
	} );
} );
