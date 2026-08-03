/**
 * Tests for the recycle-bin empty-loop driver.
 *
 * The server caps each `open_station_recycle_bin_empty` call at a
 * chunk (default 200) to avoid PHP timeouts. Issue #97 was that the
 * client called the endpoint exactly once and showed success — so a
 * 250-item bin appeared "emptied" with 50 items still in it. The
 * loop driver fixes that by iterating while `remaining > 0` and
 * surfacing intermediate progress.
 *
 * @group recycle-bin
 */

import { describe, expect, test, vi } from 'vitest';
import { runEmptyLoop } from '../../src/recycle-bin/empty-loop';
import type { EmptyResponse } from '../../src/recycle-bin/rest';

function makeChunkedServer( total: number, chunkSize: number ) {
	let purgedSoFar = 0;
	const calls: number[] = [];
	const emptyBin = vi.fn( async (): Promise< EmptyResponse > => {
		const remainingBefore = total - purgedSoFar;
		const purged = Math.min( chunkSize, remainingBefore );
		purgedSoFar += purged;
		calls.push( purged );
		return {
			purged,
			skipped: 0,
			remaining: total - purgedSoFar,
		};
	} );
	return { emptyBin, calls };
}

describe( 'runEmptyLoop', () => {
	test( 'iterates until remaining is zero (250-item bin, 200-item chunks)', async () => {
		const { emptyBin } = makeChunkedServer( 250, 200 );

		const result = await runEmptyLoop( { emptyBin } );

		expect( emptyBin ).toHaveBeenCalledTimes( 2 );
		expect( result.purged ).toBe( 250 );
		expect( result.remaining ).toBe( 0 );
		expect( result.stoppedBecause ).toBe( 'empty' );
	} );

	test( 'completes a one-shot empty bin in a single call', async () => {
		const { emptyBin } = makeChunkedServer( 50, 200 );

		const result = await runEmptyLoop( { emptyBin } );

		expect( emptyBin ).toHaveBeenCalledTimes( 1 );
		expect( result.purged ).toBe( 50 );
		expect( result.stoppedBecause ).toBe( 'empty' );
	} );

	test( 'reports incremental progress to the UI callback', async () => {
		const { emptyBin } = makeChunkedServer( 500, 200 );
		const progress: Array< { purged: number; initialTotal: number } > = [];

		await runEmptyLoop( {
			emptyBin,
			onProgress: ( p ) =>
				progress.push( { purged: p.purged, initialTotal: p.initialTotal } ),
		} );

		expect( progress ).toEqual( [
			{ purged: 200, initialTotal: 500 },
			{ purged: 400, initialTotal: 500 },
			{ purged: 500, initialTotal: 500 },
		] );
	} );

	test( 'stops when no progress is possible (everything skipped)', async () => {
		// Server always reports 200 skipped items the user cannot purge.
		const emptyBin = vi.fn(
			async (): Promise< EmptyResponse > => ( {
				purged: 0,
				skipped: 200,
				remaining: 200,
			} ),
		);

		const result = await runEmptyLoop( { emptyBin } );

		expect( emptyBin ).toHaveBeenCalledTimes( 1 );
		expect( result.skipped ).toBe( 200 );
		expect( result.stoppedBecause ).toBe( 'no-progress' );
	} );

	test( 'still makes progress on partial-skip chunks', async () => {
		// First call: 199 purged, 1 skipped, 1 still remaining.
		// Second call: that final 1 also gets skipped — bail.
		let n = 0;
		const emptyBin = vi.fn( async (): Promise< EmptyResponse > => {
			n++;
			if ( n === 1 ) {
				return { purged: 199, skipped: 1, remaining: 1 };
			}
			return { purged: 0, skipped: 1, remaining: 1 };
		} );

		const result = await runEmptyLoop( { emptyBin } );

		expect( emptyBin ).toHaveBeenCalledTimes( 2 );
		expect( result.purged ).toBe( 199 );
		expect( result.skipped ).toBe( 2 );
		expect( result.stoppedBecause ).toBe( 'no-progress' );
	} );

	test( 'respects the iteration cap to guard against a buggy server', async () => {
		// Server lies: claims it purged something but never reduces
		// `remaining`. Without a cap, the loop would never exit.
		const emptyBin = vi.fn(
			async (): Promise< EmptyResponse > => ( {
				purged: 1,
				skipped: 0,
				remaining: 9999,
			} ),
		);

		const result = await runEmptyLoop( { emptyBin, maxIterations: 5 } );

		expect( emptyBin ).toHaveBeenCalledTimes( 5 );
		expect( result.stoppedBecause ).toBe( 'iteration-cap' );
	} );
} );
