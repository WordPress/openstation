import { createSharedStore, type SharedStore } from '../shared-store';
import type { RestShareShape } from './rest';

export interface PendingInvite extends RestShareShape {
	folderName?: string;
	ownerId?: number;
	ownerName?: string;
	ownerAvatar?: string;

	targetType?: 'folder' | 'file' | string;

	fileId?: number;

	fileName?: string;
}

export interface SharesState {

	byFolder: Map< number, RestShareShape[] >;

	pending: PendingInvite[];

	sharesVersion: number;

	deniedFolders: Set< number >;

	deniedFiles: Set< number >;
}

let _store: SharedStore< SharesState > | null = null;

export function sharesStore(): SharedStore< SharesState > {
	if ( ! _store ) {
		_store = createSharedStore< SharesState >( 'desktop-files/shares', () => ( {
			byFolder: new Map(),
			pending: [],
			sharesVersion: 0,
			deniedFolders: new Set(),
			deniedFiles: new Set(),
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

function inviteEquals( a: PendingInvite, b: PendingInvite ): boolean {
	return (
		a.id === b.id &&
		a.folderId === b.folderId &&
		a.capability === b.capability &&
		a.invitedAtMs === b.invitedAtMs &&
		a.folderName === b.folderName &&
		a.fileName === b.fileName &&
		a.ownerName === b.ownerName
	);
}

export function ingestPendingInvites( invites: PendingInvite[] ): void {
	const s = sharesStore();
	const existingById = new Map( s.state.pending.map( ( p ) => [ p.id, p ] ) );
	let mutated = false;
	for ( const raw of invites ) {
		const inv: PendingInvite =
			raw.targetType === 'file' && typeof raw.folderId !== 'number'
				? { ...raw, folderId: 0 }
				: raw;

		if ( inv.targetType === 'file' ) {
			if ( typeof inv.fileId === 'number' && s.state.deniedFiles.has( inv.fileId ) ) {
				continue;
			}
		} else if ( s.state.deniedFolders.has( inv.folderId ) ) {
			continue;
		}
		const existing = existingById.get( inv.id );
		if ( existing ) {
			if ( inviteEquals( existing, inv ) ) {
				continue;
			}
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

export function dropPending(
	shareId: number,
	opts: { denied?: boolean; folderId?: number; fileId?: number } = {},
): void {
	const s = sharesStore();
	s.state.pending = s.state.pending.filter( ( p ) => p.id !== shareId );
	if ( opts.denied && typeof opts.folderId === 'number' ) {
		s.state.deniedFolders.add( opts.folderId );
	}
	if ( opts.denied && typeof opts.fileId === 'number' ) {
		s.state.deniedFiles.add( opts.fileId );
	}
	s.notify();
}
