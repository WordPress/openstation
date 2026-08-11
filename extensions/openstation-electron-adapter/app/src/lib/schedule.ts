/**
 * OpenStation Desktop — heartbeat pacing.
 *
 * Every liveness beat is a real PHP request, and OpenStation runs on
 * €3/month shared hosting as happily as on a VPS. The decisions about
 * *when* to beat therefore matter more than the beat itself, so they
 * live here as pure functions with tests rather than as arithmetic
 * buried in a timer callback.
 *
 * Three rules, in the order they apply:
 *
 *   1. **The server picks the interval.** It arrives in every
 *      handshake and heartbeat response, so a site under pressure can
 *      widen the pulse via a PHP filter and every desktop that has it
 *      open obeys within one beat — no new build of this app.
 *   2. **Idle costs less.** When no OpenStation window has been
 *      focused since the last successful beat and nothing is freed
 *      onto the desktop, beats are skipped. A laptop left open on
 *      another app is not worth a request a minute.
 *   3. **Failure backs off.** Consecutive errors widen the interval
 *      geometrically, so a site that went down is not hammered by
 *      every desktop that had it open.
 */

/** Fallback when the server does not send one. Milliseconds. */
export const DEFAULT_INTERVAL = 120000;
/** Never beat faster than this, whatever the server asks for. */
export const MIN_INTERVAL = 30000;
/** How many intervals an idle app skips before beating anyway. */
export const IDLE_MULTIPLIER = 4;
/** Ceiling for the failure backoff, as a multiple of the interval. */
export const MAX_BACKOFF = 8;

/**
 * Apply the floor to a server-supplied interval.
 *
 * A server asking for a *faster* pulse than `MIN_INTERVAL` is either
 * misconfigured or hostile, and either way this app is the one paying
 * the request. The floor is not negotiable from the wire.
 *
 * @param value    Interval the server asked for, in milliseconds.
 * @param fallback Used when the value is missing or unparseable.
 * @return Interval to use.
 */
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

/** Everything the skip decision depends on. */
export interface IdleState {
	/** Has any app window been focused since the last beat? */
	activeSinceLastBeat: boolean;
	/** Is at least one window currently freed onto the desktop? */
	hasFreedWindows: boolean;
	/** How many beats have been skipped in a row already. */
	skips: number;
}

/**
 * Whether this beat should be skipped.
 *
 * A freed window is treated as activity even when nothing is focused:
 * it is a live surface the user can see and interact with, and a
 * server that thinks the desktop went away while a native window sits
 * on screen is telling other plugins something false.
 *
 * @param state Idle inputs.
 * @return True to skip and reschedule without a request.
 */
export function shouldSkipBeat( state: IdleState ): boolean {
	if ( state.activeSinceLastBeat || state.hasFreedWindows ) {
		return false;
	}
	return state.skips < IDLE_MULTIPLIER - 1;
}

/**
 * How long to wait before the next beat.
 *
 * @param interval Current interval in milliseconds.
 * @param failures Consecutive failures so far.
 * @return Delay in milliseconds.
 */
export function nextDelay( interval: number, failures: number ): number {
	const backoff = Math.min( MAX_BACKOFF, Math.max( 1, failures ) );
	return interval * backoff;
}
