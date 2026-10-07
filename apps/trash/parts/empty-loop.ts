import type { EmptyResponse } from './types';

export interface EmptyProgress {

	purged: number;

	skipped: number;

	initialTotal: number;
}

export interface EmptyLoopResult extends EmptyProgress {

	remaining: number;

	stoppedBecause: 'empty' | 'no-progress' | 'iteration-cap';
}

export interface EmptyLoopOptions {

	emptyBin: () => Promise< EmptyResponse >;

	onProgress?: ( progress: EmptyProgress ) => void;

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
