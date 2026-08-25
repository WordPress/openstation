/**
 * Boot-time session saver.
 *
 * Owns the debounced + immediate session persistence pipeline:
 * normal mutations schedule a debounced, rate-limited REST POST
 * through `trackedFetch`; unload-time saves use `navigator.sendBeacon`
 * with the nonce on the URL because WP REST's cookie-auth
 * middleware reads the nonce from `$_REQUEST` (URL query string +
 * form-encoded body), NOT from JSON bodies.
 *
 * Extracted from `src/desktop.ts` during the architecture-0.8.1
 * boot decomposition (phase 5).
 */

import { HOOKS, doAction } from '../hooks';
import { trackedFetch } from './tracked-fetch';
import { rememberRestoreTargets } from '../pwa/speculate';
import { withChromelessParam } from '../window/dom';
import type { WindowManager } from '../window-manager';
import type { DesktopConfig } from '../types';

/** Trailing-edge debounce window (ms) for the foreground saver. */
const SESSION_SAVE_DEBOUNCE_MS = 500;

/**
 * Floor (ms) between the starts of two consecutive network writes.
 *
 * The debounce alone only collapses changes that arrive closer
 * together than its own window. Closing three windows a beat apart
 * clears it every time and posts three times; so does a settling
 * in-flight save handing straight over to its queued successor. This
 * is the rate limit underneath the debounce — never more than one
 * write per interval, however the changes are spaced.
 *
 * Nothing is dropped to honour it: a save that arrives too soon is
 * delayed to the floor, and unload still flushes immediately.
 */
const SESSION_SAVE_MIN_INTERVAL_MS = 1500;

/**
 * Creates the debounced+immediate session saver. Returns a single
 * function that schedules a debounced REST write on each call.
 * Also exposed on `wp.os.saveSession()` for plugins that want
 * to flush.
 */
export function createSessionSaver(
	manager: WindowManager,
	config: DesktopConfig,
): () => void {
	let debounceTimer: number | null = null;
	let inFlight = false;
	let dirty = false;
	/** When the last network write started. 0 = none yet. */
	let lastSaveStartedAt = 0;

	const doSave = async (): Promise< void > => {
		if ( inFlight ) {
			// A save is already on the wire, and this call was
			// triggered by state the in-flight payload predates.
			// Dropping it here loses that mutation for good — the
			// debounce timer has already fired and cleared itself, so
			// nothing retries. Mark the session dirty instead and
			// re-run once the current request settles.
			//
			// Symptom of getting this wrong: close two windows in
			// quick succession on a slow connection, reload, and the
			// second one is back.
			dirty = true;
			return;
		}
		inFlight = true;
		lastSaveStartedAt = Date.now();
		// Snapshot as late as possible — after the in-flight guard —
		// so the payload reflects the state at send time, not at the
		// moment the save was queued.
		const payload = manager.snapshot();

		// Hand the worker the list of screens this session will
		// restore. It cannot use them now — it uses them on the NEXT
		// boot, where it is woken by the shell's own navigation and can
		// start fetching these documents in parallel with the server
		// building the shell, instead of ~3.9s later once the shell's
		// JavaScript exists to ask. See `rememberRestoreTargets()`.
		try {
			rememberRestoreTargets(
				payload.windows
					.filter( ( w ) => ! w.native && w.url )
					.map( ( w ) => withChromelessParam( w.url ) || '' )
					.filter( Boolean ),
			);
		} catch {
			// Never let a speculation hint break a session save.
		}

		try {
			// Session save is a debounced background ping — silent
			// so the user doesn't see a spinner every time they
			// move a window.
			await trackedFetch(
				manager,
				config.sessionUrl,
				{
					method: 'POST',
					credentials: 'same-origin',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': config.restNonce,
					},
					body: JSON.stringify( { session: payload } ),
					// Best-effort: we don't block the UI on persistence.
					keepalive: true,
				},
				{ silent: true },
			);
		} catch ( err ) {
			/* Network error is non-fatal — next change triggers
			 * another save. Still worth surfacing to monitor widgets
			 * so a connectivity regression doesn't go silent under
			 * the session-beacon path. */
			doAction( HOOKS.SHELL_ERROR, { scope: 'session-save', error: err } );
		} finally {
			inFlight = false;
			if ( dirty ) {
				dirty = false;
				// Back through `schedule()`, not straight into another
				// `doSave()`. Handing over directly would let a slow
				// request chain into an immediate second write and
				// sidestep both the debounce and the rate limit.
				schedule();
			}
		}
	};

	const flushImmediately = (): void => {
		if ( debounceTimer !== null ) {
			clearTimeout( debounceTimer );
			debounceTimer = null;
		}
		// The beacon below carries a snapshot taken right now, so it
		// supersedes any queued re-run. Clearing the flag keeps a
		// settling in-flight save from firing a redundant duplicate.
		dirty = false;
		// Use sendBeacon for unload-time saves where fetch may not
		// complete. WP REST's cookie-auth middleware reads the nonce
		// from `$_REQUEST` (URL query string + form-encoded body),
		// NOT from JSON bodies — so to satisfy auth we append the
		// nonce to the URL as a query param. Without this, the
		// beacon arrives but WP returns 403 before our handler runs,
		// and the session on disk stays at its pre-close state.
		// Symptom: close a window, reload fast, window reappears.
		const payload = manager.snapshot();
		const body = new Blob(
			[ JSON.stringify( { session: payload } ) ],
			{ type: 'application/json' },
		);
		const beaconUrl =
			config.sessionUrl +
			( config.sessionUrl.includes( '?' ) ? '&' : '?' ) +
			'_wpnonce=' +
			encodeURIComponent( config.restNonce );
		if (
			navigator.sendBeacon &&
			navigator.sendBeacon( beaconUrl, body )
		) {
			return;
		}
		void doSave();
	};

	const schedule = (): void => {
		if ( debounceTimer !== null ) {
			clearTimeout( debounceTimer );
		}
		// Trailing-edge debounce, then held back to the rate limit if
		// the previous write started too recently. Whichever wait is
		// longer governs — so a burst collapses to one write, and a
		// steady drip of changes still can't exceed one write per
		// interval. The delay only postpones; the last snapshot always
		// lands, and `pagehide` flushes past all of it.
		let wait = SESSION_SAVE_DEBOUNCE_MS;
		if ( lastSaveStartedAt !== 0 ) {
			const sinceLastSave = Date.now() - lastSaveStartedAt;
			wait = Math.max(
				wait,
				SESSION_SAVE_MIN_INTERVAL_MS - sinceLastSave,
			);
		}
		debounceTimer = window.setTimeout( () => {
			debounceTimer = null;
			void doSave();
		}, wait ) as unknown as number;
	};

	// pagehide is the reliable unload signal across browsers
	// (mobile Safari in particular never fires beforeunload in
	// the BFCache case).
	window.addEventListener( 'pagehide', flushImmediately );
	// Hidden tabs might never fire pagehide if the user switches
	// away and kills the browser — save opportunistically on
	// visibility change too.
	document.addEventListener( 'visibilitychange', () => {
		if ( document.visibilityState === 'hidden' ) {
			flushImmediately();
		}
	} );

	return schedule;
}
