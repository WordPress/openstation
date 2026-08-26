/**
 * OpenStation — Files restore-from-bin sync.
 *
 * Symmetric counterpart to `trash.ts`. Trash optimistically evicts
 * the placement (and folder, for folder placements) on its way INTO
 * the bin and emits `os.{placement,shortcut,folder}.changed`
 * so cross-window listeners can react. The reverse path — restoring
 * an item from the Recycle Bin window — emits the same topics with
 * `action: 'untrashed'`, but nothing on the desktop-files side was
 * subscribed: the store learned about the restore only on the next
 * Heartbeat tick (15–60 s), or, when the heartbeat delta missed it
 * for any reason, not at all until F5.
 *
 * This module fixes that asymmetry by listening for those topics and
 * issuing an authoritative REST resync the moment a restore is
 * broadcast. The resync shape mirrors the `truncated: true` fallback
 * in `heartbeat.ts` — refetch `listFolders()` to repopulate the
 * folders map (the trash eviction cleared it) and `listPlacements()`
 * for every still-hydrated folder so the on-screen tiles match the
 * server.
 *
 * Robustness: doesn't depend on the heartbeat machinery at all.
 * `listPlacements` / `listFolders` always return the authoritative
 * current state, so a restore lands in the store within one round-
 * trip regardless of whether heartbeat deltas are working.
 */

import { subscribe } from '../broadcast';
import { listFolders, listPlacements } from './rest';
import {
	getFilesState,
	setFolderPlacements,
	setFolders,
} from './store';

interface ChangedPayload {
	action?: string;
	source?: string;
	ids?: unknown;
}

let started = false;
const unsubscribers: Array< () => void > = [];

/**
 * Wire the subscriber. Idempotent — calling twice is safe (the
 * second call is a no-op).
 */
export function startFilesRestoreSync(): void {
	if ( started ) {
		return;
	}
	started = true;

	const onChange = ( payload: unknown ): void => {
		const detail = payload as ChangedPayload | null | undefined;
		if ( ! detail || detail.action !== 'untrashed' ) {
			return;
		}
		resyncFromServer();
	};

	unsubscribers.push(
		subscribe( 'os.placement.changed', onChange ),
		subscribe( 'os.shortcut.changed', onChange ),
		subscribe( 'os.folder.changed', onChange ),
	);
}

/**
 * Refetch the folders map + every hydrated folder's placements in
 * parallel. Errors are logged but never thrown — a transient REST
 * blip leaves the store on its previous state and the next
 * Heartbeat tick will reconcile.
 */
function resyncFromServer(): void {
	void listFolders()
		.then( ( res ) => {
			setFolders( res.folders );
		} )
		.catch( ( err ) => {
			// eslint-disable-next-line no-console
			console.error(
				'[openstation] files restore-sync: listFolders failed',
				err,
			);
		} );

	// Snapshot the hydrated set up front because `setFolderPlacements`
	// re-adds entries during iteration.
	const hydrated = Array.from( getFilesState().hydratedFolders );
	for ( const folderId of hydrated ) {
		void listPlacements( folderId )
			.then( ( res ) => {
				setFolderPlacements( folderId, res.placements );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error(
					'[openstation] files restore-sync: listPlacements failed for',
					folderId,
					err,
				);
			} );
	}
}

/** Test-only — unsubscribes every listener and resets the install latch. */
export function __resetFilesRestoreSyncForTests(): void {
	for ( const off of unsubscribers ) {
		off();
	}
	unsubscribers.length = 0;
	started = false;
}
