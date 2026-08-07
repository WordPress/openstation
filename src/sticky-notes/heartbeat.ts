import { heartbeat } from '../heartbeat';
import type {
	StickyNotesHeartbeatPayload,
	StickyNotesHeartbeatSubscribe,
} from './types';

const SUBSCRIBE_FIELD = 'openstation_sticky_notes_subscribe';
const RESPONSE_FIELD = 'openstation_sticky_notes';

export interface StickyNotesHeartbeatTarget {
	getHeartbeatSubscription: () => StickyNotesHeartbeatSubscribe | undefined;
	applyHeartbeatPayload: ( payload: StickyNotesHeartbeatPayload ) => void;
}

let started = false;
let target: StickyNotesHeartbeatTarget | null = null;

export function startStickyNotesHeartbeat(
	nextTarget: StickyNotesHeartbeatTarget,
): void {
	target = nextTarget;
	if ( started ) {
		return;
	}
	started = true;

	heartbeat.contribute( SUBSCRIBE_FIELD, () =>
		target?.getHeartbeatSubscription(),
	);
	heartbeat.subscribe< StickyNotesHeartbeatPayload >(
		RESPONSE_FIELD,
		( payload ) => {
			target?.applyHeartbeatPayload( payload );
		},
	);
}

export function __resetStickyNotesHeartbeatForTests(): void {
	started = false;
	target = null;
}
