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
import type { DesktopConfig, Session } from '../types';

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
 * What a snapshot says, minus when it said it.
 *
 * `updated` is stamped `Date.now()` on every snapshot, so two reads of
 * an untouched desktop never compare equal on the raw payload. Strip
 * it and the rest IS the session: the same string means the server
 * already holds exactly this, and a write would only bump a clock.
 *
 * @param payload A session snapshot.
 * @return The snapshot as a comparable string.
 */
function fingerprint( payload: Session ): string {
	const { updated, ...rest } = payload;
	void updated;
	return JSON.stringify( rest );
}

/**
 * Creates the debounced+immediate session saver. Returns a single
 * function that schedules a debounced REST write on each call.
 * Also exposed on `wp.os.saveSession()` for plugins that want
 * to flush.
 */
/**
 * Hand the worker the list of screens this session would restore.
 *
 * It cannot use them now — it uses them on the NEXT boot, where it is
 * woken by the shell's own navigation and can start fetching these
 * documents in parallel with the server building the shell, instead of
 * ~3.9s later once the shell's JavaScript exists to ask. See
 * `rememberRestoreTargets()`.
 *
 * Gated on the same opt-in every other speculation call site reads, so
 * "off by default" means a user who never touched the setting does not
 * even pay the postMessage. Called from both save paths: the debounced
 * one and the unload beacon.
 *
 * @param payload The session snapshot about to be persisted.
 */
function noteRestoreTargets( payload: Session ): void {
	try {
		const os = (
			window as unknown as {
				wp?: {
					os?: {
						getOsSettings?: () => { windowPrewarmEnabled?: boolean };
					};
				};
			}
		).wp?.os;
		if ( ! os?.getOsSettings?.().windowPrewarmEnabled ) {
			return;
		}
		rememberRestoreTargets(
			payload.windows
				.filter( ( w ) => ! w.native && w.url )
				.map( ( w ) => withChromelessParam( w.url ) || '' )
				.filter( Boolean ),
		);
	} catch {
		// Never let a speculation hint break a session save.
	}
}

/**
 * The saver. Calling it schedules a debounced write; `flush()` writes
 * now and resolves once the server has answered.
 */
export type SessionSaver = ( () => void ) & {
	flush: () => Promise< void >;
};

export function createSessionSaver(
	manager: WindowManager,
	config: DesktopConfig,
): SessionSaver {
	let debounceTimer: number | null = null;
	let inFlight = false;
	let dirty = false;
	/**
	 * The write on the wire, while there is one. `flush()` waits on it
	 * before taking its own snapshot, so a save that predates the state
	 * being flushed is never the last word.
	 */
	let activeSave: Promise< void > | null = null;
	/** When the last network write started. 0 = none yet. */
	let lastSaveStartedAt = 0;
	/**
	 * The session as the server last accepted it — a write that got a
	 * 2xx, or a beacon, which is fire-and-forget and the page's last
	 * word either way. `null` until the first one lands.
	 *
	 * Most calls to the saver are not changes. Every pointerdown in a
	 * window re-focuses it, and `os-window-focused` fires whether or
	 * not the focus moved; the app runtime re-emits state changes
	 * that persist nothing. Each of those used to be a POST carrying
	 * the same session the server already held. Comparing here, at
	 * send time, is what makes the saver honest about it: a snapshot
	 * equal to the last accepted one is not sent, whatever asked.
	 */
	let lastAccepted: string | null = null;

	const doSave = (): Promise< void > => {
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
			return Promise.resolve();
		}
		// Snapshot as late as possible — after the in-flight guard —
		// so the payload reflects the state at send time, not at the
		// moment the save was queued.
		const payload = manager.snapshot();
		const current = fingerprint( payload );
		if ( current === lastAccepted ) {
			// Nothing changed since the server last heard from us.
			// The rate-limit clock stays where it was: no write went
			// out, so the next real change owes nothing to this one.
			return Promise.resolve();
		}
		inFlight = true;
		lastSaveStartedAt = Date.now();

		noteRestoreTargets( payload );

		activeSave = ( async () => {
			try {
				// Session save is a debounced background ping — silent
				// so the user doesn't see a spinner every time they
				// move a window.
				const response = await trackedFetch(
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
				// Only a write the server took counts. A 403 from an
				// expired nonce, or a 5xx, leaves the server on the older
				// session, and the next change must carry this one again.
				if ( response?.ok ) {
					lastAccepted = current;
				}
			} catch ( err ) {
				/* Network error is non-fatal — next change triggers
				 * another save. Still worth surfacing to monitor widgets
				 * so a connectivity regression doesn't go silent under
				 * the session-beacon path. */
				doAction( HOOKS.SHELL_ERROR, { scope: 'session-save', error: err } );
			} finally {
				inFlight = false;
				activeSave = null;
				if ( dirty ) {
					dirty = false;
					// Back through `schedule()`, not straight into another
					// `doSave()`. Handing over directly would let a slow
					// request chain into an immediate second write and
					// sidestep both the debounce and the rate limit.
					schedule();
				}
			}
		} )();
		return activeSave;
	};

	/**
	 * Write now, and resolve once the server has answered.
	 *
	 * For the one caller about to leave the page on purpose — the
	 * reload the shell offers after a deploy changed its files. The
	 * unload beacon is fire-and-forget, and a navigation started in
	 * the same breath can have the server read the session back before
	 * the beacon's write lands; the desktop then comes back as the
	 * older snapshot. Waiting for the answer is the whole difference.
	 * A write already on the wire finishes first, since its snapshot
	 * may predate the state being flushed. Never rejects: a failed
	 * write is the same best-effort it always was, and the caller
	 * navigates either way.
	 */
	const flush = async (): Promise< void > => {
		if ( debounceTimer !== null ) {
			clearTimeout( debounceTimer );
			debounceTimer = null;
		}
		while ( activeSave ) {
			await activeSave;
		}
		dirty = false;
		await doSave();
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
		const current = fingerprint( payload );
		if ( current === lastAccepted ) {
			// The server already holds this exact session; a beacon
			// would only re-stamp its clock as the tab goes away.
			return;
		}
		// The unload snapshot is the most accurate one there is — it is
		// taken as the tab goes away, after the last window the user
		// closed or opened. Skipping it here would leave the worker
		// replaying whichever debounced save happened to land last, so
		// a window closed just before exit would still be speculated on
		// the next boot (and one opened just before exit would not be).
		// That is precisely the "close it and come straight back"
		// moment this is for.
		noteRestoreTargets( payload );
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
			// A beacon reports nothing back. Treat it as accepted: it
			// is the page's last word, and if the tab survives (a
			// background tab that comes back), a snapshot equal to it
			// has nothing new to say either.
			lastAccepted = current;
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

	return Object.assign( schedule, { flush } );
}
