import { addFilter } from '../hooks';
import { showToast } from '../toast';
import { toastRestFailure } from '../core/rest-failure';
import { navigateToDownload } from './download-nav';
import { openFileShareModal } from './overlays-loader';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import {
	getFolderZipUrl,
	getUploadDownloadUrl,
	leaveFileShare,
	listPlacements,
	type RestPlacementShape,
} from './rest';
import { removePlacement, setFolderPlacements } from './store';

import { osConfirm } from '../os-confirm';
import type { TileMenuItem } from './tile-menu';

function viewerId(): number {
	return Number( window.openStationConfig?.currentUserId ?? 0 );
}

interface StorageConfigShape {
	canUpload?: boolean;
	zipAvailable?: boolean;
}

function storageConfig(): StorageConfigShape {
	return (
		( window.openStationConfig as { desktopStorage?: StorageConfigShape } | undefined )
			?.desktopStorage ?? {}
	);
}

function sharingEnabled(): boolean {
	const settings = ( window as unknown as {
		wp?: { os?: { getOsSettings?: () => { foldersSharingEnabled?: boolean } } };
	} ).wp?.os?.getOsSettings?.();
	if ( ! settings ) {
		return true;
	}
	return settings.foldersSharingEnabled !== false;
}

function uploadFileId( placement: RestPlacementShape ): number | null {
	if ( placement.file.type !== 'upload' ) {
		return null;
	}
	const id = Number( placement.file.ref );
	return Number.isFinite( id ) && id > 0 ? id : null;
}

export function installUploadMenuItems(): void {
	addFilter(
		'os.files.tile-menu',
		'desktop-mode/uploads',
		(
			items: TileMenuItem[],
			placement: RestPlacementShape,
		): TileMenuItem[] => {
			if ( placement.file.type === 'folder' && storageConfig().zipAvailable ) {
				const folderId = Number( placement.file.ref );
				if ( Number.isFinite( folderId ) && folderId > 0 ) {
					items.push( {
						id: 'desktop-mode/folder-zip-download',
						label: 'Download as .zip',
						icon: 'dashicons-download',
						sort: 45,
						onClick: () => {
							navigateToDownload( getFolderZipUrl( folderId ) );
						},
					} );
				}
				return items;
			}

			const fileId = uploadFileId( placement );
			if ( fileId === null ) {
				return items;
			}

			items.push( {
				id: 'desktop-mode/upload-download',
				label: 'Download',
				icon: 'dashicons-download',
				sort: 40,
				onClick: () => {
					navigateToDownload( getUploadDownloadUrl( fileId ) );
				},
			} );

			const ownerId = Number(
				( placement.file as { ownerId?: number } ).ownerId ?? 0,
			);
			const viewer = viewerId();
			if ( ownerId === viewer && sharingEnabled() ) {
				items.push( {
					id: 'desktop-mode/upload-share',
					label: 'Share file…',
					icon: 'dashicons-share',
					sort: 30,
					onClick: () => {
						void openFileShareModal( {
							fileId,
							fileName:
								placement.file.title || `File ${ fileId }`,
						} );
					},
				} );
			} else if ( ownerId > 0 && ownerId !== viewer && placement.parentId === 0 ) {
				items.push( {
					id: 'desktop-mode/upload-leave',
					label: 'Leave shared file',
					icon: 'dashicons-exit',
					sort: 80,
					danger: true,
					onClick: async () => {
						const ok = await osConfirm( {
							title: 'Leave this shared file?',
							message:
								'The file will be removed from your desktop. The owner keeps the original.',
							confirmLabel: 'Leave',
							danger: true,
						} );
						if ( ! ok ) {
							return;
						}
						try {
							await leaveFileShare( fileId );
							removePlacement( placement.id );
							try {
								const res = await listPlacements( 0 );
								setFolderPlacements( 0, res.placements );
							} catch ( _e ) {

							}
							showToast( { message: 'You left the shared file.' } );
						} catch ( err ) {
							toastRestFailure( showToast, err, { lead: `Could not leave`, fallback: `Could not leave.` } );
						}
					},
				} );
			}
			return items;
		},
	);

	addFilter(
		'os.wallpaper-context-menu',
		'desktop-mode/uploads',
		( items: Array< Record< string, unknown > > ) => {
			if ( ! storageConfig().canUpload ) {
				return items;
			}
			items.push( {
				id: 'desktop-mode/upload-files',
				label: 'Upload files…',
				icon: 'dashicons-upload',
				sort: 15,
				onClick: () => openFilePicker( false ),
			} );
			items.push( {
				id: 'desktop-mode/upload-folder',
				label: 'Upload folder…',
				icon: 'dashicons-portfolio',
				sort: 16,
				onClick: () => openFilePicker( true ),
			} );
			return items;
		},
	);
}

function openFilePicker( directory: boolean ): void {
	const input = document.createElement( 'input' );
	input.type = 'file';
	if ( directory ) {
		input.setAttribute( 'webkitdirectory', '' );
	} else {
		input.multiple = true;
	}
	input.style.display = 'none';
	document.body.appendChild( input );
	input.addEventListener( 'change', () => {
		const files = input.files ? Array.from( input.files ) : [];
		input.remove();
		if ( files.length === 0 ) {
			return;
		}
		void routePickedFiles( files, directory );
	} );
	input.click();
}

async function routePickedFiles( files: File[], directory: boolean ): Promise< void > {
	const url = (
		window as unknown as {
			openStationConfig?: { fileDropBundleUrl?: string };
		}
	).openStationConfig?.fileDropBundleUrl;
	if ( ! url ) {
		return;
	}
	try {
		await loadVendorScript( url );
	} catch {
		showToast( { message: 'Upload machinery failed to load — try again.' } );
		return;
	}
	await window.openStationFileDrop?.routePickedFiles( files, directory );
}
