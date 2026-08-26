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

import { announceContentChange } from '../broadcast';
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
	announceContentChange( kind, action, ids, 'desktop-files' );
}

/**
 * Surface a non-blocking error toast when a trash attempt is
 * rejected (typically by the `openstation_files_forbidden` 403 from
 * `openstation_files_user_can_trash_placement`). Defensive: the
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
	// "[openstation] files REST 403: openstation_files_forbidden …".
	// Strip the prefix + error code so the user-facing toast keeps
	// just the human-readable reason.
	const friendly = raw
		.replace( /^\[openstation\][^:]*:\s*/, '' )
		.replace( /^openstation_files_[a-z_]+\s*/, '' );
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
 * Soft-trash a whole selection in one gesture.
 *
 * Not a loop over `trashPlacementWithUndo` — that would stack N
 * toasts, each with an Undo that restores exactly one item, and the
 * user who selected twelve screenshots would have to press Undo
 * twelve times to get back to where they were. The set is one
 * action to the user, so it gets one optimistic eviction pass, one
 * toast, one Undo, and one broadcast carrying every id.
 *
 * Failures are per-item (a shared folder the viewer may read but not
 * write can 403 while its neighbours succeed), so the REST calls run
 * through `allSettled` and the survivors still get their Undo. Any
 * failure re-hydrates every touched folder — the server's version of
 * the truth wins over the optimistic eviction.
 */
export async function trashManyWithUndo(
	placements: readonly RestPlacementShape[],
): Promise< void > {
	if ( placements.length === 0 ) {
		return;
	}
	if ( placements.length === 1 ) {
		return trashByFileType( placements[ 0 ] );
	}

	const parentIds = new Set< number >();
	for ( const placement of placements ) {
		parentIds.add( placement.parentId );
		// Optimistic eviction first, so the tiles disappear together
		// rather than popping out one REST round-trip at a time.
		filesStoreApi.removePlacement( placement.id );
		if ( placement.file?.type === 'folder' ) {
			const folderId = parseInt( placement.file.ref, 10 );
			if ( folderId ) {
				filesStoreApi.removeFolder( folderId );
			}
		}
	}

	const rehydrate = async (): Promise< void > => {
		for ( const parentId of parentIds ) {
			try {
				const res = await rest.listPlacements( parentId );
				filesStoreApi.setFolderPlacements( parentId, res.placements );
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( '[openstation] files: re-hydrate failed:', err );
			}
		}
	};

	/** Per-item descriptor of what was deleted and how to bring it back. */
	interface Deleted {
		id: number;
		kind: 'placement' | 'shortcut' | 'folder';
		restoreId: number;
		restoreKind: 'placement' | 'folder';
	}

	const results = await Promise.allSettled(
		placements.map( async ( placement ): Promise< Deleted > => {
			if ( placement.file?.type === 'folder' ) {
				const folderId = parseInt( placement.file.ref, 10 );
				if ( ! folderId ) {
					throw new Error( 'folder placement without a folder id' );
				}
				await rest.deleteFolder( folderId );
				return {
					id: folderId,
					kind: 'folder',
					restoreId: folderId,
					restoreKind: 'folder',
				};
			}
			await rest.deletePlacement( placement.id );
			return {
				id: placement.id,
				kind:
					placement.file?.type === 'shortcut' ? 'shortcut' : 'placement',
				restoreId: placement.id,
				restoreKind: 'placement',
			};
		} ),
	);

	const deleted: Deleted[] = [];
	let failed = 0;
	for ( const result of results ) {
		if ( result.status === 'fulfilled' ) {
			deleted.push( result.value );
		} else {
			failed += 1;
			// eslint-disable-next-line no-console
			console.error(
				'[openstation] trash (bulk) failed for one item:',
				result.reason,
			);
		}
	}

	if ( failed > 0 ) {
		void rehydrate();
	}
	if ( deleted.length === 0 ) {
		showTrashErrorToast(
			results.find( ( r ) => r.status === 'rejected' )?.reason,
		);
		return;
	}

	// One broadcast per kind — subscribers delta by `ids.length`, so a
	// mixed set has to be split rather than flattened into one event.
	for ( const kind of [ 'placement', 'shortcut', 'folder' ] as const ) {
		const ids = deleted.filter( ( d ) => d.kind === kind ).map( ( d ) => d.id );
		if ( ids.length > 0 ) {
			broadcastFilesChange( kind, 'trashed', ids );
		}
	}

	// A partial failure is normal enough to name rather than hide: a
	// shared folder the viewer may read but not write 403s while its
	// neighbours succeed, and "3 items moved" when only 2 moved is a
	// lie the user finds out about later.
	const noun = deleted.length === 1 ? 'item' : 'items';
	const message =
		failed > 0
			? `${ deleted.length } ${ noun } moved to Trash · ${ failed } could not be moved`
			: `${ deleted.length } ${ noun } moved to Trash`;

	showTrashedToast( message, async () => {
		const restores = await Promise.allSettled(
			deleted.map( ( d ) =>
				rest.restoreTrashedItem( d.restoreId, d.restoreKind ),
			),
		);
		await rehydrate();

		// Announce only what actually came back. Broadcasting the
		// whole batch would tell the Recycle Bin's badge and every
		// other listener that an item was restored while it is still
		// sitting in the trash — a lie that survives until the next
		// full refresh, and one the single-item undo paths don't tell
		// because they only broadcast inside their success branch.
		const restored = deleted.filter(
			( _d, index ) => restores[ index ].status === 'fulfilled',
		);
		const stillTrashed = deleted.length - restored.length;
		for ( const result of restores ) {
			if ( result.status === 'rejected' ) {
				// eslint-disable-next-line no-console
				console.error(
					'[openstation] restore (bulk) failed for one item:',
					result.reason,
				);
			}
		}
		for ( const kind of [ 'placement', 'shortcut', 'folder' ] as const ) {
			const ids = restored
				.filter( ( d ) => d.kind === kind )
				.map( ( d ) => d.id );
			if ( ids.length > 0 ) {
				broadcastFilesChange( kind, 'untrashed', ids );
			}
		}
		if ( stillTrashed > 0 ) {
			// The user pressed Undo and part of it didn't take. Saying
			// nothing would leave them believing it did.
			showTrashErrorToast(
				new Error(
					`${ stillTrashed } of ${ deleted.length } items could not be restored.`,
				),
			);
		}
	} );
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
