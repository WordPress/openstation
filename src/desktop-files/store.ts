import { createSharedStore, type SharedStore } from '../shared-store';
import type { RestCreatedFolderShape, RestFolderShape, RestPlacementShape } from './rest';

export interface FilesState {
	placementsByFolder: Map< number, RestPlacementShape[] >;
	folders: Map< number, RestFolderShape >;
	hydratedFolders: Set< number >;
}

const STORE_KEY = 'desktop-mode/files';

export function getFilesStore(): SharedStore< FilesState > {
	return createSharedStore< FilesState >( STORE_KEY, () => ( {
		placementsByFolder: new Map(),
		folders: new Map(),
		hydratedFolders: new Set(),
	} ) );
}

function fireChanged( detail: { kind: string; folderId?: number; placementId?: number; folderRowId?: number; source?: 'local' | 'remote' } ): void {
	if ( typeof document === 'undefined' ) {
		return;
	}
	document.dispatchEvent(
		new CustomEvent( 'os-files-changed', {
			detail: { source: 'local', ...detail },
		} ),
	);
}

export function setFolderPlacements( folderId: number, placements: RestPlacementShape[] ): void {
	const store = getFilesStore();
	const next = new Map( store.state.placementsByFolder );
	next.set( folderId, placements.slice() );
	const hydrated = new Set( store.state.hydratedFolders );
	hydrated.add( folderId );
	store.state = { ...store.state, placementsByFolder: next, hydratedFolders: hydrated };
	store.notify();
	fireChanged( { kind: 'placements-set', folderId } );
}

export function upsertPlacement( placement: RestPlacementShape, source: 'local' | 'remote' = 'local' ): void {
	if ( ! placement || typeof placement.id !== 'number' ) {
		console.warn(
			'[openstation] upsertPlacement called with a non-placement value; ignoring.',
			placement,
		);
		return;
	}

	const store = getFilesStore();
	const next = new Map( store.state.placementsByFolder );

	for ( const [ folderId, list ] of next ) {
		const idx = list.findIndex( ( p ) => p && p.id === placement.id );
		if ( idx >= 0 && folderId !== placement.parentId ) {
			const copy = list.filter( Boolean ) as RestPlacementShape[];
			const removeAt = copy.findIndex( ( p ) => p.id === placement.id );
			if ( removeAt >= 0 ) {
				copy.splice( removeAt, 1 );
			}
			next.set( folderId, copy );
		}
	}

	const rawTarget = next.get( placement.parentId )?.slice() ?? [];
	const target = rawTarget.filter( Boolean ) as RestPlacementShape[];
	const idx = target.findIndex( ( p ) => p.id === placement.id );
	if ( idx >= 0 ) {
		target[ idx ] = placement;
	} else {
		target.push( placement );
	}
	next.set( placement.parentId, target );

	store.state = { ...store.state, placementsByFolder: next };
	store.notify();
	fireChanged( { kind: 'placement-upserted', placementId: placement.id, folderId: placement.parentId, source } );
}

export function removePlacement( placementId: number, source: 'local' | 'remote' = 'local' ): void {
	const store = getFilesStore();
	const next = new Map( store.state.placementsByFolder );
	let touchedFolder: number | undefined;
	for ( const [ folderId, list ] of next ) {
		const idx = list.findIndex( ( p ) => p && p.id === placementId );
		if ( idx >= 0 ) {
			const copy = ( list.filter( Boolean ) as RestPlacementShape[] ).filter(
				( p ) => p.id !== placementId,
			);
			next.set( folderId, copy );
			touchedFolder = folderId;
		}
	}
	if ( touchedFolder === undefined ) {
		return;
	}
	store.state = { ...store.state, placementsByFolder: next };
	store.notify();
	fireChanged( { kind: 'placement-removed', placementId, folderId: touchedFolder, source } );
}

export function setFolders( folders: RestFolderShape[] ): void {
	const store = getFilesStore();
	const next = new Map< number, RestFolderShape >();
	for ( const f of folders ) {
		next.set( f.id, f );
	}
	store.state = { ...store.state, folders: next };
	store.notify();
	fireChanged( { kind: 'folders-set' } );
}

export function upsertFolder( folder: RestFolderShape, source: 'local' | 'remote' = 'local' ): void {
	const store = getFilesStore();
	const next = new Map( store.state.folders );
	next.set( folder.id, folder );
	store.state = { ...store.state, folders: next };
	store.notify();
	fireChanged( { kind: 'folder-upserted', folderRowId: folder.id, source } );
}

export function ingestCreatedFolders(
	created: RestCreatedFolderShape[] | undefined | null,
	source: 'local' | 'remote' = 'local',
): void {
	if ( ! Array.isArray( created ) ) {
		return;
	}
	for ( const entry of created ) {
		if ( ! entry || ! entry.folder || typeof entry.folder.id !== 'number' ) {
			continue;
		}
		upsertFolder( entry.folder, source );
		if ( entry.placement ) {
			upsertPlacement( entry.placement, source );
		}
	}
}

export function removeFolder( folderId: number, source: 'local' | 'remote' = 'local' ): void {
	const store = getFilesStore();
	const folders = new Map( store.state.folders );
	folders.delete( folderId );
	const placements = new Map( store.state.placementsByFolder );
	placements.delete( folderId );
	store.state = { ...store.state, folders, placementsByFolder: placements };
	store.notify();
	fireChanged( { kind: 'folder-removed', folderRowId: folderId, source } );
}

export function subscribeFilesStore( cb: ( state: FilesState ) => void ): () => void {
	const store = getFilesStore();
	const off = store.subscribe( cb );
	return off;
}

export function getFilesState(): FilesState {
	return getFilesStore().getState() as FilesState;
}

export function currentPlacement( snapshot: RestPlacementShape ): RestPlacementShape {
	const state = getFilesState();
	const sameFolder = state.placementsByFolder
		.get( snapshot.parentId )
		?.find( ( p ) => p && p.id === snapshot.id );
	if ( sameFolder ) {
		return sameFolder;
	}

	for ( const list of state.placementsByFolder.values() ) {
		const hit = list.find( ( p ) => p && p.id === snapshot.id );
		if ( hit ) {
			return hit;
		}
	}
	return snapshot;
}

export function __resetFilesStoreForTests(): void {
	const store = getFilesStore();
	store.state = {
		placementsByFolder: new Map(),
		folders: new Map(),
		hydratedFolders: new Set(),
	};
	store.notify();
}
