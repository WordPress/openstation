/**
 * Content-changes Heartbeat catch-all.
 *
 * The chromeless-footer fast path (`includes/content-changes.php`)
 * and the block-editor save-watcher only cover mutations that happen
 * inside this tab's iframes AND produce either a footer render or a
 * `core/editor` save. Everything else — Quick Edit, list-table AJAX
 * moderation, WooCommerce AJAX status flips, REST/WP-CLI mutations,
 * other browser tabs, other users — reaches the shell through this
 * module: the server appends every recorded change to a pruned
 * changelog option, and each Heartbeat tick answers "entries newer
 * than your seen ts". Fresh entries are re-broadcast on the bus as
 * `desktop-mode.<type>.changed`, so the same consumers (iframe
 * soft-reload, native list windows) refresh within one tick
 * (15–60 s) with zero extra plumbing.
 *
 * Timestamps are SERVER milliseconds. The first tick is a pure
 * handshake: it sends `seenTs: 0`, adopts the server's high-water
 * mark, and broadcasts nothing — comparing a client `Date.now()`
 * against server timestamps would silently drop changes whenever the
 * clocks disagree (a change recorded "before" a skewed client boot
 * time is never re-broadcast). Changes older than the first tick are
 * assumed already delivered via the fast paths.
 *
 * Accepted redundancy: a change that already arrived via the footer
 * or editor path is re-broadcast once on the next tick (the bus has
 * no per-change identity to dedupe on). Consumers are idempotent —
 * the cost is one extra refresh fetch per change.
 */

import { broadcast } from '../broadcast';
import { heartbeat } from '../heartbeat';

interface ContentChangeEntry {
	ts: number;
	type: string;
	action: string;
	ids: number[];
}

interface ContentChangesBlock {
	ts: number;
	entries: ContentChangeEntry[];
}

/**
 * Server-clock high-water mark of processed entries. `null` until
 * the handshake tick adopts the server's mark.
 */
let seenTs: number | null = null;

/**
 * Wire the content-changes Heartbeat channel. Called once by
 * `desktop.ts` after `bootHeartbeatBus()`.
 *
 * @internal
 */
export function bootContentChangesHeartbeat(): void {
	heartbeat.contribute( 'desktop_mode_content_changes_seen_ts', () =>
		seenTs === null ? 0 : seenTs,
	);

	heartbeat.subscribe< ContentChangesBlock >(
		'desktop_mode_content_changes',
		( block ) => {
			if ( ! block || typeof block.ts !== 'number' ) {
				return;
			}

			const handshake = seenTs === null;
			const floor = seenTs ?? 0;
			let maxTs = Math.max( floor, block.ts );

			if ( ! handshake && Array.isArray( block.entries ) ) {
				for ( const entry of block.entries ) {
					if (
						! entry ||
						typeof entry.ts !== 'number' ||
						entry.ts <= floor ||
						typeof entry.type !== 'string' ||
						entry.type === ''
					) {
						continue;
					}
					broadcast( `desktop-mode.${ entry.type }.changed`, {
						source: 'heartbeat',
						action:
							typeof entry.action === 'string' && entry.action !== ''
								? entry.action
								: 'updated',
						ids: Array.isArray( entry.ids )
							? entry.ids.map( Number ).filter( ( id ) => id > 0 )
							: [],
					} );
					if ( entry.ts > maxTs ) {
						maxTs = entry.ts;
					}
				}
			}

			seenTs = maxTs;
		},
	);
}

/**
 * Test-only reset of the high-water mark.
 *
 * @internal
 */
export function _resetContentChangesHeartbeatForTests(): void {
	seenTs = null;
}
