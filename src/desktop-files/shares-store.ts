/**
 * Desktop Mode — Folder shares shared store.
 *
 * Tracks every share row the active session has touched, plus the
 * set of pending invites the current user has received via the
 * heartbeat. The store is `createSharedStore`-backed so every
 * bundle (main + lazy + future plugin bundles) sees the same data.
 *
 * @since 0.18.0
 */

import { createSharedStore, type SharedStore } from '../shared-store';
import type { RestShareShape } from './rest';

export interface PendingInvite extends RestShareShape {
	folderName?: string;
	ownerId?: number;
	ownerName?: string;
	ownerAvatar?: string;
}

export interface SharesState {
	/** Keyed by folder id — full share list for any folder the user has loaded. */
	byFolder: Map< number, RestShareShape[] >;
	/** Pending invites this user has not yet decided. */
	pending: PendingInvite[];
	/** Highwater mark for heartbeat sync. */
	sharesVersion: number;
	/** Folder ids the user has explicitly denied (suppresses re-prompt). */
	deniedFolders: Set< number >;
}

let _store: SharedStore< SharesState > | null = null;

export function sharesStore(): SharedStore< SharesState > {
	if ( ! _store ) {
		_store = createSharedStore< SharesState >( 'desktop-files/shares', () => ( {
			byFolder: new Map(),
			pending: [],
			sharesVersion: 0,
			deniedFolders: new Set(),
		} ) );
	}
	return _store;
}

export function setSharesForFolder( folderId: number, shares: RestShareShape[] ): void {
	const s = sharesStore();
	s.state.byFolder.set( folderId, shares );
	s.notify();
}

export function getSharesForFolder( folderId: number ): RestShareShape[] | undefined {
	return sharesStore().state.byFolder.get( folderId );
}

export function upsertShare( share: RestShareShape | null | undefined ): void {
	if ( ! share || typeof share.folderId !== 'number' ) {
		return;
	}
	const s = sharesStore();
	const existing = s.state.byFolder.get( share.folderId ) ?? [];
	const next = existing.filter( ( r ) => r.id !== share.id );
	next.push( share );
	s.state.byFolder.set( share.folderId, next );
	s.notify();
}

export function removeShare( folderId: number, shareId: number ): void {
	const s = sharesStore();
	const existing = s.state.byFolder.get( folderId ) ?? [];
	s.state.byFolder.set(
		folderId,
		existing.filter( ( r ) => r.id !== shareId ),
	);
	s.notify();
}

export function ingestPendingInvites( invites: PendingInvite[] ): void {
	const s = sharesStore();
	const seen = new Set( s.state.pending.map( ( p ) => p.id ) );
	let mutated = false;
	for ( const inv of invites ) {
		// Suppress re-prompt for previously-denied folders.
		if ( s.state.deniedFolders.has( inv.folderId ) ) {
			continue;
		}
		if ( seen.has( inv.id ) ) {
			// Replace existing snapshot (server may have updated cap).
			s.state.pending = s.state.pending.map( ( p ) => ( p.id === inv.id ? inv : p ) );
		} else {
			s.state.pending.push( inv );
		}
		if ( inv.invitedAtMs > s.state.sharesVersion ) {
			s.state.sharesVersion = inv.invitedAtMs;
		}
		mutated = true;
	}
	if ( mutated ) {
		s.notify();
	}
}

export function dropPending( shareId: number, opts: { denied?: boolean; folderId?: number } = {} ): void {
	const s = sharesStore();
	s.state.pending = s.state.pending.filter( ( p ) => p.id !== shareId );
	if ( opts.denied && typeof opts.folderId === 'number' ) {
		s.state.deniedFolders.add( opts.folderId );
	}
	s.notify();
}
