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
	'os/presence',
	() => ( { byUser: new Map(), serverTimeMs: 0 } ),
);

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

let lastInputMs = Date.now();
let booted = false;

function noteUserActivity(): void {
	lastInputMs = Date.now();
}

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
			new CustomEvent( 'os-presence-changed', { detail } ),
		);

		activity.publish( 'os/presence-changed', detail );
	}

	activity.publish( 'os/presence-snapshot-applied', {
		applied: Object.keys( block.snapshot ).length,
		transitions: transitions.length,
	} );
}

export function bootPresenceProbe(): void {
	if ( booted ) {
		return;
	}
	booted = true;

	document.addEventListener( 'pointerdown', noteUserActivity, {
		capture: true,
		passive: true,
	} );

	window.addEventListener( 'keydown', noteUserActivity, {
		capture: true,
		passive: true,
	} );

	document.addEventListener( 'visibilitychange', () => {
		if ( ! document.hidden ) {
			noteUserActivity();
		}
	} );

	heartbeat.contribute( 'openstation_presence_active', () => true );
	heartbeat.contribute(
		'openstation_user_active',
		() => Date.now() - lastInputMs < ACTIVE_THRESHOLD_MS,
	);
	heartbeat.subscribe< HeartbeatBlock >( 'openstation_presence', ( block ) => {
		applySnapshot( block );
	} );
}

export function getStatus( userId: number ): PresenceStatus {
	const entry = store.state.byUser.get( userId );
	return entry ? entry.status : 'offline';
}

export function getAll(): Map< number, PresenceEntry > {
	return new Map( store.state.byUser );
}

export function getEntry( userId: number ): PresenceEntry | null {
	return store.state.byUser.get( userId ) ?? null;
}

export function subscribe(
	cb: ( state: { byUser: ReadonlyMap< number, PresenceEntry >; serverTimeMs: number } ) => void,
): () => void {
	return store.subscribe( ( s ) => cb( s ) );
}

export function markActive(): void {
	noteUserActivity();
}

export function _resetPresenceForTests(): void {
	booted = false;
	lastInputMs = Date.now();
}

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
			new CustomEvent( 'os-presence-changed', { detail } ),
		);
		activity.publish( 'os/presence-changed', detail );
	}
	activity.publish( 'os/presence-snapshot-applied', {
		applied: updates.length,
		transitions: transitions.length,
	} );
}

export const presenceApi = Object.freeze( {
	getStatus,
	getAll,
	getEntry,
	subscribe,
	markActive,
	applyBatch: applyPresenceBatch,
} );

export type PresenceApi = typeof presenceApi;
