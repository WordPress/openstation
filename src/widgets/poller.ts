/**
 * Visibility-aware polling helper for widgets.
 *
 * A desktop widget that refreshes on a timer keeps polling at full
 * rate in a hidden tab — the user isn't looking, the data repaints
 * for nobody, and the requests still hit the server. WP Heartbeat
 * already backs off when the tab hides; widget `setInterval` pollers
 * historically didn't. This helper gives them the same behavior:
 *
 *   - the interval only runs while the document is visible;
 *   - hiding the tab stops the timer entirely (zero requests);
 *   - revealing the tab restarts the timer, and triggers an
 *     immediate catch-up refresh only when the last run is older
 *     than one interval — rapid tab flips cost nothing.
 *
 * Leaf module with no side effects — safe to import from any widget
 * bundle without dragging shell code along.
 *
 * @package
 */

export interface VisibilityAwarePoller {
	/** Stop polling and detach the visibilitychange listener. */
	stop: () => void;
}

/**
 * Start polling `refresh` every `intervalMs`, pausing while the
 * document is hidden.
 *
 * The caller is expected to have just run its initial refresh (the
 * mount-time paint) — the helper treats "now" as the last run, so
 * the first timed refresh lands one full interval later.
 *
 * @param refresh    Callback to run on each poll. A returned promise
 *                   is intentionally not awaited — overlap control
 *                   stays the caller's concern, matching the plain
 *                   `setInterval` semantics this replaces.
 * @param intervalMs Poll cadence in milliseconds.
 * @return Handle with a `stop()` teardown.
 */
export function startVisibilityAwarePoller(
	refresh: () => void | Promise< void >,
	intervalMs: number,
): VisibilityAwarePoller {
	let intervalId: ReturnType< typeof setInterval > | null = null;
	let lastRunMs = Date.now();

	const run = (): void => {
		lastRunMs = Date.now();
		void refresh();
	};

	const startInterval = (): void => {
		if ( intervalId === null ) {
			intervalId = setInterval( run, intervalMs );
		}
	};

	const stopInterval = (): void => {
		if ( intervalId !== null ) {
			clearInterval( intervalId );
			intervalId = null;
		}
	};

	const onVisibilityChange = (): void => {
		if ( document.hidden ) {
			stopInterval();
			return;
		}
		if ( Date.now() - lastRunMs >= intervalMs ) {
			run();
		}
		startInterval();
	};

	document.addEventListener( 'visibilitychange', onVisibilityChange );
	if ( ! document.hidden ) {
		startInterval();
	}

	return {
		stop(): void {
			stopInterval();
			document.removeEventListener( 'visibilitychange', onVisibilityChange );
		},
	};
}
