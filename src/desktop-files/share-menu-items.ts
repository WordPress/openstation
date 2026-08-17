/**
 * OpenStation — Sharing entry points + visual cues.
 *
 * Three wire-ups, all reusing the framework hook surface so a
 * future plugin can override them:
 *
 *   1. Tile context menu — adds "Share folder…" when the
 *      placement is a folder AND viewer is the owner.
 *   2. Title-bar button on folder windows — same gate, opens the
 *      share-settings modal.
 *   3. Tile overlay badge — paints a small people glyph when the
 *      folder's `shareSummary.shared` flag is true.
 *
 * Activated once on boot from `src/desktop-files/index.ts`.
 */

import { addFilter, addAction } from '../hooks';
import { registerTitleBarButton } from '../title-bar-buttons/registry';
import type { Window as DesktopWindow } from '../window';
import { openShareSettingsModal } from './share-settings-modal';
import { getFilesState, removePlacement, setFolderPlacements } from './store';
import { leaveShare, listPlacements } from './rest';
import { showToast } from '../toast';
// `../os-confirm`, not the component module: this file ships in
// `desktop.min.js`, and the wrapper there awaits the lazy
// shell-overlays bundle instead of dragging the dialog class (and
// its tag registration) into the main bundle.
import { osConfirm } from '../os-confirm';
import type { RestPlacementShape } from './rest';
import type { TileMenuItem } from './tile-menu';

function viewerId(): number {
	return Number( window.openStationConfig?.currentUserId ?? 0 );
}

/**
 * Close an open window by id, via the public `wp.os` namespace.
 *
 * Reached structurally rather than by importing the manager: this
 * file ships in `desktop.min.js` and the window system is a lazily
 * loaded bundle.
 *
 * Closing lives on the Window, not on the manager. An earlier version
 * of this call read `window.openStation.windowManager.close( id )` —
 * a global the shell never defines, and a method that does not exist
 * on the manager either. Optional chaining meant it threw nothing and
 * did nothing, so leaving a shared folder quietly left its window
 * open.
 *
 * @param id Window id to close. Unknown ids are a no-op.
 */
function closeWindowById( id: string ): void {
	const manager = (
		window.wp as
			| { os?: { windowManager?: WindowManagerSlice } }
			| undefined
	)?.os?.windowManager;
	manager?.getById?.( id )?.close?.();
}

/** The slice of the public window manager {@link closeWindowById} needs. */
interface WindowManagerSlice {
	getById?: ( id: string ) => { close?: () => void } | undefined;
}

/**
 * Reads the per-user kill switch from the live OS Settings
 * snapshot. Defaults to `true` so the share UI keeps working in
 * the (unusual) window between bundle boot and the first
 * settings hydrate. Every share-related callback short-circuits
 * on this — when the user has flipped sharing off, the tile-menu
 * filter returns the unchanged item list, the title-bar match
 * predicate returns `false`, and the invite banner subscriber
 * exits early.
 */
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

/**
 * Boot — register every entry point + cue.
 */
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
			// Resolve ownership through the canonical folder row
			// in the shared store (the placement.file shape doesn't
			// always carry ownerId — depends on OpenStation_Folder_File
			// serialize()). Falls back to placement-side hint.
			const ownerId =
				folderOwnerId( folderId ) || placementOwnerId( placement );
			const viewer = viewerId();
			if ( ownerId === viewer ) {
				// Owner — show "Share folder…" / "Manage sharing…".
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
				// Recipient — show "Leave shared folder".
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
							// Optimistic: drop the placement from
							// the store immediately so the tile
							// disappears without waiting for the
							// next heartbeat tick.
							removePlacement( placement.id );
							// Authoritative re-sync: pull the root
							// list so anything else that changed
							// (cascade-trashed children, position
							// shifts) lands in the store now.
							try {
								const res = await listPlacements( 0 );
								setFolderPlacements( 0, res.placements );
							} catch ( _e ) {
								// Non-fatal — heartbeat will catch up.
							}
							// Also close any open folder window for
							// this folder — the user just left it,
							// no point keeping it open.
							// Reached through `wp.os` — the public
							// namespace. This read used to go via
							// `window.openStation.windowManager.close`,
							// neither of which exists (the global is
							// never defined, and closing is a method on
							// the Window, not the manager), so the
							// window was silently left open.
							const winId = `os-folder-${ folderId }`;
							closeWindowById( winId );
							showToast( { message: 'You left the shared folder.' } );
						} catch ( err ) {
							showToast( {
								message: `Could not leave: ${ ( err as Error ).message }`,
							} );
						}
					},
				} );
			}
			return items;
		},
	);

	// Title-bar button on folder windows. The match function inspects
	// the window's baseId to detect folder windows; ownership of the
	// folder is checked at click time via the modal's REST list (the
	// shell doesn't carry per-window ownership info, but the modal
	// hits owner-gated `listShares` and renders an error if the
	// viewer isn't allowed to manage).
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
			// Owner-only: recipients see the folder but can't manage
			// shares. They use "Leave shared folder" on the tile
			// instead.
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

	// Overlay badge on shared folder tiles. The action fires for
	// every tile render; we early-out when not a shared folder.
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
