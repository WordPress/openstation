import { toastRestFailure } from '../core/rest-failure';
import { shellToast } from '../core/shell-toast';
import { beginTrashChange, placementTrashItem } from './trash-optimistic';
import { announceContentChange } from '../broadcast';
import { rest, store as filesStoreApi } from './layer-deps';
import type { RestPlacementShape } from './rest';

function broadcastFilesChange(
	kind: 'placement' | 'shortcut' | 'folder',
	action: 'trashed' | 'untrashed' | 'deleted',
	ids: number[],
): void {
	announceContentChange( kind, action, ids, 'desktop-files' );
}

function showTrashErrorToast( err: unknown ): void {
	toastRestFailure( shellToast, err, {
		fallback: 'Could not move this item to the recycle bin.',
		duration: 5000,
	} );
}

function showTrashedToast( message: string, onUndo: () => void ): void {
	shellToast( {
		message,
		duration: 6000,
		action: {
			label: 'Undo',
			onClick: onUndo,
		},
	} );
}

export async function trashPlacementWithUndo(
	placement: RestPlacementShape,
): Promise< void > {
	const optimistic = beginTrashChange( placementTrashItem( placement ) );
	if ( ! optimistic ) {
		return;
	}
	const placementId = placement.id;
	const parentId = placement.parentId;
	const title = placement.file?.title ?? 'Item';
	const kind: 'placement' | 'shortcut' =
		placement.file?.type === 'shortcut' ? 'shortcut' : 'placement';
	filesStoreApi.removePlacement( placementId );
	try {
		await rest.deletePlacement( placementId );
		broadcastFilesChange( kind, 'trashed', [ placementId ] );
		void optimistic.finish( true );
		showTrashedToast( `"${ title }" moved to Trash`, async () => {
			const undo = beginTrashChange( placementTrashItem( placement ), 'out' );
			try {
				await rest.restoreTrashedItem( placementId, 'placement' );
				const res = await rest.listPlacements( parentId );
				filesStoreApi.setFolderPlacements( parentId, res.placements );
				broadcastFilesChange( kind, 'untrashed', [ placementId ] );
				void undo?.finish( true );
			} catch ( err ) {
				void undo?.finish( false );

				console.error( '[openstation] restore failed:', err );
			}
		} );
	} catch ( err ) {
		console.error( '[openstation] deletePlacement failed:', err );
		void optimistic.finish( false );
		filesStoreApi.upsertPlacement( placement );
		showTrashErrorToast( err );
		void rest.listPlacements( parentId ).then( ( res ) => {
			filesStoreApi.setFolderPlacements( parentId, res.placements );
		} ).catch( () => {} );
	}
}

export async function trashFolderWithUndo(
	placement: RestPlacementShape,
): Promise< void > {
	const folderId = parseInt( placement.file.ref, 10 );
	if ( ! folderId ) {
		return;
	}
	const optimistic = beginTrashChange( placementTrashItem( placement ) );
	if ( ! optimistic ) {
		return;
	}
	const placementId = placement.id;
	const parentId = placement.parentId;
	const title = placement.file?.title ?? 'Folder';
	filesStoreApi.removePlacement( placementId );
	const folder = filesStoreApi.getState().folders.get( folderId );
	filesStoreApi.removeFolder( folderId );
	try {
		await rest.deleteFolder( folderId );
		broadcastFilesChange( 'folder', 'trashed', [ folderId ] );
		void optimistic.finish( true );
		showTrashedToast( `"${ title }" moved to Trash`, async () => {
			const undo = beginTrashChange( placementTrashItem( placement ), 'out' );
			try {
				await rest.restoreTrashedItem( folderId, 'folder' );
				const res = await rest.listPlacements( parentId );
				filesStoreApi.setFolderPlacements( parentId, res.placements );
				broadcastFilesChange( 'folder', 'untrashed', [ folderId ] );
				void undo?.finish( true );
			} catch ( err ) {
				void undo?.finish( false );

				console.error( '[openstation] restore folder failed:', err );
			}
		} );
	} catch ( err ) {
		console.error( '[openstation] deleteFolder failed:', err );
		if ( folder ) {
			filesStoreApi.upsertFolder( folder );
		}
		void optimistic.finish( false );
		filesStoreApi.upsertPlacement( placement );
		showTrashErrorToast( err );
		void rest.listPlacements( parentId ).then( ( res ) => {
			filesStoreApi.setFolderPlacements( parentId, res.placements );
		} ).catch( () => {} );
	}
}

export async function trashManyWithUndo(
	placements: readonly RestPlacementShape[],
): Promise< void > {
	if ( placements.length === 0 ) {
		return;
	}
	if ( placements.length === 1 ) {
		return trashByFileType( placements[ 0 ] );
	}

	const operations = new Map( placements.map( ( placement ) => [
		placement.id, beginTrashChange( placementTrashItem( placement ) ),
	] ) );
	placements = placements.filter( ( placement ) => operations.get( placement.id ) );
	const folders = new Map( filesStoreApi.getState().folders );
	const parentIds = new Set< number >();
	for ( const placement of placements ) {
		parentIds.add( placement.parentId );

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
				console.error( '[openstation] files: re-hydrate failed:', err );
			}
		}
	};

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

	results.forEach( ( result, index ) => {
		if ( result.status === 'rejected' ) {
			const placement = placements[ index ];
			filesStoreApi.upsertPlacement( placement );
			const folder = placement.file.type === 'folder' && folders.get( Number( placement.file.ref ) );
			if ( folder ) {
				filesStoreApi.upsertFolder( folder );
			}
			void operations.get( placements[ index ].id )?.finish( false );
		}
	} );
	const deleted: Deleted[] = [];
	let failed = 0;
	for ( const result of results ) {
		if ( result.status === 'fulfilled' ) {
			deleted.push( result.value );
		} else {
			failed += 1;

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

	for ( const kind of [ 'placement', 'shortcut', 'folder' ] as const ) {
		const ids = deleted.filter( ( d ) => d.kind === kind ).map( ( d ) => d.id );
		if ( ids.length > 0 ) {
			broadcastFilesChange( kind, 'trashed', ids );
		}
	}

	results.forEach( ( result, index ) => {
		if ( result.status === 'fulfilled' ) {
			void operations.get( placements[ index ].id )?.finish( true );
		}
	} );

	const noun = deleted.length === 1 ? 'item' : 'items';
	const message =
		failed > 0
			? `${ deleted.length } ${ noun } moved to Trash · ${ failed } could not be moved`
			: `${ deleted.length } ${ noun } moved to Trash`;

	showTrashedToast( message, async () => {
		const undo = deleted.map( ( d ) => {
			const placement = placements.find( ( p ) => p.file.type === 'folder' ? Number( p.file.ref ) === d.id && d.kind === 'folder' : p.id === d.id && d.kind !== 'folder' );
			return placement ? beginTrashChange( placementTrashItem( placement ), 'out' ) : null;
		} );
		const restores = await Promise.allSettled(
			deleted.map( ( d ) =>
				rest.restoreTrashedItem( d.restoreId, d.restoreKind ),
			),
		);
		await rehydrate();

		const restored = deleted.filter(
			( _d, index ) => restores[ index ].status === 'fulfilled',
		);
		const stillTrashed = deleted.length - restored.length;
		for ( const result of restores ) {
			if ( result.status === 'rejected' ) {
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
		restores.forEach( ( result, index ) => {
			void undo[ index ]?.finish( result.status === 'fulfilled' );
		} );
		if ( stillTrashed > 0 ) {
			showTrashErrorToast(
				new Error(
					`${ stillTrashed } of ${ deleted.length } items could not be restored.`,
				),
			);
		}
	} );
}

export function trashByFileType( placement: RestPlacementShape ): Promise< void > {
	if ( placement.file?.type === 'folder' ) {
		return trashFolderWithUndo( placement );
	}
	return trashPlacementWithUndo( placement );
}
