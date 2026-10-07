import { applyFilters } from '../hooks';
import { openExplorerDetail } from '../open-targets/explorer-open';
import { osConfirm } from '../os-confirm';
import type { SelectionAction } from '../selection';
import { openCreateFolderDialog } from './create-folder-dialog';
import { rest, store as filesStoreApi } from './layer-deps';
import { openFile } from './open';
import { resolve as resolveFileType } from './registry';
import { hideFromDesktop, readSynthSource } from './synthetic';
import type { TileMenuItem } from './tile-menu';
import {
	trashFolderWithUndo,
	trashManyWithUndo,
	trashPlacementWithUndo,
} from './trash';
import type { RestPlacementShape } from './rest';

const OPEN_CONFIRM_THRESHOLD = 5;

const trashMany = ( placements: RestPlacementShape[] ): Promise< void > =>
	trashManyWithUndo( placements );

async function openMany( placements: readonly RestPlacementShape[] ): Promise< void > {
	if ( placements.length > OPEN_CONFIRM_THRESHOLD ) {
		const ok = await osConfirm( {
			title: `Open ${ placements.length } items?`,
			message: `This opens ${ placements.length } windows at once.`,
			confirmLabel: 'Open all',
		} );
		if ( ! ok ) {
			return;
		}
	}
	for ( const placement of placements ) {
		await openFile( resolveFileType( placement.file ) );
	}
}

function renameFolder( placement: RestPlacementShape ): void {
	const folderId = parseInt( placement.file.ref, 10 );
	if ( ! folderId ) {
		return;
	}

	openCreateFolderDialog( {
		title: 'Rename folder',
		label: 'New name',
		submitLabel: 'Rename',
		initialName: placement.file.title,
		onSubmit: async ( name ) => {
			const trimmed = name.trim();
			if ( ! trimmed || trimmed === placement.file.title ) {
				return;
			}

			const previousTitle = placement.file.title;
			const optimistic: RestPlacementShape = {
				...placement,
				file: { ...placement.file, title: trimmed },
			};
			filesStoreApi.upsertPlacement( optimistic );
			try {
				const folderUpdatedAtMs =
					filesStoreApi.getState().folders.get( folderId )
						?.updatedAtMs ?? 0;
				const updated = await rest.updateFolder(
					folderId,
					{ name: trimmed },
					folderUpdatedAtMs,
				);
				filesStoreApi.upsertFolder( updated );

				const refreshed = await rest.listPlacements( placement.parentId );
				filesStoreApi.setFolderPlacements(
					placement.parentId,
					refreshed.placements,
				);
			} catch ( err ) {
				console.error( '[openstation] rename folder failed:', err );
				filesStoreApi.upsertPlacement( {
					...placement,
					file: { ...placement.file, title: previousTitle },
				} );
			}
		},
	} );
}

function navigateIntoPost( placement: RestPlacementShape ): void {
	const postId = parseInt( placement.file.ref, 10 );
	if ( ! postId ) {
		return;
	}

	const postType =
		typeof placement.file.postType === 'string'
			? ( placement.file.postType as string )
			: 'post';
	openExplorerDetail( {
		entityId: postType === 'page' ? 'pages' : 'posts',
		postId,
		postTitle: placement.file.title || `#${ postId }`,
	} );
}

export function buildPlacementActions(
	placement: RestPlacementShape,
): SelectionAction< RestPlacementShape >[] {
	const items: TileMenuItem[] = [
		{
			id: 'open',
			label: 'Open',
			icon: 'dashicons-external',
			sort: 10,
			multi: true,
			bulkLabel: ( n ) => `Open ${ n } items`,
			bulk: ( placements ) => openMany( placements ),
			onClick: () => {
				void openFile( resolveFileType( placement.file ) );
			},
		},
	];

	if ( placement.file.type === 'post' ) {
		items.push( {
			id: 'navigate-into',
			label: 'Navigate into',
			icon: 'dashicons-category',
			sort: 20,
			onClick: () => navigateIntoPost( placement ),
		} );
	}

	const isFolder = placement.file.type === 'folder';
	if ( isFolder ) {
		items.push( {
			id: 'rename-folder',
			label: 'Rename…',
			icon: 'dashicons-edit',
			sort: 30,
			onClick: () => renameFolder( placement ),
		} );

		if ( placement.canTrash !== false ) {
			items.push( {
				id: 'delete-folder',
				multiId: 'trash',
				label: 'Move folder to Trash',
				icon: 'dashicons-trash',
				sort: 90,
				danger: true,
				multi: true,
				bulkLabel: ( n ) => `Move ${ n } items to Trash`,
				bulk: trashMany,
				onClick: () => trashFolderWithUndo( placement ),
			} );
		}
	} else {
		const synthFromDockItem = readSynthSource( placement );
		const isRegisteredIcon = placement.file.type === 'shortcut';
		if ( synthFromDockItem || isRegisteredIcon ) {
			const hideId = synthFromDockItem ?? placement.file.ref;
			items.push( {
				id: 'hide-from-desktop',
				label: 'Hide from desktop',
				icon: 'dashicons-hidden',
				sort: 90,
				multi: true,
				bulkLabel: ( n ) => `Hide ${ n } items from desktop`,
				bulk: ( placements ) => {
					hideFromDesktop(
						placements
							.map(
								( p ) => readSynthSource( p ) ?? p.file.ref,
							)
							.filter( ( id ): id is string => !! id ),
					);
				},
				onClick: () => hideFromDesktop( [ hideId ] ),
			} );
		} else if ( placement.canTrash !== false ) {
			items.push( {
				id: 'remove',
				multiId: 'trash',
				label: 'Move to Trash',
				icon: 'dashicons-trash',
				sort: 90,
				danger: true,
				multi: true,
				bulkLabel: ( n ) => `Move ${ n } items to Trash`,
				bulk: trashMany,
				onClick: () => trashPlacementWithUndo( placement ),
			} );
		}
	}

	const filtered = applyFilters< TileMenuItem[], [ RestPlacementShape ] >(
		'os.files.tile-menu',
		items,
		placement,
	);
	const list = Array.isArray( filtered ) ? filtered : items;
	return list as SelectionAction< RestPlacementShape >[];
}
