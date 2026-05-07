/**
 * Cross-bundle bridge to the framework's tracked fetch.
 *
 * The canonical implementation lives in `src/desktop.ts`
 * (`trackedFetch( manager, … )`) and is exposed as
 * `wp.desktop.fetch`. This module is the tiny lookup wrapper
 * that finds the public function at runtime, so any module —
 * the main bundle, separate Vite targets, plugin-side scripts —
 * can route through the framework helper with the same import.
 *
 * Routing every request through the framework is what gives
 * native windows the free loading spinner + activity-bus feed
 * (every request is attributed to the active window).
 *
 * Falls back to the native `fetch` only when the desktop
 * bundle hasn't booted yet (rare; tests, headless paths). All
 * in-shell callers should hit the framework helper.
 *
 * @since 0.9.0
 */

export interface TrackedFetchOpts {
	windowId?: string;
	source?: string;
	/**
	 * Track but suppress the activity-bus pulse. Use for genuinely
	 * background pings the user did not initiate (session save,
	 * badge polls). The runtime accepts this field on
	 * `wp.desktop.fetch`; declared here so the typed wrapper can
	 * forward it without needing per-feature widening.
	 *
	 * @since 1.0.0
	 */
	silent?: boolean;
}

export function trackedFetch(
	input: RequestInfo,
	init?: RequestInit,
	opts: TrackedFetchOpts = {},
): Promise< Response > {
	const fn = ( window.wp as
		| { desktop?: { fetch?: ( i: RequestInfo, ri?: RequestInit, o?: TrackedFetchOpts ) => Promise< Response > } }
		| undefined )?.desktop?.fetch;
	if ( typeof fn === 'function' ) {
		return fn( input, init, opts );
	}
	// eslint-disable-next-line no-restricted-syntax -- this IS the framework-fetch wrapper; the boot fallback before `wp.desktop` exists is the one legitimate use of raw fetch in the codebase.
	return fetch( input, init );
}
