/**
 * OpenStation — what a file tile can do.
 *
 * One function, `buildPlacementActions( placement )`, answering the
 * single-item half of the selection contract: *what can be done to
 * THIS placement?* The framework's `resolveCommonActions()` calls it
 * once per selected tile and intersects the results.
 *
 * Lifted verbatim out of `layer.ts`'s `attachContextMenu` — the item
 * set, the ids, the sort values, the `os.files.tile-menu` filter and
 * its argument shape are all unchanged, because plugin authors have
 * been filtering that list since it shipped. What's new is the
 * multi-selection metadata on the built-ins: `multi`, `multiId`,
 * `bulkLabel` and `bulk`.
 *
 * Which built-ins opted in, and why the rest didn't:
 *
 *   Open              yes — fan-out, with a confirm past a handful
 *                     of windows.
 *   Move to Trash     yes — one batched runner, one Undo. Folder and
 *                     file entries share `multiId: 'trash'` so a
 *                     mixed selection can still be thrown away.
 *   Hide from desktop yes — one settings write for the whole set.
 *   Rename…           no  — one name, one thing.
 *   Navigate into     no  — a dossier is about one entity.
 *   Download          no  — browsers block multi-navigation; the
 *                     folder .zip entry is the real answer.
 */

import { applyFilters } from '../hooks';
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

/**
 * How many windows we'll open from one gesture before asking. Past
 * this the user has almost certainly mis-selected, and N windows is
 * a mess to undo by hand.
 */
const OPEN_CONFIRM_THRESHOLD = 5;

/**
 * The batched Trash runner, as ONE function reference shared by the
 * folder entry and the file entry.
 *
 * They merge on `multiId: 'trash'`, and the resolver batches by
 * runner IDENTITY — each distinct `bulk` function is called once with
 * the items that declared it. Written inline at each site these would
 * be two different closures over the same helper, so a mixed
 * selection would produce two calls and therefore two toasts with two
 * Undos, for what the user did as one gesture. Sharing the reference
 * keeps it one of each.
 */
const trashMany = ( placements: RestPlacementShape[] ): Promise< void > =>
	trashManyWithUndo( placements );

/** Open every placement in a set, checking first if the set is large. */
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

/** Open the rename dialog for a folder placement and persist the result. */
function renameFolder( placement: RestPlacementShape ): void {
	const folderId = parseInt( placement.file.ref, 10 );
	if ( ! folderId ) {
		return;
	}
	// Renaming is purely cosmetic — the folder's numeric `id` is the
	// only thing placements, folder windows, and the auto-place orphan
	// backfill ever reference. Updating `name` can never break a
	// reference.
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
			// Optimistic rename: patch the store so the tile + any open
			// folder window retitle immediately, then sync to REST.
			// Roll back on failure.
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
				// Refresh the placement list for the tile's parent so
				// all folder views (root + open folder windows that
				// contain this folder as a child) see the new label.
				const refreshed = await rest.listPlacements( placement.parentId );
				filesStoreApi.setFolderPlacements(
					placement.parentId,
					refreshed.placements,
				);
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( '[openstation] rename folder failed:', err );
				filesStoreApi.upsertPlacement( {
					...placement,
					file: { ...placement.file, title: previousTitle },
				} );
			}
		},
	} );
}

/** Route a "Navigate into" pick to My WordPress's detail dossier. */
function navigateIntoPost( placement: RestPlacementShape ): void {
	const postId = parseInt( placement.file.ref, 10 );
	if ( ! postId ) {
		return;
	}
	const api = (
		window.wp as
			| {
					os?: {
						myWordpress?: {
							openDetail: ( a: {
								entityId: string;
								postId: number;
								postTitle: string;
							} ) => void;
						};
					};
			}
			| undefined
	)?.os?.myWordpress;
	// Map the post type → the My WordPress entity id. Pages live under
	// `pages`; everything else (post + CPTs) defaults to `posts`.
	const postType =
		typeof placement.file.postType === 'string'
			? ( placement.file.postType as string )
			: 'post';
	const entityId = postType === 'page' ? 'pages' : 'posts';
	api?.openDetail( {
		entityId,
		postId,
		postTitle: placement.file.title || `#${ postId }`,
	} );
}

/**
 * Build the action list for one placement, with the
 * `os.files.tile-menu` filter applied.
 *
 * @public
 */
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

	// "Navigate into" — drills into the entity's detail dossier
	// (Author / Comments / Tags / Categories / Attached media /
	// Revisions) via My WordPress's existing detail view.
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
		// Only surface "Move folder to Trash" when the server says the
		// viewer is allowed to. For a recipient's root placement of a
		// SHARED folder the share-trash gate returns false (the correct
		// affordance is "Leave shared folder", added by
		// `share-menu-items.ts`), so the destructive entry stays out of
		// their menu entirely. `undefined` falls through for legacy
		// payloads — the server REST 403 + toast still backstop those.
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
		// Two cases get "Hide from desktop" instead of "Move to Trash":
		//
		//   1. Synthetic shortcuts — an admin menu or a launcher the
		//      user put on the wallpaper. They aren't real placements;
		//      they're derived from the navigation and live only in the
		//      in-memory store, so trashing them would 404 on the REST
		//      endpoint.
		//
		//   2. Plugin-registered icons (file type `'shortcut'`) — Content
		//      Graph, Recycle Bin, My WordPress, and any icon registered
		//      via `openstation_register_icon()`. These are framework /
		//      plugin shortcuts, not user data, and shouldn't be
		//      deletable from the wallpaper. The user can hide them here
		//      and restore via OpenStation Preferences → Navigation.
		//
		// Both drop the desktop region from the item's placement — the
		// layout dispatcher's settings subscription takes the tile off
		// the wallpaper on the next tick.
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
			// Only surface "Move to Trash" when the server says the
			// viewer is allowed to. `canTrash === false` applies to
			// placements inside a shared folder where the viewer lacks
			// write capability — without this guard the user could pick
			// the menu item, attempt the REST call, and only see the
			// failure logged to the console while the tile sat un-moved.
			// `undefined` (legacy payloads) falls through to "let it
			// through" so older clients keep behaving as today.
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
