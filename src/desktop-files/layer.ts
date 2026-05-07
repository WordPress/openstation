/**
 * Desktop Mode — `FilesLayer`.
 *
 * Mounts on a host element (the `#desktop-mode-area` for the
 * desktop root, or a folder-window's body for a sub-folder)
 * and renders the placements stored under one `folderId`.
 *
 * Lifecycle:
 *
 *   1. `mount( host, folderId )` builds the layer container and
 *      hydrates the store from REST (if not already hydrated).
 *   2. The store subscription drives re-paints. The fingerprint
 *      cache short-circuits no-op renders so a non-position
 *      mutation doesn't blow away custom decorations.
 *   3. Drag-within-folder mutates CSS transform live; pointerup
 *      persists via REST and store-upserts the new geometry.
 *   4. `dispose()` unsubscribes and removes the container.
 *
 * Phase 3 only ships drag-within-folder. Cross-folder drags
 * (drop into a folder, drop out to root) and the Recycle Bin
 * drop integration land in later phases.
 *
 * @since 0.9.0
 */

import { doAction } from '../hooks';
import { rest, store as filesStoreApi } from './layer-deps';
import { buildTile, setTilePosition, TILE_CLASS } from './file-tile';
import { openTileMenu, type TileMenuItem } from './tile-menu';
import { openFile } from './open';
import { resolve as resolveFileType } from './registry';
import {
	buildOccupiedSet,
	cellKey,
	cellToPos,
	pointToCell,
	snapToEmptyCell,
} from './grid';
import type { RestPlacementShape } from './rest';
import type { FilesState } from './store';

const LAYER_CLASS = 'desktop-mode-files-layer';

export interface FilesLayer {
	host: HTMLElement;
	folderId: number;
	dispose: () => void;
}

interface DragState {
	pointerId: number;
	tile: HTMLElement;
	placementId: number;
	startX: number;
	startY: number;
	originX: number;
	originY: number;
}

/**
 * Mount a files layer on `host`, scoped to `folderId`. Returns
 * a handle the caller uses to unmount.
 */
export function mountFilesLayer( host: HTMLElement, folderId = 0 ): FilesLayer {
	const container = document.createElement( 'div' );
	container.className = LAYER_CLASS;
	container.setAttribute( 'role', 'list' );
	container.dataset.folderId = String( folderId );
	host.appendChild( container );

	let lastFingerprint = '';

	const repaint = ( state: FilesState ): void => {
		const raw = state.placementsByFolder.get( folderId ) ?? [];
		// Pinned tiles always render first so their slots are
		// stable and other tiles never appear above them.
		const list = raw.slice().sort( ( a, b ) => {
			const ap = isPinned( a ) ? 0 : 1;
			const bp = isPinned( b ) ? 0 : 1;
			return ap - bp;
		} );
		const fp = fingerprint( list );
		if ( fp === lastFingerprint ) {
			return;
		}
		lastFingerprint = fp;

		// Wholesale rebuild — simplest correct strategy. Plugins that
		// want stable decorations re-attach via `tile-rendered`.
		container.replaceChildren();

		// Pinned tiles (registered with `pinned: true` —
		// `desktop_mode_register_icon`) anchor to a fixed slot and
		// drop the drag wiring entirely. Today the only pinned
		// surface is the framework "My WordPress" shortcut, but the
		// flag is generic so anything that should never move can
		// opt in.
		// Reserve column 0, top-down, for pinned tiles. Their
		// server-stored (x, y) is ignored — the visual slot is
		// purely a function of their pinned-order index.
		const pinnedSlots = new Map< number, { x: number; y: number } >();
		const occupiedCells = new Set< string >();
		let pinnedIdx = 0;
		for ( const placement of list ) {
			if ( ! isPinned( placement ) ) {
				continue;
			}
			const slot = cellToPos( 0, pinnedIdx );
			pinnedSlots.set( placement.id, { x: slot.x, y: slot.y } );
			occupiedCells.add( cellKey( slot.col, slot.row ) );
			pinnedIdx += 1;
		}

		// Pre-compute display cells for non-pinned tiles, evicting
		// any whose stored coords land on a pinned slot. Pre-existing
		// data from before pinned shortcuts existed (e.g. Recycle Bin
		// already living at (0, 0)) would otherwise overlap visually
		// with the new anchored "My WordPress" tile. Process in
		// stored-position order so pre-pinned tiles keep their
		// relative ordering when displaced.
		const displaced = new Map<
			number,
			{ x: number; y: number }
		>();
		for ( const placement of list ) {
			if ( pinnedSlots.has( placement.id ) ) {
				continue;
			}
			const target = pointToCell( placement.x, placement.y );
			const key = cellKey( target.col, target.row );
			if ( ! occupiedCells.has( key ) ) {
				occupiedCells.add( key );
				continue;
			}
			// Stored cell is taken (by a pinned tile or an already-
			// displaced peer). Snap to the next free cell.
			const free = snapToEmptyCell(
				placement.x,
				placement.y,
				occupiedCells,
				host,
			);
			occupiedCells.add( cellKey( free.col, free.row ) );
			displaced.set( placement.id, { x: free.x, y: free.y } );
		}

		for ( const placement of list ) {
			const tile = buildTile( placement, folderId );
			const pinnedSlot = pinnedSlots.get( placement.id );
			if ( pinnedSlot ) {
				setTilePosition( tile, pinnedSlot.x, pinnedSlot.y );
				tile.classList.add( `${ TILE_CLASS }--pinned` );
				tile.setAttribute( 'aria-roledescription', 'pinned shortcut' );
				// No drag wiring; right-click context menu is still
				// useful (Open / Cleanup / etc.).
				attachContextMenu( tile, placement );
				container.appendChild( tile );
				continue;
			}
			const moved = displaced.get( placement.id );
			if ( moved ) {
				setTilePosition( tile, moved.x, moved.y );
			}
			attachDragHandlers( tile, placement, folderId );
			attachContextMenu( tile, placement );
			container.appendChild( tile );
		}
		doAction( 'desktop-mode.files.grid-rendered', {
			folderId,
			count: list.length,
		} );
	};

	// Initial paint from whatever the store currently knows.
	repaint( filesStoreApi.getState() );
	const off = filesStoreApi.subscribe( repaint );

	// Hydrate from REST if we haven't seen this folder yet.
	if ( ! filesStoreApi.getState().hydratedFolders.has( folderId ) ) {
		void rest
			.listPlacements( folderId )
			.then( ( res ) => {
				filesStoreApi.setFolderPlacements( folderId, res.placements );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( '[desktop-mode] files: failed to hydrate folder', folderId, err );
			} );
	}

	return {
		host,
		folderId,
		dispose() {
			off();
			container.remove();
		},
	};
}

/**
 * Build a stable fingerprint of the placement list for the
 * fingerprint-cache short-circuit. Position / parent / sort
 * changes flip the fingerprint; pure decoration mutations
 * (badges set on tiles after render) don't.
 */
function fingerprint( list: readonly RestPlacementShape[] ): string {
	if ( list.length === 0 ) {
		return '0';
	}
	const parts: string[] = [];
	for ( const p of list ) {
		parts.push(
			`${ p.id }:${ p.parentId }:${ p.x }:${ p.y }:${ p.sortOrder }:${ p.updatedAtMs }:${ p.file.type }:${ p.file.ref }:${ p.file.title }:${ p.file.icon }:${ isPinned( p ) ? 1 : 0 }`,
		);
	}
	return parts.join( '|' );
}

/**
 * Whether a placement is pinned (anchored, non-draggable). The flag
 * is carried through the file payload from
 * `desktop_mode_register_icon( …, [ 'pinned' => true ] )`.
 */
function isPinned( placement: RestPlacementShape ): boolean {
	return Boolean( placement.file.pinned );
}

/**
 * Attach pointer-based drag handlers. Drag is transform-only
 * during pointermove (so we don't churn the fingerprint cache
 * on every frame); on pointerup we persist via REST and let
 * the store update flip the fingerprint, which triggers one
 * paint at the new resting position.
 */
function attachDragHandlers(
	tile: HTMLElement,
	placement: RestPlacementShape,
	folderId: number,
): void {
	let drag: DragState | null = null;

	const onPointerDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 ) {
			return;
		}
		// Read the tile's CURRENT visible position from the inline
		// styles, not the placement's server-stored (x, y). They
		// diverge when the layer has displaced this tile to dodge
		// a pinned slot — using `placement.x` would snap the tile
		// back to its stored coords on the first pointermove
		// (the "drag jumps to the My WordPress slot" bug).
		const visibleX = parseFloat( tile.style.left ) || placement.x;
		const visibleY = parseFloat( tile.style.top ) || placement.y;
		drag = {
			pointerId: e.pointerId,
			tile,
			placementId: placement.id,
			startX: e.clientX,
			startY: e.clientY,
			originX: visibleX,
			originY: visibleY,
		};
		tile.setPointerCapture( e.pointerId );
		tile.classList.add( `${ TILE_CLASS }--dragging` );
	};

	const onPointerMove = ( e: PointerEvent ): void => {
		if ( ! drag || drag.pointerId !== e.pointerId ) {
			return;
		}
		const dx = e.clientX - drag.startX;
		const dy = e.clientY - drag.startY;
		setTilePosition( tile, drag.originX + dx, drag.originY + dy );
	};

	const onPointerEnd = ( e: PointerEvent ): void => {
		if ( ! drag || drag.pointerId !== e.pointerId ) {
			return;
		}
		tile.classList.remove( `${ TILE_CLASS }--dragging` );
		try {
			tile.releasePointerCapture( e.pointerId );
		} catch {
			// Already released — ignore.
		}
		const dx = e.clientX - drag.startX;
		const dy = e.clientY - drag.startY;
		const moved = Math.abs( dx ) > 2 || Math.abs( dy ) > 2;
		const finalX = drag.originX + dx;
		const finalY = drag.originY + dy;
		const placementId = drag.placementId;
		drag = null;

		if ( ! moved ) {
			// Treat as a click — let the dblclick handler in the tile
			// builder fire if the user intended that.
			return;
		}

		// Determine the target cell + whether the drop landed on
		// another tile. If the occupier is a folder we move INTO
		// that folder; if it's anything else we snap to the next
		// empty cell so tiles never overlap.
		const peers = filesStoreApi.getState().placementsByFolder.get( folderId ) ?? [];

		const droppedOn = findDropTarget( peers, finalX, finalY, placementId );
		if ( droppedOn && droppedOn.file.type === 'folder' ) {
			const newParent = parseInt( droppedOn.file.ref, 10 );
			if ( newParent ) {
				// Move the tile out of the current folder bucket
				// (parent change) — the local store handles the
				// cross-bucket bookkeeping in `upsertPlacement`.
				const next: RestPlacementShape = {
					...placement,
					parentId: newParent,
				};
				filesStoreApi.upsertPlacement( next );
				void rest
					.updatePlacement( placementId, { parentId: newParent } )
					.then( ( server ) => {
						filesStoreApi.upsertPlacement( server, 'remote' );
					} )
					.catch( ( err ) => {
						// eslint-disable-next-line no-console
						console.error(
							'[desktop-mode] files: move-into-folder persist failed',
							err,
						);
						// Roll back to the previous parent + position.
						filesStoreApi.upsertPlacement( placement );
					} );
				return;
			}
		}

		const occupiedSet = buildOccupiedSet( peers, placementId );
		// `tile.parentElement` is the layer container; its parent
		// is the host (desktop area or folder-window body) — that's
		// the element whose height the snap respects.
		const host = tile.parentElement?.parentElement ?? null;
		const cell = snapToEmptyCell( finalX, finalY, occupiedSet, host );
		const snappedX = cell.x;
		const snappedY = cell.y;

		// Optimistic store update so the tile stays where it was
		// dropped even before REST returns.
		const next: RestPlacementShape = {
			...placement,
			x: snappedX,
			y: snappedY,
			parentId: folderId,
		};
		filesStoreApi.upsertPlacement( next );

		void rest
			.updatePlacement( placementId, { x: snappedX, y: snappedY } )
			.then( ( server ) => {
				filesStoreApi.upsertPlacement( server, 'remote' );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( '[desktop-mode] files: drag persist failed', err );
				// Roll back the optimistic update.
				filesStoreApi.upsertPlacement( placement );
			} );
	};

	tile.addEventListener( 'pointerdown', onPointerDown );
	tile.addEventListener( 'pointermove', onPointerMove );
	tile.addEventListener( 'pointerup', onPointerEnd );
	tile.addEventListener( 'pointercancel', onPointerEnd );
}

/**
 * Find the placement currently sitting on the cell `(x, y)` maps
 * to (excluding the moving placement). Returns null when the
 * target cell is empty.
 */
function findDropTarget(
	peers: RestPlacementShape[],
	x: number,
	y: number,
	excludeId: number,
): RestPlacementShape | null {
	const cell = pointToCell( x, y );
	for ( const p of peers ) {
		if ( p.id === excludeId ) {
			continue;
		}
		const c = pointToCell( p.x, p.y );
		if ( c.col === cell.col && c.row === cell.row ) {
			return p;
		}
	}
	return null;
}

/**
 * Wire right-click → context menu on a tile. Items vary by file
 * type — folders get a "Delete folder" that wipes the underlying
 * folder row plus its placements; non-folders get "Remove from
 * desktop" that drops only the placement (the entity stays
 * intact — that's the file-references-not-copies contract).
 */
function attachContextMenu(
	tile: HTMLElement,
	placement: RestPlacementShape,
): void {
	tile.addEventListener( 'contextmenu', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		const items: TileMenuItem[] = [
			{
				id: 'open',
				label: 'Open',
				icon: 'dashicons-external',
				sort: 10,
				onClick: () => {
					const file = resolveFileType( placement.file );
					void openFile( file );
				},
			},
		];
		const isFolder = placement.file.type === 'folder';
		if ( isFolder ) {
			items.push( {
				id: 'delete-folder',
				label: 'Delete folder',
				icon: 'dashicons-trash',
				sort: 90,
				danger: true,
				onClick: async () => {
					const folderId = parseInt( placement.file.ref, 10 );
					if ( ! folderId ) {
						return;
					}
					// Optimistic local eviction: remove the placement
					// and the folder row from the store right away so
					// the tile disappears without waiting on the
					// network. Any rollback on REST failure restores
					// it via the catch branch.
					filesStoreApi.removePlacement( placement.id );
					filesStoreApi.removeFolder( folderId );
					try {
						await rest.deleteFolder( folderId );
					} catch ( err ) {
						// eslint-disable-next-line no-console
						console.error( '[desktop-mode] deleteFolder failed:', err );
						// Best-effort rollback: re-fetch the root so the
						// store catches up with reality.
						void rest.listPlacements( 0 ).then( ( res ) => {
							filesStoreApi.setFolderPlacements( 0, res.placements );
						} );
					}
				},
			} );
		} else {
			items.push( {
				id: 'remove',
				label: 'Remove from desktop',
				icon: 'dashicons-no-alt',
				sort: 90,
				danger: true,
				onClick: async () => {
					filesStoreApi.removePlacement( placement.id );
					try {
						await rest.deletePlacement( placement.id );
					} catch ( err ) {
						// eslint-disable-next-line no-console
						console.error( '[desktop-mode] deletePlacement failed:', err );
						void rest.listPlacements( placement.parentId ).then( ( res ) => {
							filesStoreApi.setFolderPlacements( placement.parentId, res.placements );
						} );
					}
				},
			} );
		}
		openTileMenu( { x: e.clientX, y: e.clientY }, { placement, items } );
	} );
}
