export const DEFAULT_INTERVAL = 120000;

export const MIN_INTERVAL = 30000;

export const IDLE_MULTIPLIER = 4;

export const MAX_BACKOFF = 8;

export function clampInterval(
	value: unknown,
	fallback: number = DEFAULT_INTERVAL,
): number {
	const parsed = Number( value );
	if ( ! Number.isFinite( parsed ) || parsed <= 0 ) {
		return fallback;
	}
	return Math.max( MIN_INTERVAL, parsed );
}

export interface IdleState {

	activeSinceLastBeat: boolean;

	hasFreedWindows: boolean;

	skips: number;
}

export function shouldSkipBeat( state: IdleState ): boolean {
	if ( state.activeSinceLastBeat || state.hasFreedWindows ) {
		return false;
	}
	return state.skips < IDLE_MULTIPLIER - 1;
}

export function nextDelay( interval: number, failures: number ): number {
	const backoff = Math.min( MAX_BACKOFF, Math.max( 1, failures ) );
	return interval * backoff;
}
