/**
 * Desktop Mode — Files-on-the-desktop trash helpers.
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
 * Extracted from `layer.ts` in 0.18.0 (drag-and-drop rework).
 *
 * @since 0.18.0
 */

import { rest, store as filesStoreApi } from './layer-deps';
import type { RestPlacementShape } from './rest';

/**
 * Broadcast a "this kind of thing changed in trash state" event so
 * cross-window listeners (recycle-bin, badge counters, …) can refresh
 * without waiting for the next Heartbeat tick.
 */
function broadcastFilesChange( kind: 'placement' | 'shortcut' | 'folder' ): void {
	const api = (
		window as {
			wp?: { desktop?: { broadcast?: ( topic: string, payload: unknown ) => void } };
		}
	).wp?.desktop;
	api?.broadcast?.( `desktop-mode.${ kind }.changed`, { reason: 'trash' } );
}

function showTrashedToast( message: string, onUndo: () => void ): void {
	const api = (
		window as {
			wp?: { desktop?: { showToast?: ( opts: unknown ) => void } };
		}
	).wp?.desktop;
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
		broadcastFilesChange( kind );
		showTrashedToast( `"${ title }" moved to Trash`, async () => {
			try {
				await rest.restoreTrashedItem( placementId, 'placement' );
				const res = await rest.listPlacements( parentId );
				filesStoreApi.setFolderPlacements( parentId, res.placements );
				broadcastFilesChange( kind );
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( '[desktop-mode] restore failed:', err );
			}
		} );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[desktop-mode] deletePlacement failed:', err );
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
		broadcastFilesChange( 'folder' );
		showTrashedToast( `"${ title }" moved to Trash`, async () => {
			try {
				await rest.restoreTrashedItem( folderId, 'folder' );
				const res = await rest.listPlacements( parentId );
				filesStoreApi.setFolderPlacements( parentId, res.placements );
				broadcastFilesChange( 'folder' );
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( '[desktop-mode] restore folder failed:', err );
			}
		} );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[desktop-mode] deleteFolder failed:', err );
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
