/**
 * Unit tests for `src/games/scoreboard.ts`: the live refresh that
 * keeps the Games hub's leaderboard in step with runs finishing in
 * the game's own window, plus the `time` column formatter.
 *
 * The REST client is mocked so the tests assert on refetches rather
 * than on painted rows; `<os-table>` is left to its real
 * implementation (it only has to accept the assignments).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { GameRegistryEntry, GameScoreRow } from '../../src/games/types';

const fetchScoresSpy = vi.fn();

vi.mock( '../../src/games/rest', () => ( {
	fetchScores: ( ...args: unknown[] ) => fetchScoresSpy( ...args ),
} ) );

type Activity = typeof import( '../../src/activity' );
type Scoreboard = typeof import( '../../src/games/scoreboard' );

async function loadModules(): Promise< {
	activity: Activity;
	scoreboard: Scoreboard;
} > {
	vi.resetModules();
	return {
		activity: await import( '../../src/activity' ),
		scoreboard: await import( '../../src/games/scoreboard' ),
	};
}

const GAME: GameRegistryEntry = {
	id: 'inkfall',
	title: 'Inkfall',
	icon: 'dashicons-admin-generic',
	scoreColumns: [ { key: 'score', label: 'Score' } ],
};

const makeRow = ( overrides: Partial< GameScoreRow > = {} ): GameScoreRow => ( {
	id: 1,
	userId: 1,
	userName: 'Player',
	userAvatar: 'https://example.test/a.png',
	score: 100,
	meta: {},
	createdAtMs: 1_700_000_000_000,
	...overrides,
} );

/** A leaderboard page big enough to paginate (PER_PAGE is 25). */
const page = ( total: number ): { scores: GameScoreRow[]; total: number } => ( {
	scores: [ makeRow() ],
	total,
} );

describe( 'games/scoreboard.ts', () => {
	let container: HTMLElement;

	beforeEach( () => {
		installHooksStub();
		fetchScoresSpy.mockReset();
		fetchScoresSpy.mockResolvedValue( page( 1 ) );
		container = document.createElement( 'div' );
		document.body.appendChild( container );
	} );

	afterEach( () => {
		clearHooksStub();
		container.remove();
	} );

	test( 'formatTimeValue renders seconds as m:ss', async () => {
		const { scoreboard } = await loadModules();

		expect( scoreboard.formatTimeValue( 0 ) ).toBe( '0:00' );
		expect( scoreboard.formatTimeValue( 9 ) ).toBe( '0:09' );
		expect( scoreboard.formatTimeValue( 125 ) ).toBe( '2:05' );
		// Junk and negatives floor at zero rather than rendering NaN.
		expect( scoreboard.formatTimeValue( -5 ) ).toBe( '0:00' );
		expect( scoreboard.formatTimeValue( 'nope' ) ).toBe( '0:00' );
	} );

	test( 'a recorded score for this game refetches the board', async () => {
		const { activity, scoreboard } = await loadModules();
		const teardown = scoreboard.renderScoreboard( container, GAME );
		await vi.waitFor( () =>
			expect( fetchScoresSpy ).toHaveBeenCalledTimes( 1 ),
		);

		activity.activity.publish( 'os/game-score-recorded', {
			game: 'inkfall',
			score: 42,
			meta: {},
			windowId: 'os-game-inkfall',
		} );

		await vi.waitFor( () =>
			expect( fetchScoresSpy ).toHaveBeenCalledTimes( 2 ),
		);
		teardown();
	} );

	test( 'a recorded score for another game is ignored', async () => {
		const { activity, scoreboard } = await loadModules();
		const teardown = scoreboard.renderScoreboard( container, GAME );
		await vi.waitFor( () =>
			expect( fetchScoresSpy ).toHaveBeenCalledTimes( 1 ),
		);

		activity.activity.publish( 'os/game-score-recorded', {
			game: 'alphabet-soup',
			score: 42,
			meta: {},
			windowId: 'os-game-alphabet-soup',
		} );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		expect( fetchScoresSpy ).toHaveBeenCalledTimes( 1 );
		teardown();
	} );

	test( 'the refresh reloads the page being viewed, not page 1', async () => {
		const { activity, scoreboard } = await loadModules();
		// 60 rows over a 25-per-page board, enough for a page 3.
		fetchScoresSpy.mockResolvedValue( page( 60 ) );
		const teardown = scoreboard.renderScoreboard( container, GAME );
		await vi.waitFor( () =>
			expect( fetchScoresSpy ).toHaveBeenCalledTimes( 1 ),
		);

		// Walk to page 2 the way the pager does.
		const next = Array.from(
			container.querySelectorAll( 'os-button' ),
		).find( ( btn ) => 'Next' === btn.textContent );
		next?.dispatchEvent( new Event( 'click' ) );
		await vi.waitFor( () =>
			expect( fetchScoresSpy ).toHaveBeenLastCalledWith(
				'inkfall',
				expect.objectContaining( { page: 2 } ),
			),
		);

		activity.activity.publish( 'os/game-score-recorded', {
			game: 'inkfall',
			score: 42,
			meta: {},
			windowId: 'os-game-inkfall',
		} );

		await vi.waitFor( () =>
			expect( fetchScoresSpy ).toHaveBeenCalledTimes( 3 ),
		);
		expect( fetchScoresSpy ).toHaveBeenLastCalledWith(
			'inkfall',
			expect.objectContaining( { page: 2 } ),
		);
		teardown();
	} );

	test( 'teardown unsubscribes so a torn-down board never refetches', async () => {
		const { activity, scoreboard } = await loadModules();
		const teardown = scoreboard.renderScoreboard( container, GAME );
		await vi.waitFor( () =>
			expect( fetchScoresSpy ).toHaveBeenCalledTimes( 1 ),
		);

		teardown();
		activity.activity.publish( 'os/game-score-recorded', {
			game: 'inkfall',
			score: 42,
			meta: {},
			windowId: 'os-game-inkfall',
		} );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		expect( fetchScoresSpy ).toHaveBeenCalledTimes( 1 );
	} );
} );
