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

export function startFilesHeartbeat(): void {
	if ( started ) {
		return;
	}
	started = true;

	heartbeat.contribute( 'openstation_files_subscribe', () => {
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

	heartbeat.subscribe< FilesHeartbeatPayload >( 'openstation_files', ( payload ) => {
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
		const hydrated = Array.from( getFilesState().hydratedFolders );
		for ( const folderId of hydrated ) {
			void listPlacements( folderId )
				.then( ( res ) => {
					setFolderPlacements( folderId, res.placements );
				} )
				.catch( () => {

				} );
		}
	}
}

export function __resetFilesHeartbeatForTests(): void {
	started = false;
	highWaterMs = 0;
}
