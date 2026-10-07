import { __, sprintf } from '../i18n';
import { recordPlaytime } from './rest';

const FLUSH_INTERVAL_MS = 60_000;

export interface PlaytimeTracker {

	pause: () => void;

	resume: () => void;

	stop: () => void;
}

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
		if ( day >= cutoff && day <= todayKey ) {
			sum += Math.max( 0, Math.floor( Number( seconds ) || 0 ) );
		}
	}
	return sum;
}

export function formatPlaytime( seconds: number ): string {
	const total = Math.max( 0, Math.floor( Number( seconds ) || 0 ) );
	const hours = Math.floor( total / 3600 );
	const minutes = Math.floor( ( total % 3600 ) / 60 );
	if ( hours > 0 ) {
		return sprintf(

			__( '%1$dh %2$dm' ),
			hours,
			minutes,
		);
	}
	if ( minutes > 0 ) {
		return sprintf( __( '%dm' ), minutes );
	}

	return sprintf( __( '%ds' ), total );
}
