/**
 * Recycle Bin — empty-loop driver.
 *
 * The server caps `desktop_mode_recycle_bin_empty()` at one chunk per
 * call (default 200 items) to avoid PHP timeouts on large bins. The
 * client therefore has to iterate until the server reports
 * `remaining === 0`. This helper owns that loop in isolation so the
 * window code can stay focused on UI wiring AND so we can unit-test
 * the iteration shape without spinning up a JSDOM table.
 *
 * Termination rules (in order):
 *
 *   1. `remaining === 0` — bin is empty, we're done.
 *   2. `purged === 0 && skipped > 0` — every item left is
 *      capability-blocked; further calls just re-skip the same set.
 *   3. Hard iteration ceiling (1000) — last-resort guard against a
 *      buggy server whose `remaining` never decreases despite
 *      `purged > 0`. Far above any realistic bin size.
 *
 * @since 0.21.1
 */

import type { EmptyResponse } from './rest';

export interface EmptyProgress {
	/** Items purged across all calls so far. */
	purged: number;
	/** Items skipped across all calls so far. */
	skipped: number;
	/** Snapshot of `purged + remaining` taken on the first call. */
	initialTotal: number;
}

export interface EmptyLoopResult extends EmptyProgress {
	/** Final `remaining` reported by the server on the last call. */
	remaining: number;
	/** Reason the loop stopped — useful for tests + observability. */
	stoppedBecause: 'empty' | 'no-progress' | 'iteration-cap';
}

export interface EmptyLoopOptions {
	/** Per-iteration server call. Injected so tests can stub it. */
	emptyBin: () => Promise< EmptyResponse >;
	/** Optional progress callback fired after every server call. */
	onProgress?: ( progress: EmptyProgress ) => void;
	/** Hard iteration cap. Defaults to 1000. */
	maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 1000;

export async function runEmptyLoop(
	options: EmptyLoopOptions,
): Promise< EmptyLoopResult > {
	const { emptyBin, onProgress, maxIterations = DEFAULT_MAX_ITERATIONS } = options;

	let purged = 0;
	let skipped = 0;
	let initialTotal = 0;
	let remaining = 0;
	let stoppedBecause: EmptyLoopResult[ 'stoppedBecause' ] = 'iteration-cap';

	for ( let i = 0; i < maxIterations; i++ ) {
		// eslint-disable-next-line no-await-in-loop
		const result = await emptyBin();
		purged += result.purged;
		skipped += result.skipped;
		remaining = result.remaining;
		if ( i === 0 ) {
			initialTotal = purged + result.remaining;
		}
		onProgress?.( { purged, skipped, initialTotal } );

		if ( result.remaining === 0 ) {
			stoppedBecause = 'empty';
			break;
		}
		if ( result.purged === 0 && result.skipped > 0 ) {
			stoppedBecause = 'no-progress';
			break;
		}
	}

	return { purged, skipped, initialTotal, remaining, stoppedBecause };
}
