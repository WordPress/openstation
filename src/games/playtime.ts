/**
 * Desktop Mode — game play-time tracker.
 *
 * The launcher starts one tracker per game window; it measures how
 * long the game is actually in front of the player — the clock
 * pauses while the window is minimized — and flushes whole-second
 * increments to `POST /games/{game}/playtime` once a minute plus a
 * final flush on close. Sub-second remainders carry over between
 * flushes so long sessions don't drift.
 *
 * A failed flush re-banks its seconds and retries on the next tick;
 * only a failure on the very last (close-time) flush is dropped.
 *
 * @since 0.9.7
 */

import { __, sprintf } from '../i18n';
import { recordPlaytime } from './rest';

/** How often accumulated play time is flushed to the server. */
const FLUSH_INTERVAL_MS = 60_000;

export interface PlaytimeTracker {
	/** Stop the clock (hosting window minimized). Idempotent. */
	pause: () => void;
	/** Restart the clock (hosting window restored). Idempotent. */
	resume: () => void;
	/** Final flush + release the interval. Idempotent. */
	stop: () => void;
}

/**
 * Start tracking play time for a game. The clock starts running
 * immediately.
 */
export function startPlaytimeTracker(
	gameId: string,
	opts: { windowId?: string } = {},
): PlaytimeTracker {
	let runningSince: number | null = Date.now();
	let bankedMs = 0;
	let stopped = false;

	const harvest = (): void => {
		if ( runningSince === null ) {
			return;
		}
		const now = Date.now();
		bankedMs += Math.max( 0, now - runningSince );
		runningSince = now;
	};

	const flush = (): void => {
		harvest();
		const seconds = Math.floor( bankedMs / 1000 );
		if ( seconds < 1 ) {
			return;
		}
		bankedMs -= seconds * 1000;
		recordPlaytime( gameId, seconds, {
			windowId: opts.windowId,
			silent: true,
		} ).catch( () => {
			// Transient failure — put the seconds back so the next
			// flush retries them. After stop() no tick remains, so a
			// failed final flush is simply dropped.
			bankedMs += seconds * 1000;
		} );
	};

	const interval = setInterval( flush, FLUSH_INTERVAL_MS );

	return {
		pause: () => {
			harvest();
			runningSince = null;
		},
		resume: () => {
			if ( stopped || runningSince !== null ) {
				return;
			}
			runningSince = Date.now();
		},
		stop: () => {
			if ( stopped ) {
				return;
			}
			stopped = true;
			clearInterval( interval );
			harvest();
			runningSince = null;
			flush();
		},
	};
}

/**
 * Sum the daily play-time buckets falling inside the trailing
 * `windowDays`-day window ending at `todayKey` (both `YYYY-MM-DD`,
 * as served by `GET /games/playtime`). Backs the Steam-style
 * "last two weeks" figure — pass `windowDays: 14`.
 */
export function sumPlaytimeSince(
	daily: Record< string, number >,
	todayKey: string,
	windowDays: number,
): number {
	const today = new Date( `${ todayKey }T00:00:00Z` );
	if ( isNaN( today.getTime() ) || windowDays < 1 ) {
		return 0;
	}
	const cutoff = new Date(
		today.getTime() - ( windowDays - 1 ) * 86_400_000,
	)
		.toISOString()
		.slice( 0, 10 );
	let sum = 0;
	for ( const [ day, seconds ] of Object.entries( daily ) ) {
		// `YYYY-MM-DD` sorts lexicographically; clock-skewed future
		// buckets past the server's own "today" are ignored.
		if ( day >= cutoff && day <= todayKey ) {
			sum += Math.max( 0, Math.floor( Number( seconds ) || 0 ) );
		}
	}
	return sum;
}

/**
 * Format an accumulated play-time total for display: `2h 14m`,
 * `14m`, or `45s`.
 */
export function formatPlaytime( seconds: number ): string {
	const total = Math.max( 0, Math.floor( Number( seconds ) || 0 ) );
	const hours = Math.floor( total / 3600 );
	const minutes = Math.floor( ( total % 3600 ) / 60 );
	if ( hours > 0 ) {
		return sprintf(
			/* translators: 1: hours, 2: minutes. */
			__( '%1$dh %2$dm' ),
			hours,
			minutes,
		);
	}
	if ( minutes > 0 ) {
		/* translators: %d: minutes. */
		return sprintf( __( '%dm' ), minutes );
	}
	/* translators: %d: seconds. */
	return sprintf( __( '%ds' ), total );
}
