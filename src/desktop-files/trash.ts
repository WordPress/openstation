/**
 * OpenStation — Files-on-the-desktop trash helpers.
 *
 * Soft-trash a placement (or folder placement) with optimistic local
 * eviction, an Undo toast, and a cross-window broadcast so other
 * shell surfaces (Recycle Bin badge, ancestral folder windows) refresh
 * without waiting for the next Heartbeat tick.
 *
 * Lives in its own module so:
 *
 *   - The wallpaper layer (`layer.ts`) can call it from a tile drop
 *     onto the recycle bin.
 *   - The recycle-bin-targets module can call it directly from its
 *     own globally-registered drop targets (dock icon + window body).
 *   - Tests can stub the REST surface and assert just the toast +
 *     broadcast plumbing.
 *
 * Extracted from `layer.ts` (drag-and-drop rework).
 */

import { rest, store as filesStoreApi } from './layer-deps';
import type { RestPlacementShape } from './rest';

/**
 * Broadcast a "this kind of thing changed in trash state" event so
 * cross-window listeners (recycle-bin, badge counters, …) can refresh
 * without waiting for the next Heartbeat tick.
 *
 * Payload follows the cross-window convention:
 *   { source, action: 'trashed' | 'untrashed' | 'deleted', ids }
 * so the badge subscriber can delta-update by `ids.length` and the
 * Recycle Bin window's own listener can skip its self-emitted events
 * by checking `source`.
 */
function broadcastFilesChange(
	kind: 'placement' | 'shortcut' | 'folder',
	action: 'trashed' | 'untrashed' | 'deleted',
	ids: number[],
): void {
	const api = (
		window as {
			wp?: { os?: { broadcast?: ( topic: string, payload: unknown ) => void } };
		}
	).wp?.os;
	api?.broadcast?.( `os.${ kind }.changed`, {
		source: 'desktop-files',
		action,
		ids,
	} );
}

/**
 * Surface a non-blocking error toast when a trash attempt is
 * rejected (typically by the `open_station_files_forbidden` 403 from
 * `open_station_files_user_can_trash_placement`). Defensive: the
 * tile-menu entry and the drop target's `accept` are both gated on
 * `placement.canTrash` so the user shouldn't be able to reach this
 * path through the normal UI, but legacy clients and concurrent
 * permission changes can still produce one. Better to show the
 * server's reason in a toast than to leave the user staring at a
 * tile that didn't move with only a `console.error` for explanation.
 */
function showTrashErrorToast( err: unknown ): void {
	const api = (
		window as {
			wp?: { os?: { showToast?: ( opts: unknown ) => void } };
		}
	).wp?.os;
	if ( ! api?.showToast ) {
		return;
	}
	const raw = err instanceof Error ? err.message : String( err );
	// `call()` formats REST failures as
	// "[openstation] files REST 403: open_station_files_forbidden …".
	// Strip the prefix + error code so the user-facing toast keeps
	// just the human-readable reason.
	const friendly = raw
		.replace( /^\[openstation\][^:]*:\s*/, '' )
		.replace( /^open_station_files_[a-z_]+\s*/, '' );
	api.showToast( {
		message: friendly || 'Could not move this item to the recycle bin.',
		duration: 5000,
	} );
}

function showTrashedToast( message: string, onUndo: () => void ): void {
	const api = (
		window as {
			wp?: { os?: { showToast?: ( opts: unknown ) => void } };
		}
	).wp?.os;
	if ( ! api?.showToast ) {
		return;
	}
	api.showToast( {
		message,
		duration: 6000,
		action: {
			label: 'Undo',
			onClick: onUndo,
		},
	} );
}

/**
 * Soft-trash a placement with optimistic local eviction + an Undo
 * toast. Rollback on REST failure re-hydrates the parent folder so
 * the store catches up with whatever the server thinks.
 */
export async function trashPlacementWithUndo(
	placement: RestPlacementShape,
): Promise< void > {
	const placementId = placement.id;
	const parentId = placement.parentId;
	const title = placement.file?.title ?? 'Item';
	const kind: 'placement' | 'shortcut' =
		placement.file?.type === 'shortcut' ? 'shortcut' : 'placement';
	filesStoreApi.removePlacement( placementId );
	try {
		await rest.deletePlacement( placementId );
		broadcastFilesChange( kind, 'trashed', [ placementId ] );
		showTrashedToast( `"${ title }" moved to Trash`, async () => {
			try {
				await rest.restoreTrashedItem( placementId, 'placement' );
				const res = await rest.listPlacements( parentId );
				filesStoreApi.setFolderPlacements( parentId, res.placements );
				broadcastFilesChange( kind, 'untrashed', [ placementId ] );
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( '[openstation] restore failed:', err );
			}
		} );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[openstation] deletePlacement failed:', err );
		showTrashErrorToast( err );
		void rest.listPlacements( parentId ).then( ( res ) => {
			filesStoreApi.setFolderPlacements( parentId, res.placements );
		} );
	}
}

/**
 * Soft-trash a folder placement. Cascades server-side to every child
 * placement; Undo restores the folder + its cascaded children in one
 * round-trip via the recycle-bin endpoint.
 */
export async function trashFolderWithUndo(
	placement: RestPlacementShape,
): Promise< void > {
	const folderId = parseInt( placement.file.ref, 10 );
	if ( ! folderId ) {
		return;
	}
	const placementId = placement.id;
	const parentId = placement.parentId;
	const title = placement.file?.title ?? 'Folder';
	filesStoreApi.removePlacement( placementId );
	filesStoreApi.removeFolder( folderId );
	try {
		await rest.deleteFolder( folderId );
		broadcastFilesChange( 'folder', 'trashed', [ folderId ] );
		showTrashedToast( `"${ title }" moved to Trash`, async () => {
			try {
				await rest.restoreTrashedItem( folderId, 'folder' );
				const res = await rest.listPlacements( parentId );
				filesStoreApi.setFolderPlacements( parentId, res.placements );
				broadcastFilesChange( 'folder', 'untrashed', [ folderId ] );
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( '[openstation] restore folder failed:', err );
			}
		} );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[openstation] deleteFolder failed:', err );
		showTrashErrorToast( err );
		void rest.listPlacements( parentId ).then( ( res ) => {
			filesStoreApi.setFolderPlacements( parentId, res.placements );
		} );
	}
}

/**
 * Trash an item by routing to the placement / folder helper based on
 * the file type. Convenience for drop targets that don't want to
 * branch on type.
 */
export function trashByFileType( placement: RestPlacementShape ): Promise< void > {
	if ( placement.file?.type === 'folder' ) {
		return trashFolderWithUndo( placement );
	}
	return trashPlacementWithUndo( placement );
}
