/**
 * OpenStation — Pinned notes Heartbeat glue.
 *
 * Contributes `openstation_notes_subscribe` on every tick and feeds
 * `openstation_notes` deltas back to the layer. Server side in
 * `includes/notes/heartbeat.php`.
 */

import { heartbeat } from '../heartbeat';
import { NOTES_HEARTBEAT_RESPONSE_FIELD } from './types';
import type { NotesHeartbeatPayload, NotesHeartbeatSubscribe } from './types';

const SUBSCRIBE_FIELD = 'openstation_notes_subscribe';
const RESPONSE_FIELD = NOTES_HEARTBEAT_RESPONSE_FIELD;

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
