import { addFilter, addAction } from '../hooks';
import { registerTitleBarButton } from '../title-bar-buttons/registry';
import type { Window as DesktopWindow } from '../window';
import { openShareSettingsModal } from './overlays-loader';
import { getFilesState, removePlacement, setFolderPlacements } from './store';
import { leaveShare, listPlacements } from './rest';
import { showToast } from '../toast';
import { toastRestFailure } from '../core/rest-failure';

import { osConfirm } from '../os-confirm';
import type { RestPlacementShape } from './rest';
import type { TileMenuItem } from './tile-menu';

function viewerId(): number {
	return Number( window.openStationConfig?.currentUserId ?? 0 );
}

function closeWindowById( id: string ): void {
	const manager = (
		window.wp as
			| { os?: { windowManager?: WindowManagerSlice } }
			| undefined
	)?.os?.windowManager;
	manager?.getById?.( id )?.close?.();
}

interface WindowManagerSlice {
	getById?: ( id: string ) => { close?: () => void } | undefined;
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

function folderOwnerId( folderId: number ): number {
	const folder = getFilesState().folders.get( folderId );
	return folder ? Number( folder.ownerId ) : 0;
}

function folderIdFromBaseId( baseId: string | undefined | null ): number | null {
	if ( typeof baseId !== 'string' ) {
		return null;
	}
	const m = /^os-folder-(\d+)$/.exec( baseId );
	return m ? Number( m[ 1 ] ) : null;
}

function placementFolderId( placement: RestPlacementShape ): number | null {
	if ( placement.file.type !== 'folder' ) {
		return null;
	}
	const ref = Number( placement.file.ref );
	if ( ! Number.isFinite( ref ) || ref <= 0 ) {
		return null;
	}
	return ref;
}

function placementOwnerId( placement: RestPlacementShape ): number {
	return Number( ( placement.file as { ownerId?: number } ).ownerId ?? 0 );
}

export function installShareMenuItems(): void {
	addFilter(
		'os.files.tile-menu',
		'desktop-mode/folder-share',
		(
			items: TileMenuItem[],
			placement: RestPlacementShape,
		): TileMenuItem[] => {
			if ( ! sharingEnabled() ) {
				return items;
			}
			const folderId = placementFolderId( placement );
			if ( folderId === null ) {
				return items;
			}

			const ownerId =
				folderOwnerId( folderId ) || placementOwnerId( placement );
			const viewer = viewerId();
			if ( ownerId === viewer ) {
				const shared = !! ( placement.file as { shareSummary?: { shared?: boolean } } )
					.shareSummary?.shared;
				const label = shared ? 'Manage sharing…' : 'Share folder…';
				items.push( {
					id: 'desktop-mode/folder-share',
					label,
					icon: 'dashicons-share',
					sort: 30,
					onClick: () => {
						void openShareSettingsModal( {
							folderId,
							folderName: placement.file.title || `Folder ${ folderId }`,
						} );
					},
				} );
			} else if ( ownerId > 0 ) {
				items.push( {
					id: 'desktop-mode/folder-leave',
					label: 'Leave shared folder',
					icon: 'dashicons-exit',
					sort: 80,
					danger: true,
					onClick: async () => {
						const ok = await osConfirm( {
							title: 'Leave this folder?',
							message:
								'The folder will be removed from your desktop. The original and its contents are not deleted; the owner keeps them.',
							confirmLabel: 'Leave',
							danger: true,
						} );
						if ( ! ok ) {
							return;
						}
						try {
							await leaveShare( folderId );

							removePlacement( placement.id );

							try {
								const res = await listPlacements( 0 );
								setFolderPlacements( 0, res.placements );
							} catch ( _e ) {

							}

							const winId = `os-folder-${ folderId }`;
							closeWindowById( winId );
							showToast( { message: 'You left the shared folder.' } );
						} catch ( err ) {
							toastRestFailure( showToast, err, { lead: `Could not leave`, fallback: `Could not leave.` } );
						}
					},
				} );
			}
			return items;
		},
	);

	registerTitleBarButton( {
		id: 'desktop-mode/folder-share',
		label: 'Share folder',
		icon: 'dashicons-share',
		placement: 'right',
		order: 50,
		match: ( w: DesktopWindow ): boolean => {
			if ( ! sharingEnabled() ) {
				return false;
			}
			const base = ( w.config as { baseId?: string } ).baseId ?? w.id;
			const folderId = folderIdFromBaseId( base );
			if ( folderId === null ) {
				return false;
			}

			return folderOwnerId( folderId ) === viewerId();
		},
		onClick: ( w: DesktopWindow ): void => {
			if ( ! sharingEnabled() ) {
				return;
			}
			const base = ( w.config as { baseId?: string } ).baseId ?? w.id;
			const folderId = folderIdFromBaseId( base );
			if ( folderId === null ) {
				return;
			}
			void openShareSettingsModal( {
				folderId,
				folderName: w.config.title || `Folder ${ folderId }`,
			} );
		},
	} );

	addAction(
		'os.files.tile-rendered',
		'desktop-mode/folder-share',
		( payload: unknown ) => {
			const { tile, placement } = payload as {
				tile: HTMLElement;
				placement: RestPlacementShape;
			};
			if ( placement.file.type !== 'folder' ) {
				return;
			}
			const summary = ( placement.file as { shareSummary?: { shared?: boolean } } )
				.shareSummary;
			if ( ! summary?.shared ) {
				return;
			}
			if ( tile.querySelector( '.os-file-tile__share-badge' ) ) {
				return;
			}
			const badge = document.createElement( 'span' );
			badge.className = 'os-file-tile__share-badge dashicons dashicons-share';
			badge.setAttribute( 'aria-label', 'Shared folder' );
			badge.title = 'Shared folder';
			badge.style.cssText = [
				'position:absolute',
				'top:6px',
				'inset-inline-end:6px',
				'background:rgba(0,0,0,0.55)',
				'color:#fff',
				'border-radius:50%',
				'width:18px',
				'height:18px',
				'font-size:12px',
				'line-height:18px',
				'text-align:center',
				'pointer-events:none',
			].join( ';' );
			tile.appendChild( badge );
		},
	);
}
