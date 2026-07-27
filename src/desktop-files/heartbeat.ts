/**
 * Desktop Mode — Files Heartbeat sync (JS).
 *
 * Mirror of `includes/desktop-files/heartbeat.php`. Contributes a
 * `desktop_mode_files_subscribe` block on every Heartbeat send
 * carrying the per-folder version map + the latest placement
 * `updated_at_ms` we've seen. Subscribes to the
 * `desktop_mode_files` block on the response and merges deltas
 * into the shared store with `source: 'remote'`.
 *
 * On `truncated: true` we issue a one-shot REST resync of every
 * hydrated folder (the server signaled that it skipped rows
 * past the cap).
 */

import { heartbeat } from '../heartbeat';
import {
	getFilesState,
	removeFolder,
	removePlacement,
	setFolderPlacements,
	upsertFolder,
	upsertPlacement,
} from './store';
import { listPlacements, type RestFolderShape, type RestPlacementShape } from './rest';
import { ingestPendingInvites, sharesStore, type PendingInvite } from './shares-store';

interface FilesHeartbeatPayload {
	placements?: RestPlacementShape[];
	folders?: RestFolderShape[];
	removed?: { placements?: number[]; folders?: number[] };
	shares?: { pending?: PendingInvite[] };
	serverTimeMs?: number;
	truncated?: boolean;
}

let started = false;
let highWaterMs = 0;

/** Hook the Heartbeat bus. Idempotent. */
export function startFilesHeartbeat(): void {
	if ( started ) {
		return;
	}
	started = true;

	heartbeat.contribute( 'desktop_mode_files_subscribe', () => {
		const state = getFilesState();
		const folderVersions: Record< string, number > = {};
		for ( const [ id, folder ] of state.folders ) {
			folderVersions[ String( id ) ] = folder.updatedAtMs;
		}
		return {
			folderVersions,
			placementsVersion: highWaterMs,
			sharesVersion: sharesStore().state.sharesVersion,
		};
	} );

	heartbeat.subscribe< FilesHeartbeatPayload >( 'desktop_mode_files', ( payload ) => {
		applyDelta( payload );
	} );
}

function applyDelta( payload: FilesHeartbeatPayload ): void {
	const folders = payload.folders ?? [];
	for ( const folder of folders ) {
		upsertFolder( folder, 'remote' );
		if ( folder.updatedAtMs > highWaterMs ) {
			highWaterMs = folder.updatedAtMs;
		}
	}
	const placements = payload.placements ?? [];
	for ( const placement of placements ) {
		upsertPlacement( placement, 'remote' );
		if ( placement.updatedAtMs > highWaterMs ) {
			highWaterMs = placement.updatedAtMs;
		}
	}
	const removed = payload.removed ?? {};
	for ( const id of removed.folders ?? [] ) {
		removeFolder( id, 'remote' );
	}
	for ( const id of removed.placements ?? [] ) {
		removePlacement( id, 'remote' );
	}
	if ( typeof payload.serverTimeMs === 'number' && payload.serverTimeMs > highWaterMs ) {
		highWaterMs = payload.serverTimeMs;
	}

	const pending = payload.shares?.pending;
	if ( Array.isArray( pending ) && pending.length > 0 ) {
		ingestPendingInvites( pending );
	}

	if ( payload.truncated ) {
		// Server cap was hit — do a one-shot REST resync of every
		// hydrated folder to catch the rows the heartbeat skipped.
		const hydrated = Array.from( getFilesState().hydratedFolders );
		for ( const folderId of hydrated ) {
			void listPlacements( folderId )
				.then( ( res ) => {
					setFolderPlacements( folderId, res.placements );
				} )
				.catch( () => {
					// Quiet — the next tick will retry.
				} );
		}
	}
}

/** Test-only: reset the started flag + highWaterMs. */
export function __resetFilesHeartbeatForTests(): void {
	started = false;
	highWaterMs = 0;
}
