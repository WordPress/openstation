/**
 * Unit tests for `src/games/playtime.ts` — the active-time clock
 * (pause/resume, periodic flush, remainder carry-over, failure
 * re-banking) and the display formatter.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	formatPlaytime,
	startPlaytimeTracker,
	sumPlaytimeSince,
} from '../../src/games/playtime';
import { recordPlaytime } from '../../src/games/rest';

vi.mock( '../../src/games/rest', () => ( {
	recordPlaytime: vi.fn().mockResolvedValue( { total: 0 } ),
} ) );

const recordMock = vi.mocked( recordPlaytime );

describe( 'games/playtime.ts', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		recordMock.mockClear();
		recordMock.mockResolvedValue( { total: 0 } );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	describe( 'startPlaytimeTracker', () => {
		test( 'flushes whole elapsed seconds once a minute', () => {
			startPlaytimeTracker( 'inkfall', { windowId: 'w1' } );
			vi.advanceTimersByTime( 60_000 );
			expect( recordMock ).toHaveBeenCalledTimes( 1 );
			expect( recordMock ).toHaveBeenCalledWith( 'inkfall', 60, {
				windowId: 'w1',
				silent: true,
			} );
		} );

		test( 'stop() flushes the remainder and clears the interval', () => {
			const tracker = startPlaytimeTracker( 'inkfall' );
			vi.advanceTimersByTime( 5_000 );
			tracker.stop();
			expect( recordMock ).toHaveBeenCalledTimes( 1 );
			expect( recordMock.mock.calls[ 0 ][ 1 ] ).toBe( 5 );

			// The interval is gone and repeated stops don't re-flush.
			tracker.stop();
			vi.advanceTimersByTime( 300_000 );
			expect( recordMock ).toHaveBeenCalledTimes( 1 );
		} );

		test( 'skips the flush entirely under one second of play', () => {
			const tracker = startPlaytimeTracker( 'inkfall' );
			vi.advanceTimersByTime( 400 );
			tracker.stop();
			expect( recordMock ).not.toHaveBeenCalled();
		} );

		test( 'the clock pauses while minimized and resumes on restore', () => {
			const tracker = startPlaytimeTracker( 'inkfall' );
			vi.advanceTimersByTime( 10_000 );
			tracker.pause();
			// A whole minimized minute: the tick still fires but only
			// the pre-pause 10s are banked.
			vi.advanceTimersByTime( 60_000 );
			expect( recordMock ).toHaveBeenCalledTimes( 1 );
			expect( recordMock.mock.calls[ 0 ][ 1 ] ).toBe( 10 );

			// Still paused — nothing accrues.
			vi.advanceTimersByTime( 60_000 );
			expect( recordMock ).toHaveBeenCalledTimes( 1 );

			// Resume at t=130s: the t=180s tick sees 50s on the clock.
			tracker.resume();
			vi.advanceTimersByTime( 60_000 );
			expect( recordMock ).toHaveBeenCalledTimes( 2 );
			expect( recordMock.mock.calls[ 1 ][ 1 ] ).toBe( 50 );
		} );

		test( 'resume() after stop() does not restart the clock', () => {
			const tracker = startPlaytimeTracker( 'inkfall' );
			vi.advanceTimersByTime( 2_000 );
			tracker.stop();
			tracker.resume();
			vi.advanceTimersByTime( 120_000 );
			expect( recordMock ).toHaveBeenCalledTimes( 1 );
		} );

		test( 'sub-second remainders carry over between flushes', () => {
			const tracker = startPlaytimeTracker( 'inkfall' );
			// Pause 500ms into each second so flushes see x.5s banked.
			vi.advanceTimersByTime( 10_500 );
			tracker.pause();
			vi.advanceTimersByTime( 49_500 ); // tick fires at 60s
			expect( recordMock.mock.calls[ 0 ][ 1 ] ).toBe( 10 );
			tracker.resume();
			vi.advanceTimersByTime( 10_500 );
			tracker.stop();
			// 500ms carried + 10.5s new = 11s exactly.
			expect( recordMock.mock.calls[ 1 ][ 1 ] ).toBe( 11 );
		} );

		test( 'a failed flush re-banks its seconds for the next tick', async () => {
			recordMock.mockRejectedValueOnce( new Error( 'offline' ) );
			startPlaytimeTracker( 'inkfall' );
			vi.advanceTimersByTime( 60_000 );
			expect( recordMock.mock.calls[ 0 ][ 1 ] ).toBe( 60 );
			// Let the rejection settle so the re-bank happens.
			await Promise.resolve();
			await Promise.resolve();
			vi.advanceTimersByTime( 60_000 );
			expect( recordMock ).toHaveBeenCalledTimes( 2 );
			expect( recordMock.mock.calls[ 1 ][ 1 ] ).toBe( 120 );
		} );
	} );

	describe( 'sumPlaytimeSince', () => {
		const daily = {
			'2026-07-18': 1200, // today
			'2026-07-10': 600, // inside a 14-day window
			'2026-07-05': 300, // day 14 of 14 — still inside
			'2026-07-04': 900, // day 15 — outside
			'2026-08-01': 500, // future (clock skew) — ignored
		};

		test( 'sums only the trailing window ending at todayKey', () => {
			expect( sumPlaytimeSince( daily, '2026-07-18', 14 ) ).toBe( 2100 );
			expect( sumPlaytimeSince( daily, '2026-07-18', 1 ) ).toBe( 1200 );
		} );

		test( 'tolerates garbage input', () => {
			expect( sumPlaytimeSince( {}, '2026-07-18', 14 ) ).toBe( 0 );
			expect( sumPlaytimeSince( daily, 'not-a-date', 14 ) ).toBe( 0 );
			expect( sumPlaytimeSince( daily, '2026-07-18', 0 ) ).toBe( 0 );
			expect(
				sumPlaytimeSince( { '2026-07-18': -50 }, '2026-07-18', 14 ),
			).toBe( 0 );
		} );

		test( 'window spans month boundaries', () => {
			expect(
				sumPlaytimeSince( { '2026-06-30': 60 }, '2026-07-05', 14 ),
			).toBe( 60 );
		} );
	} );

	describe( 'formatPlaytime', () => {
		test( 'formats seconds, minutes, and hours', () => {
			expect( formatPlaytime( 0 ) ).toBe( '0s' );
			expect( formatPlaytime( 45 ) ).toBe( '45s' );
			expect( formatPlaytime( 125 ) ).toBe( '2m' );
			expect( formatPlaytime( 3600 ) ).toBe( '1h 0m' );
			expect( formatPlaytime( 8040 ) ).toBe( '2h 14m' );
		} );

		test( 'clamps garbage to zero', () => {
			expect( formatPlaytime( -30 ) ).toBe( '0s' );
			expect( formatPlaytime( NaN ) ).toBe( '0s' );
		} );
	} );
} );
