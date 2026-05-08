/**
 * Desktop Mode — Files-on-the-Desktop shared store.
 *
 * Cross-bundle state holder for placements + folders, keyed by
 * the canonical `'desktop-mode/files'` slot. Phase 3's renderer
 * subscribes to this store and re-paints on change; Phase 6's
 * Heartbeat sync feeds delta updates into it.
 *
 * Contract:
 *   - `placementsByFolder.get( folderId )` → array of placements.
 *   - `folders.get( folderId )` → the folder row (when present).
 *   - Mutations route through helpers (`upsertPlacement`,
 *     `removePlacement`, `upsertFolder`, `removeFolder`); each
 *     calls `store.notify()` exactly once and emits a global
 *     `desktop-mode-files-changed` CustomEvent so non-store
 *     consumers (toasts, devtools) hear about it without
 *     reading the store.
 *
 * The store is intentionally framework-agnostic — Phase 3 wires
 * a tiny render loop on top, but plugin authors who want to
 * read the placements list synchronously can do so directly.
 *
 * @since 0.9.0
 */

import { createSharedStore, type SharedStore } from '../shared-store';
import type { RestFolderShape, RestPlacementShape } from './rest';

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
		new CustomEvent( 'desktop-mode-files-changed', {
			detail: { source: 'local', ...detail },
		} ),
	);
}

/** Replace the placement list for a folder (used after a list fetch). */
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

/** Insert / replace a single placement (post-create, post-update). */
export function upsertPlacement( placement: RestPlacementShape, source: 'local' | 'remote' = 'local' ): void {
	// Guard: a malformed REST response or a caller passing a
	// stale promise resolution can land here with `null` /
	// `undefined`. Earlier this would throw inside the bucket
	// `findIndex` callback (`p.id === placement.id`) and the
	// caller's catch block would log a confusing
	// "Cannot read properties of null" trace; the underlying
	// failure was the upstream call returning nothing useful.
	// Bail loudly instead so debugging starts at the real cause.
	if ( ! placement || typeof placement.id !== 'number' ) {
		// eslint-disable-next-line no-console
		console.warn(
			'[desktop-mode] upsertPlacement called with a non-placement value; ignoring.',
			placement,
		);
		return;
	}

	const store = getFilesStore();
	const next = new Map( store.state.placementsByFolder );

	// Remove from any existing folder bucket so a parent change
	// doesn't leave a ghost copy in the previous folder. Filter
	// nulls defensively — a buggy plugin (or an interrupted
	// optimistic update) could have left a hole that would
	// otherwise crash the comparison callback.
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

/** Remove a placement from every folder bucket. */
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

/** Replace the folder list (used after a list fetch). */
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

/** Insert / replace a single folder. */
export function upsertFolder( folder: RestFolderShape, source: 'local' | 'remote' = 'local' ): void {
	const store = getFilesStore();
	const next = new Map( store.state.folders );
	next.set( folder.id, folder );
	store.state = { ...store.state, folders: next };
	store.notify();
	fireChanged( { kind: 'folder-upserted', folderRowId: folder.id, source } );
}

/** Remove a folder + clear its placements bucket. */
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

/** Subscribe to store changes. Mirror of `store.subscribe`. */
export function subscribeFilesStore( cb: ( state: FilesState ) => void ): () => void {
	const store = getFilesStore();
	const off = store.subscribe( cb );
	return off;
}

/** Synchronous reader for the current state. */
export function getFilesState(): FilesState {
	return getFilesStore().getState() as FilesState;
}

/** Test-only — clears every map. */
export function __resetFilesStoreForTests(): void {
	const store = getFilesStore();
	store.state = {
		placementsByFolder: new Map(),
		folders: new Map(),
		hydratedFolders: new Set(),
	};
	store.notify();
}
