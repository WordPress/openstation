/**
 * OpenStation — Media Library entries on upload tiles.
 *
 * A file dragged onto the desktop lives in desktop storage, not the
 * Media Library. These tile-menu entries are the way across:
 *
 *   Add to Media Library      — any stored file the site would
 *                               accept as an upload (`file.isMedia`,
 *                               decided server-side and filterable
 *                               there). Multi-select aware: one call
 *                               per file, one toast for the batch.
 *   Start a post with this…   — images only. The server copies the
 *   Start a page with this…     file into the Media Library, creates
 *                               an auto-draft with the image block
 *                               and featured image in place, and the
 *                               edit screen opens in a window.
 *
 * The copy is idempotent per stored file, so "Add" twice, or "Add"
 * then "Start a post", never duplicates the attachment.
 *
 * Contributed through the public `os.files.tile-menu` filter, like
 * every other built-in entry, so a plugin can reorder or hide them.
 * Activated once on boot from `src/desktop-files/index.ts`.
 */

import { addFilter } from '../hooks';
import { showToast } from '../toast';
import { toastRestFailure } from '../core/rest-failure';
import { openUrlWindow } from './open';
import {
	addUploadToMediaLibrary,
	startPostFromUpload,
	type RestMediaAttachmentShape,
	type RestPlacementShape,
} from './rest';
import type { TileMenuItem } from './tile-menu';

interface MediaConfigShape {
	canAddToMedia?: boolean;
	canStartPost?: boolean;
	canStartPage?: boolean;
}

function mediaConfig(): MediaConfigShape {
	return (
		( window.openStationConfig as { desktopStorage?: MediaConfigShape } | undefined )
			?.desktopStorage ?? {}
	);
}

interface UploadFields {
	isMedia?: boolean;
	kind?: string;
}

/** The stored-file id of a media-capable upload tile, or `null`. */
function mediaFileId( placement: RestPlacementShape ): number | null {
	if ( placement.file.type !== 'upload' ) {
		return null;
	}
	if ( ( placement.file as UploadFields ).isMedia !== true ) {
		return null;
	}
	const id = Number( placement.file.ref );
	return Number.isFinite( id ) && id > 0 ? id : null;
}

function isImage( placement: RestPlacementShape ): boolean {
	return ( placement.file as UploadFields ).kind === 'image';
}

/** The toast for one file added — with the attachment a click away. */
function toastAdded( attachment: RestMediaAttachmentShape ): void {
	showToast( {
		message: attachment.created
			? 'Added to the Media Library.'
			: 'Already in the Media Library.',
		action: {
			label: 'Open',
			onClick: () => {
				openUrlWindow( {
					url: attachment.editUrl,
					title: attachment.title || 'Attachment',
					icon: 'dashicons-admin-media',
				} );
			},
		},
	} );
}

async function addOne( fileId: number ): Promise< void > {
	try {
		toastAdded( await addUploadToMediaLibrary( fileId ) );
	} catch ( err ) {
		toastRestFailure( showToast, err, { lead: `Could not add to the Media Library`, fallback: `Could not add to the Media Library.` } );
	}
}

/**
 * The batched runner, ONE reference for every entry that declares
 * it — the resolver batches by identity, so a shared reference is
 * what turns a multi-selection into one toast.
 */
const addMany = async ( placements: RestPlacementShape[] ): Promise< void > => {
	let added = 0;
	let existing = 0;
	let failed = 0;
	for ( const placement of placements ) {
		const fileId = mediaFileId( placement );
		if ( fileId === null ) {
			continue;
		}
		try {
			const res = await addUploadToMediaLibrary( fileId );
			if ( res.created ) {
				added += 1;
			} else {
				existing += 1;
			}
		} catch {
			failed += 1;
		}
	}
	const parts: string[] = [];
	if ( added > 0 ) {
		parts.push( `Added ${ added } ${ added === 1 ? 'file' : 'files' } to the Media Library.` );
	}
	if ( existing > 0 ) {
		parts.push( `${ existing } already there.` );
	}
	if ( failed > 0 ) {
		parts.push( `${ failed } could not be added.` );
	}
	if ( parts.length > 0 ) {
		showToast( { message: parts.join( ' ' ) } );
	}
};

async function startPost( fileId: number, postType: 'post' | 'page' ): Promise< void > {
	try {
		const res = await startPostFromUpload( fileId, postType );
		const opened = openUrlWindow( {
			url: res.editUrl,
			title: postType === 'page' ? 'Add New Page' : 'Add New Post',
			icon: postType === 'page' ? 'dashicons-admin-page' : 'dashicons-admin-post',
		} );
		if ( ! opened ) {
			window.location.href = res.editUrl;
		}
	} catch ( err ) {
		toastRestFailure( showToast, err, { lead: `Could not start a ${ postType }`, fallback: `Could not start a ${ postType }.` } );
	}
}

/**
 * Boot — register the tile-menu entries.
 */
export function installMediaMenuItems(): void {
	addFilter(
		'os.files.tile-menu',
		'desktop-mode/media-library',
		(
			items: TileMenuItem[],
			placement: RestPlacementShape,
		): TileMenuItem[] => {
			const fileId = mediaFileId( placement );
			if ( fileId === null ) {
				return items;
			}
			const config = mediaConfig();
			if ( ! config.canAddToMedia ) {
				return items;
			}

			items.push( {
				id: 'desktop-mode/upload-add-to-media',
				label: 'Add to Media Library',
				icon: 'dashicons-admin-media',
				sort: 50,
				multi: true,
				bulkLabel: ( n ) => `Add ${ n } files to Media Library`,
				bulk: addMany,
				onClick: () => addOne( fileId ),
			} );

			if ( ! isImage( placement ) ) {
				return items;
			}
			if ( config.canStartPost ) {
				items.push( {
					id: 'desktop-mode/upload-start-post',
					label: 'Start a post with this image',
					icon: 'dashicons-admin-post',
					sort: 55,
					onClick: () => startPost( fileId, 'post' ),
				} );
			}
			if ( config.canStartPage ) {
				items.push( {
					id: 'desktop-mode/upload-start-page',
					label: 'Start a page with this image',
					icon: 'dashicons-admin-page',
					sort: 56,
					onClick: () => startPost( fileId, 'page' ),
				} );
			}
			return items;
		},
	);
}
