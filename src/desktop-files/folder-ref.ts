import { FOLDER_FILE_ICON } from './built-in-types';
import { getFilesStore } from './store';
import { resolve } from './registry';
import type { DesktopFile } from './file';
import type { DesktopFileShape } from './types';

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
