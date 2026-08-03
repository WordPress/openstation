/**
 * Boot-time session saver.
 *
 * Owns the debounced + immediate session persistence pipeline:
 * normal mutations schedule a debounced REST POST through
 * `trackedFetch`; unload-time saves use `navigator.sendBeacon`
 * with the nonce on the URL because WP REST's cookie-auth
 * middleware reads the nonce from `$_REQUEST` (URL query string +
 * form-encoded body), NOT from JSON bodies.
 *
 * Extracted from `src/desktop.ts` during the architecture-0.8.1
 * boot decomposition (phase 5).
 */

import { HOOKS, doAction } from '../hooks';
import { trackedFetch } from './tracked-fetch';
import type { WindowManager } from '../window-manager';
import type { DesktopConfig } from '../types';

/** Trailing-edge debounce window (ms) for the foreground saver. */
const SESSION_SAVE_DEBOUNCE_MS = 500;

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

	const doSave = async (): Promise< void > => {
		if ( inFlight ) {
			return;
		}
		const payload = manager.snapshot();
		inFlight = true;
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
		}
	};

	const flushImmediately = (): void => {
		if ( debounceTimer !== null ) {
			clearTimeout( debounceTimer );
			debounceTimer = null;
		}
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
		debounceTimer = window.setTimeout( () => {
			debounceTimer = null;
			void doSave();
		}, SESSION_SAVE_DEBOUNCE_MS ) as unknown as number;
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
