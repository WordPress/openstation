/**
 * OpenStation — Pinned notes Heartbeat glue.
 *
 * Contributes `open_station_notes_subscribe` on every tick and feeds
 * `open_station_notes` deltas back to the layer. Same shape as the
 * sticky-notes heartbeat (`src/sticky-notes/heartbeat.ts`); server
 * side in `includes/notes/heartbeat.php`.
 */

import { heartbeat } from '../heartbeat';
import type { NotesHeartbeatPayload, NotesHeartbeatSubscribe } from './types';

const SUBSCRIBE_FIELD = 'open_station_notes_subscribe';
const RESPONSE_FIELD = 'open_station_notes';

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
