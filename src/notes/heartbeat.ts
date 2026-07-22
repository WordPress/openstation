/**
 * Desktop Mode — Pinned notes Heartbeat glue.
 *
 * Contributes `desktop_mode_notes_subscribe` on every tick and feeds
 * `desktop_mode_notes` deltas back to the layer. Same shape as the
 * sticky-notes heartbeat (`src/sticky-notes/heartbeat.ts`); server
 * side in `includes/notes/heartbeat.php`.
 *
 * @since 0.9.6
 */

import { heartbeat } from '../heartbeat';
import type { NotesHeartbeatPayload, NotesHeartbeatSubscribe } from './types';

const SUBSCRIBE_FIELD = 'desktop_mode_notes_subscribe';
const RESPONSE_FIELD = 'desktop_mode_notes';

export interface NotesHeartbeatTarget {
	getHeartbeatSubscription: () => NotesHeartbeatSubscribe | undefined;
	applyHeartbeatPayload: ( payload: NotesHeartbeatPayload ) => void;
}

let started = false;
let target: NotesHeartbeatTarget | null = null;

export function startNotesHeartbeat( nextTarget: NotesHeartbeatTarget ): void {
	target = nextTarget;
	if ( started ) {
		return;
	}
	started = true;

	heartbeat.contribute( SUBSCRIBE_FIELD, () =>
		target?.getHeartbeatSubscription(),
	);
	heartbeat.subscribe< NotesHeartbeatPayload >( RESPONSE_FIELD, ( payload ) => {
		target?.applyHeartbeatPayload( payload );
	} );
}

export function __resetNotesHeartbeatForTests(): void {
	started = false;
	target = null;
}
