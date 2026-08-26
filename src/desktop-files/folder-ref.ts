/**
 * OpenStation — Address a folder by id alone.
 *
 * Most code reaches a folder through the placement that renders it:
 * the tile carries a server-serialized {@link DesktopFileShape}, and
 * everything downstream — the opener registry, the window title, the
 * icon — reads it from there.
 *
 * Some code only ever learns a folder's **id**. A 409 conflict says
 * "someone moved this into folder 12"; a deep link names a folder
 * nobody has a tile for. This module is the bridge for those: give it
 * an id, get back a {@link DesktopFile} the normal machinery accepts,
 * so `openFile()` opens a folder window through exactly the same
 * registered opener a double-click goes through.
 *
 * Deliberately a leaf. It imports the store, the registry and the
 * type constants and nothing else — no layer, no opener
 * implementation — so callers on the far side of the files feature
 * (`conflict-toast`, itself imported *by* `layer`) can use it without
 * an import cycle.
 */

import { FOLDER_FILE_ICON } from './built-in-types';
import { getFilesStore } from './store';
import { resolve } from './registry';
import type { DesktopFile } from './file';
import type { DesktopFileShape } from './types';

/**
 * Find the server's own description of a folder among the placements
 * currently in the store.
 *
 * Preferred over anything synthesized: it carries the real title and
 * icon the server serialized, including whatever a plugin's
 * `openstation_files_serialize_file` filter did to them. A folder the
 * viewer has a tile for anywhere in loaded state — the common case,
 * since a conflict arises from moving something around these very
 * folders — resolves here.
 *
 * @param folderId Folder to describe.
 * @return The server shape, or undefined when no loaded placement
 *         represents this folder.
 */
function findServerShape( folderId: number ): DesktopFileShape | undefined {
	const ref = String( folderId );
	const { placementsByFolder } = getFilesStore().state;
	for ( const placements of placementsByFolder.values() ) {
		for ( const placement of placements ) {
			if (
				placement.file?.type === 'folder' &&
				placement.file.ref === ref
			) {
				return placement.file as DesktopFileShape;
			}
		}
	}
	return undefined;
}

/**
 * Build a {@link DesktopFile} for a folder from its id.
 *
 * Resolution order, best source first:
 *   1. A loaded placement's server shape (real title + icon).
 *   2. The folder row in the store (authoritative name, no icon).
 *   3. `fallbackTitle`, then a generic label.
 *
 * `exists: true` is asserted rather than checked — the caller has an
 * id because something server-side just referred to the folder. If it
 * has since been deleted, the opener's own REST calls fail and report
 * that; a client-side guess here would only ever be staler.
 *
 * @param folderId      Folder to address. Must be a positive id;
 *                      folder 0 is the desktop root, which is not a
 *                      window.
 * @param fallbackTitle Title to use when neither the placements nor
 *                      the folder rows in the store know this folder.
 * @return A DesktopFile of type `folder`, ready for `openFile()`.
 */
export function folderFileById(
	folderId: number,
	fallbackTitle?: string,
): DesktopFile {
	const serverShape = findServerShape( folderId );
	if ( serverShape ) {
		return resolve( serverShape );
	}

	const row = getFilesStore().state.folders.get( folderId );
	return resolve( {
		type: 'folder',
		ref: String( folderId ),
		title: row?.name || fallbackTitle || 'Folder',
		icon: FOLDER_FILE_ICON,
		previewUrl: '',
		exists: true,
	} );
}
