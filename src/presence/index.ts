/**
 * Framework-level presence client.
 *
 * Tracks who's currently in the desktop-mode WP-Admin and what
 * their state is — `online`, `inactive`, `offline`. This module
 * lives at framework level (not inside any feature module) so any
 * plugin — chat, collaboration, presence-aware UI — can read
 * `wp.desktop.presence.*` without depending on a particular
 * feature plugin being installed.
 *
 * **State machine.**
 *
 *   - **online**   — server saw a heartbeat within
 *                    `_offline_after` seconds AND user activity
 *                    (mousedown / keydown) within
 *                    `_inactive_after` seconds.
 *   - **inactive** — heartbeat present but no recent user activity.
 *   - **offline**  — no heartbeat in `_offline_after` seconds.
 *
 * **Storage.** A `createSharedStore` keyed by
 * `'wp-desktop/presence'` so any number of bundles can subscribe to
 * the same map of `{ status, lastSeenMs, lastActiveMs }` per user.
 *
 * **Wire.** A jQuery-Heartbeat probe sends
 * `wp_desktop_presence_active: true` + `wp_desktop_user_active:
 * <bool>` on every tick; the server (`includes/presence.php`)
 * records the bump and returns a snapshot in the response, which
 * lands in the shared store.
 *
 * @since 0.5.5
 */

import { activity } from '../activity';
import { heartbeat } from '../heartbeat';
import { createSharedStore, type SharedStore } from '../shared-store';

export type PresenceStatus = 'online' | 'inactive' | 'offline';

export interface PresenceEntry {
	status: PresenceStatus;
	lastSeenMs: number;
	lastActiveMs: number;
}

interface PresenceState {
	byUser: Map< number, PresenceEntry >;
	serverTimeMs: number;
}

interface HeartbeatBlock {
	snapshot?: Record< string, { status?: PresenceStatus; lastSeenMs?: number; lastActiveMs?: number } >;
	serverTimeMs?: number;
}

const store: SharedStore< PresenceState > = createSharedStore< PresenceState >(
	'wp-desktop/presence',
	() => ( { byUser: new Map(), serverTimeMs: 0 } ),
);

/**
 * How fresh "active" needs to be for the heartbeat probe to flag
 * it. Match the server's default `_inactive_after` threshold: the
 * client should report `userActive: true` when the last input is
 * within the inactive window so server-side state stays
 * consistent.
 */
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min

let lastInputMs = Date.now();
let booted = false;

function noteUserActivity(): void {
	lastInputMs = Date.now();
}

/**
 * Apply a server snapshot — replaces the in-memory map for users
 * we received and emits a state-change CustomEvent for each user
 * whose status flipped. We don't drop users not in the snapshot
 * (they may simply not be visible to this viewer) — the server
 * controls visibility via `wp_desktop_presence_visible_users`.
 */
function applySnapshot( block: HeartbeatBlock ): void {
	if ( ! block || ! block.snapshot ) {
		return;
	}
	const previous = store.state.byUser;
	const next = new Map< number, PresenceEntry >( previous );
	const transitions: Array< {
		userId: number;
		oldStatus: PresenceStatus | null;
		newStatus: PresenceStatus;
		entry: PresenceEntry;
	} > = [];

	for ( const [ rawId, raw ] of Object.entries( block.snapshot ) ) {
		const userId = Number( rawId );
		if ( ! Number.isFinite( userId ) || userId <= 0 ) {
			continue;
		}
		const status = ( raw?.status ?? 'offline' ) as PresenceStatus;
		const entry: PresenceEntry = {
			status,
			lastSeenMs: Number( raw?.lastSeenMs ?? 0 ) || 0,
			lastActiveMs: Number( raw?.lastActiveMs ?? 0 ) || 0,
		};
		const old = previous.get( userId );
		next.set( userId, entry );
		if ( ! old || old.status !== entry.status ) {
			transitions.push( {
				userId,
				oldStatus: old ? old.status : null,
				newStatus: entry.status,
				entry,
			} );
		}
	}

	store.state.byUser = next;
	if ( typeof block.serverTimeMs === 'number' ) {
		store.state.serverTimeMs = block.serverTimeMs;
	}
	store.notify();

	for ( const t of transitions ) {
		const detail = {
			userId: t.userId,
			oldStatus: t.oldStatus,
			newStatus: t.newStatus,
			lastSeenMs: t.entry.lastSeenMs,
			lastActiveMs: t.entry.lastActiveMs,
		};
		document.dispatchEvent(
			new CustomEvent( 'wp-desktop-presence-changed', { detail } ),
		);
		// Mirror the per-transition event onto activity so plugins
		// subscribe through the unified API.
		activity.publish( 'wp-desktop/presence-changed', detail );
	}
	// Batch-level activity event — useful for "repaint everything
	// that depends on presence" subscribers that don't need
	// per-user granularity.
	activity.publish( 'wp-desktop/presence-snapshot-applied', {
		applied: Object.keys( block.snapshot ).length,
		transitions: transitions.length,
	} );
}

/**
 * Boot the framework presence probe once per page. Safe to call
 * multiple times — only the first call wires anything up.
 *
 * Hooks the WordPress Heartbeat:
 *   - `heartbeat-send` — adds `wp_desktop_presence_active: true` +
 *     `wp_desktop_user_active: <recent input?>` so the server's
 *     handler bumps the right slot.
 *   - `heartbeat-tick` — reads `response.wp_desktop_presence` and
 *     applies the snapshot to the shared store.
 *
 * Also subscribes a one-time `pointerdown` / `keydown` listener so
 * "user active" reflects live input rather than just "tab open."
 */
export function bootPresenceProbe(): void {
	if ( booted ) {
		return;
	}
	booted = true;

	document.addEventListener( 'pointerdown', noteUserActivity, {
		capture: true,
		passive: true,
	} );
	document.addEventListener( 'keydown', noteUserActivity, {
		capture: true,
		passive: true,
	} );

	// Visibility transitions — when the tab comes back into view we
	// want the next heartbeat to mark us active. Independent of the
	// pointer/key listeners because no input may follow the un-hide.
	document.addEventListener( 'visibilitychange', () => {
		if ( ! document.hidden ) {
			noteUserActivity();
		}
	} );

	// Route through the framework's shared Heartbeat bus so the
	// jQuery boilerplate lives in `src/heartbeat.ts` only.
	heartbeat.contribute( 'wp_desktop_presence_active', () => true );
	heartbeat.contribute(
		'wp_desktop_user_active',
		() => Date.now() - lastInputMs < ACTIVE_THRESHOLD_MS,
	);
	heartbeat.subscribe< HeartbeatBlock >( 'wp_desktop_presence', ( block ) => {
		applySnapshot( block );
	} );
}

/* ------------------------------------------------------------------------- *
 * Public API surface — used by `wp.desktop.presence.*`
 * ------------------------------------------------------------------------- */

/**
 * Read the current status of a single user. Returns `'offline'`
 * for users that aren't tracked yet (including the viewer's own
 * id when their first heartbeat hasn't landed). Cheap O(1) lookup
 * against the shared store.
 */
export function getStatus( userId: number ): PresenceStatus {
	const entry = store.state.byUser.get( userId );
	return entry ? entry.status : 'offline';
}

/**
 * Read the full presence map. Returns a clone so callers can
 * iterate without holding a reference to the live store.
 */
export function getAll(): Map< number, PresenceEntry > {
	return new Map( store.state.byUser );
}

/**
 * Read a specific user's full record (`{ status, lastSeenMs,
 * lastActiveMs }`) or `null` when untracked.
 */
export function getEntry( userId: number ): PresenceEntry | null {
	return store.state.byUser.get( userId ) ?? null;
}

/**
 * Subscribe to presence-state changes. Fires on every heartbeat
 * tick that lands a snapshot, even when no statuses changed —
 * subscribers are expected to be cheap re-renders.
 *
 * Returns an unsubscribe function.
 */
export function subscribe(
	cb: ( state: { byUser: ReadonlyMap< number, PresenceEntry >; serverTimeMs: number } ) => void,
): () => void {
	return store.subscribe( ( s ) => cb( s ) );
}

/**
 * Force the next heartbeat tick to mark the current user as
 * active even if no recent input fired the listeners. Useful for
 * synthetic "I'm here" pings — e.g., after a modal-driven
 * interaction the input listeners can't see.
 */
export function markActive(): void {
	noteUserActivity();
}

/**
 * Test-only reset: clears the boot guard and the activity
 * timestamp so an isolated test can re-`bootPresenceProbe()` from
 * a clean slate. Production code never calls this.
 *
 * @internal
 */
export function _resetPresenceForTests(): void {
	booted = false;
	lastInputMs = Date.now();
}

/**
 * Push a batch of presence updates into the framework store.
 *
 * Used by feature plugins that have a faster delivery channel
 * than the main heartbeat — e.g. an SSE stream that emits sub-
 * second presence events. Calling `applyBatch` lands those updates
 * in the same store as the heartbeat snapshot so any consumer
 * (presence-driven UI, plugin badges) sees the freshest data
 * without picking between two stores.
 *
 * Fires `wp-desktop-presence-changed` per id whose status moves,
 * mirroring the heartbeat-driven path. `lastSeenMs` and
 * `lastActiveMs` are optional — when omitted, the existing
 * timestamps are preserved (the writer doesn't always know them).
 *
 * @since 0.5.5
 */
export function applyPresenceBatch(
	updates: Array< {
		userId: number;
		status: PresenceStatus;
		lastSeenMs?: number;
		lastActiveMs?: number;
	} >,
): void {
	if ( ! Array.isArray( updates ) || updates.length === 0 ) {
		return;
	}
	const previous = store.state.byUser;
	const next = new Map< number, PresenceEntry >( previous );
	const transitions: Array< {
		userId: number;
		oldStatus: PresenceStatus | null;
		newStatus: PresenceStatus;
		entry: PresenceEntry;
	} > = [];
	for ( const u of updates ) {
		const userId = Number( u.userId );
		if ( ! Number.isFinite( userId ) || userId <= 0 ) {
			continue;
		}
		const old = previous.get( userId );
		const entry: PresenceEntry = {
			status: u.status,
			lastSeenMs:
				typeof u.lastSeenMs === 'number'
					? u.lastSeenMs
					: old?.lastSeenMs ?? 0,
			lastActiveMs:
				typeof u.lastActiveMs === 'number'
					? u.lastActiveMs
					: old?.lastActiveMs ?? 0,
		};
		next.set( userId, entry );
		if ( ! old || old.status !== entry.status ) {
			transitions.push( {
				userId,
				oldStatus: old ? old.status : null,
				newStatus: entry.status,
				entry,
			} );
		}
	}
	if ( transitions.length === 0 && next.size === previous.size ) {
		// Nothing actually changed — skip the notify to avoid
		// a no-op repaint storm on hot-loop callers.
		return;
	}
	store.state.byUser = next;
	store.notify();
	for ( const t of transitions ) {
		const detail = {
			userId: t.userId,
			oldStatus: t.oldStatus,
			newStatus: t.newStatus,
			lastSeenMs: t.entry.lastSeenMs,
			lastActiveMs: t.entry.lastActiveMs,
		};
		document.dispatchEvent(
			new CustomEvent( 'wp-desktop-presence-changed', { detail } ),
		);
		activity.publish( 'wp-desktop/presence-changed', detail );
	}
	activity.publish( 'wp-desktop/presence-snapshot-applied', {
		applied: updates.length,
		transitions: transitions.length,
	} );
}

/**
 * Public API surface that lands on `wp.desktop.presence`. Kept as a
 * frozen object so plugins can destructure stably and so a typo
 * fails at registration time rather than silently overwriting a
 * built-in.
 *
 * `applyBatch` is the public alias for the internal `applyPresenceBatch`
 * — feature modules with a faster delivery channel than the heartbeat
 * (e.g. an SSE stream that emits per-conversation presence events) push
 * batches into the framework store so any plugin reading
 * `wp.desktop.presence.getStatus` sees the freshest data.
 */
export const presenceApi = Object.freeze( {
	getStatus,
	getAll,
	getEntry,
	subscribe,
	markActive,
	applyBatch: applyPresenceBatch,
} );

export type PresenceApi = typeof presenceApi;
