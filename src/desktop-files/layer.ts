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
import { openCreateFolderDialog } from './create-folder-dialog';
import { openFile } from './open';
import { resolve as resolveFileType } from './registry';
import {
	buildOccupiedSet,
	cellKey,
	cellToPos,
	GRID_CELL_H,
	GRID_CELL_W,
	GRID_PADDING,
	nextRowMajorCell,
	pointToCell,
	snapToEmptyCell,
} from './grid';
import type { RestPlacementShape } from './rest';
import type { FilesState } from './store';
import { isConflict, showConflictToast } from './conflict-toast';
import type { DragManagerApi, DropTarget } from '../drag';
import { trashFolderWithUndo, trashPlacementWithUndo } from './trash';
import type {
	DesktopFileDragData,
	ShortcutDragData,
} from './drag-payloads';

/**
 * Read the runtime DragManager. Boot order guarantees this exists by
 * the time any layer mounts: `desktop.ts` constructs the manager and
 * exposes it on `wp.desktop.dragManager` BEFORE `mountFilesLayer()`
 * is called. We re-read each access rather than caching to make
 * per-test overrides possible (vitest can stub `wp.desktop.dragManager`
 * before the layer mounts).
 */
function getDragManager(): DragManagerApi | null {
	const api = (
		window as { wp?: { desktop?: { dragManager?: DragManagerApi } } }
	).wp?.desktop?.dragManager;
	return api ?? null;
}

const LAYER_CLASS = 'desktop-mode-files-layer';

/**
 * Sort modes accepted by `FilesLayer.sort()`. Same keys the icon-
 * canvas Sort By menu uses (and the wallpaper's own sort callback).
 *
 * @public
 * @since 0.8.0
 */
export type FilesLayerSortMode =
	| 'name-asc'
	| 'name-desc'
	| 'date-asc'
	| 'date-desc';

export interface FilesLayer {
	host: HTMLElement;
	folderId: number;
	/**
	 * Subscribe to selection changes inside this layer. Fires with
	 * the newly-selected placement (or `null` when the user clicked
	 * empty canvas to deselect). Returns an unsubscribe function.
	 *
	 * @since 0.8.0
	 */
	onSelectionChange: (
		cb: ( placement: RestPlacementShape | null ) => void,
	) => () => void;
	/**
	 * Sort the visible tiles row-major into a clean grid in the
	 * requested order, persisting each new (x, y) to REST. Same
	 * gesture macOS Finder calls "Clean Up By → Name / Date."
	 *
	 * @since 0.8.0
	 */
	sort: ( mode: FilesLayerSortMode ) => void;
	/**
	 * Visually re-flow tiles into the current canvas width when the
	 * stored layout overflows. Cheap, doesn't persist — the next
	 * drag or sort writes back to REST.
	 *
	 * @since 0.8.0
	 */
	reflow: () => void;
	dispose: () => void;
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
	let selectedId: number | null = null;
	type SelectionListener = (
		placement: RestPlacementShape | null,
	) => void;
	const selectionListeners = new Set< SelectionListener >();
	const notifySelection = (
		placement: RestPlacementShape | null,
	): void => {
		for ( const cb of selectionListeners ) {
			try {
				cb( placement );
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error(
					'[desktop-mode] files: selection listener threw:',
					err,
				);
			}
		}
	};
	const setSelected = (
		placement: RestPlacementShape | null,
	): void => {
		const newId = placement ? placement.id : null;
		if ( newId === selectedId ) {
			return;
		}
		// Strip the previous tile's class.
		container
			.querySelectorAll( `.${ TILE_CLASS }--selected` )
			.forEach( ( n ) => n.classList.remove( `${ TILE_CLASS }--selected` ) );
		if ( placement ) {
			const tile = container.querySelector< HTMLElement >(
				`[data-placement-id="${ placement.id }"]`,
			);
			tile?.classList.add( `${ TILE_CLASS }--selected` );
		}
		selectedId = newId;
		notifySelection( placement );
	};

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
		// Folder drop targets are tile-scoped — the previous tile DOM
		// nodes are detached by `replaceChildren` above. Deregister
		// before rebuilding so the registry doesn't keep stale
		// references (registry uses `id`, so a re-register would
		// overwrite, but deregistering keeps the list tight while
		// the new tiles are being built).
		for ( const [ , deregister ] of folderDropDeregisters ) {
			try {
				deregister();
			} catch {
				// ignore
			}
		}
		folderDropDeregisters.clear();

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
				// No drag wiring on pinned tiles by design — they
				// anchor to a fixed slot. We deliberately DO NOT
				// surface any upfront visual cue (no special cursor,
				// bump animation, or tooltip): the tile looks +
				// reacts identically to any other tile, and the
				// (silent) failure to drag becomes the feedback at
				// the moment the user attempts it. This was the
				// 0.9.0 design call — pre-emptive cues read as "this
				// tile is broken/disabled" even though clicking it
				// opens the window normally.
				attachContextMenu( tile, placement );
				attachSelectOnClick( tile, placement );
				container.appendChild( tile );
				continue;
			}
			const moved = displaced.get( placement.id );
			if ( moved ) {
				setTilePosition( tile, moved.x, moved.y );
			}
			attachTileDrag( tile, placement, folderId );
			attachContextMenu( tile, placement );
			attachSelectOnClick( tile, placement );
			// Folder tiles also accept drag-out drops — dropping a
			// post (or any shortcut payload) on a folder icon files
			// the shortcut INTO that folder rather than next to the
			// folder on the wallpaper.
			if ( placement.file.type === 'folder' ) {
				const targetFolderId = parseInt( placement.file.ref, 10 );
				if ( targetFolderId > 0 ) {
					const dragManager = getDragManager();
					if ( dragManager ) {
						const deregister = registerFolderDropTarget(
							dragManager,
							tile,
							targetFolderId,
							folderId,
						);
						folderDropDeregisters.set( placement.id, deregister );
					}
				}
			}
			container.appendChild( tile );
		}
		// If the previously-selected tile is gone (deleted, moved
		// folders), drop the selection so the right pane can clear.
		if (
			selectedId !== null &&
			! container.querySelector( `[data-placement-id="${ selectedId }"]` )
		) {
			selectedId = null;
			notifySelection( null );
		} else if ( selectedId !== null ) {
			// Re-apply the selected class after a wholesale rebuild.
			const tile = container.querySelector< HTMLElement >(
				`[data-placement-id="${ selectedId }"]`,
			);
			tile?.classList.add( `${ TILE_CLASS }--selected` );
		}
		doAction( 'desktop-mode.files.grid-rendered', {
			folderId,
			count: list.length,
		} );
	};

	// Drop target for the layer's host element. Accepts both
	// `'desktop-file'` payloads (an existing tile being moved into
	// this folder, or repositioned within it) and `'shortcut'`
	// payloads (an external entity — post, page, user — being filed
	// as a new shortcut). The DragManager hit-tests deepest-first,
	// so a folder tile WITHIN this canvas claims its own region
	// before the canvas does.
	const dropTargetDeregisters: Array< () => void > = [];
	// Per-folder-tile drop registrations — keyed by placement id so a
	// repaint can deregister stale entries before rebuilding the
	// container's children.
	const folderDropDeregisters: Map< number, () => void > = new Map();
	const canvasDropTarget: DropTarget = {
		id: `desktop-mode-files-canvas-${ folderId }`,
		element: host,
		accept: ( payload ) =>
			payload.type === 'desktop-file' || payload.type === 'shortcut',
		onEnter: () => {
			host.setAttribute( 'data-files-drop-active', '' );
		},
		onLeave: () => {
			host.removeAttribute( 'data-files-drop-active' );
		},
		onDrop: ( session, ev ) => {
			host.removeAttribute( 'data-files-drop-active' );
			const rect = container.getBoundingClientRect();
			const rawX = Math.max( 0, ev.clientX - rect.left );
			const rawY = Math.max( 0, ev.clientY - rect.top );
			const peers =
				filesStoreApi.getState().placementsByFolder.get( folderId ) ?? [];

			if ( session.payload.type === 'desktop-file' ) {
				const data = session.payload.data as unknown as DesktopFileDragData;
				const occupied = buildOccupiedSet( peers, data.placement.id );
				const cell = snapToEmptyCell( rawX, rawY, occupied, host );
				const next: RestPlacementShape = {
					...data.placement,
					x: cell.x,
					y: cell.y,
					parentId: folderId,
				};
				filesStoreApi.upsertPlacement( next );
				// Notify the shell that a tile was placed by the user
				// (not by Sort By / Clean Up). The desktop root listens
				// to drop out of auto-arrange mode so the user's manual
				// position survives the next desktop resize.
				doAction( 'desktop-mode.files.tile-manually-placed', {
					folderId,
					placementId: data.placement.id,
				} );
				void rest
					.updatePlacement(
						data.placement.id,
						{
							x: cell.x,
							y: cell.y,
							parentId: folderId,
						},
						data.placement.updatedAtMs,
					)
					.then( ( server ) => {
						filesStoreApi.upsertPlacement( server, 'remote' );
					} )
					.catch( ( err ) => {
						if ( isConflict( err ) ) {
							showConflictToast( err );
						} else {
							// eslint-disable-next-line no-console
							console.error(
								'[desktop-mode] files: drag persist failed',
								err,
							);
						}
						filesStoreApi.upsertPlacement( data.placement );
					} );
				return;
			}

			if ( session.payload.type === 'shortcut' ) {
				const data = session.payload.data as unknown as ShortcutDragData;
				// New shortcut — pack row-major (top-left, then across)
				// so the new tile lands at a visible cell regardless of
				// where the user released the cursor. Cursor-position
				// snap is wrong for shortcut creates because users
				// rarely aim precisely; row-major is the "tidy" outcome.
				const occupied = buildOccupiedSet( peers );
				const cell = nextRowMajorCell( occupied, host );
				void rest
					.createPlacement( {
						parentId: folderId,
						type: data.kind,
						ref: data.ref,
						x: cell.x,
						y: cell.y,
					} )
					.then( ( placement ) => {
						filesStoreApi.upsertPlacement( placement );
						doAction( 'desktop-mode.files.shortcut-dropped', {
							folderId,
							placement,
						} );
					} )
					.catch( ( err: unknown ) => {
						// eslint-disable-next-line no-console
						console.error(
							'[desktop-mode] shortcut drop failed:',
							err,
						);
					} );
				// `rawX` / `rawY` retained for parity with desktop-file
				// case logging if a future hook needs the cursor pos.
				void rawX;
				void rawY;
			}
		},
	};
	const dragManagerForLayer = getDragManager();
	if ( dragManagerForLayer ) {
		dropTargetDeregisters.push(
			dragManagerForLayer.registerDropTarget( canvasDropTarget ),
		);
	}

	// Single-click on tile = select; click on bare canvas =
	// deselect. Same model as macOS Finder / Explorer. Tile clicks
	// fire `attachSelectOnClick`'s handler (added per-tile during
	// repaint); the canvas-level click below catches "click landed
	// on the layer container or host but not on any tile."
	const onCanvasClick = ( e: MouseEvent ): void => {
		if ( e.target instanceof Element && e.target.closest( `.${ TILE_CLASS }` ) ) {
			return;
		}
		setSelected( null );
	};
	host.addEventListener( 'click', onCanvasClick );

	// Per-tile click handler attached during repaint. Captured
	// here so the per-tile closure can reach `setSelected`.
	function attachSelectOnClick(
		tile: HTMLElement,
		placement: RestPlacementShape,
	): void {
		tile.addEventListener( 'click', ( e: MouseEvent ) => {
			// Tile is a `<button>` — its native focus + click would
			// bubble to the canvas-level click and immediately
			// deselect. Stop the bubble.
			e.stopPropagation();
			setSelected( placement );
		} );
	}

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

	/**
	 * Compute how many tile columns fit in the current canvas
	 * width. Used by both `sort` and `reflow`. Falls back to a
	 * sensible 4-col default when the host hasn't been measured
	 * yet (cold render, before the layout pass).
	 */
	const colsForWidth = (): number => {
		const w = host.clientWidth > 0 ? host.clientWidth : 4 * GRID_CELL_W;
		return Math.max( 1, Math.floor( ( w - GRID_PADDING ) / GRID_CELL_W ) );
	};

	const sortPlacements = (
		list: readonly RestPlacementShape[],
		mode: FilesLayerSortMode,
	): RestPlacementShape[] => {
		const sorted = list.slice();
		switch ( mode ) {
			case 'name-asc':
				sorted.sort( ( a, b ) =>
					a.file.title.localeCompare( b.file.title ),
				);
				break;
			case 'name-desc':
				sorted.sort( ( a, b ) =>
					b.file.title.localeCompare( a.file.title ),
				);
				break;
			case 'date-asc':
				sorted.sort( ( a, b ) => a.updatedAtMs - b.updatedAtMs );
				break;
			case 'date-desc':
				sorted.sort( ( a, b ) => b.updatedAtMs - a.updatedAtMs );
				break;
		}
		return sorted;
	};

	const sort = ( mode: FilesLayerSortMode ): void => {
		const live = filesStoreApi.getState().placementsByFolder.get( folderId );
		if ( ! live || live.length === 0 ) {
			return;
		}
		// Pinned tiles keep their reserved column-0 slots regardless
		// of sort order — same invariant the repaint enforces.
		const pinned = live.filter( ( p ) => isPinned( p ) );
		const draggable = live.filter( ( p ) => ! isPinned( p ) );
		const sorted = sortPlacements( draggable, mode );

		const cols = colsForWidth();
		// Reserve column 0, rows 0..pinnedCount-1 for pinned tiles.
		const occupied = new Set< string >();
		for ( let i = 0; i < pinned.length; i += 1 ) {
			occupied.add( cellKey( 0, i ) );
		}
		// Row-major fill, skipping pinned-occupied cells.
		let idx = 0;
		const nextCell = (): { col: number; row: number } => {
			while ( true ) {
				const row = Math.floor( idx / cols );
				const col = idx % cols;
				idx += 1;
				if ( ! occupied.has( cellKey( col, row ) ) ) {
					return { col, row };
				}
			}
		};

		sorted.forEach( ( p, i ) => {
			const cell = nextCell();
			const x = GRID_PADDING + cell.col * GRID_CELL_W;
			const y = GRID_PADDING + cell.row * GRID_CELL_H;
			const next: RestPlacementShape = {
				...p,
				x,
				y,
				sortOrder: i,
			};
			filesStoreApi.upsertPlacement( next );
			void rest
				.updatePlacement( p.id, { x, y, sortOrder: i } )
				.catch( ( err: unknown ) => {
					// eslint-disable-next-line no-console
					console.error(
						'[desktop-mode] files: sort persist failed',
						err,
					);
				} );
		} );
	};

	/**
	 * If any tile would render past the canvas's right edge given
	 * its stored (x, y), do an in-memory row-major reflow so the
	 * user sees them all without needing to scroll horizontally.
	 * Doesn't persist — once the user drags a tile after the
	 * reflow, that single drag is what sticks. Repaints clobber
	 * the visual reflow on the next store change, so we apply
	 * positions directly via DOM mutation.
	 */
	const reflow = (): void => {
		const live = filesStoreApi.getState().placementsByFolder.get( folderId );
		if ( ! live || live.length === 0 ) {
			return;
		}
		const w = host.clientWidth > 0 ? host.clientWidth : Infinity;
		const overflowing = live.some( ( p ) => {
			const right = p.x + GRID_CELL_W;
			return right > w;
		} );
		if ( ! overflowing ) {
			return;
		}
		const cols = colsForWidth();
		// Pinned tiles keep their slot — see `sort` above for the
		// same recipe.
		const pinned = live.filter( ( p ) => isPinned( p ) );
		const draggable = live.filter( ( p ) => ! isPinned( p ) );
		const occupied = new Set< string >();
		for ( let i = 0; i < pinned.length; i += 1 ) {
			occupied.add( cellKey( 0, i ) );
		}
		let idx = 0;
		const nextCell = (): { col: number; row: number } => {
			while ( true ) {
				const row = Math.floor( idx / cols );
				const col = idx % cols;
				idx += 1;
				if ( ! occupied.has( cellKey( col, row ) ) ) {
					return { col, row };
				}
			}
		};
		for ( const p of draggable ) {
			const cell = nextCell();
			const x = GRID_PADDING + cell.col * GRID_CELL_W;
			const y = GRID_PADDING + cell.row * GRID_CELL_H;
			const tile = container.querySelector< HTMLElement >(
				`[data-placement-id="${ p.id }"]`,
			);
			if ( tile ) {
				setTilePosition( tile, x, y );
			}
		}
	};

	// Watch the host for width changes — fire `reflow` whenever a
	// resize would clip tiles off the right edge. Same mechanism
	// the My WordPress canvas uses; folders share the model.
	let lastWidth = host.clientWidth;
	let resizeObserver: ResizeObserver | null = null;
	if ( typeof ResizeObserver !== 'undefined' ) {
		resizeObserver = new ResizeObserver( () => {
			const w = host.clientWidth;
			if ( w === lastWidth ) {
				return;
			}
			lastWidth = w;
			reflow();
		} );
		resizeObserver.observe( host );
	}

	return {
		host,
		folderId,
		onSelectionChange( cb ) {
			selectionListeners.add( cb );
			return () => {
				selectionListeners.delete( cb );
			};
		},
		sort,
		reflow,
		dispose() {
			off();
			resizeObserver?.disconnect();
			resizeObserver = null;
			for ( const deregister of dropTargetDeregisters ) {
				try {
					deregister();
				} catch {
					// ignore
				}
			}
			dropTargetDeregisters.length = 0;
			for ( const deregister of folderDropDeregisters.values() ) {
				try {
					deregister();
				} catch {
					// ignore
				}
			}
			folderDropDeregisters.clear();
			host.removeEventListener( 'click', onCanvasClick );
			selectionListeners.clear();
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
 * If `placement` is a synthesized shortcut from a dock-item the user
 * promoted to the desktop (via OS Settings → Apps & Icons), return
 * the source dock-item id. Returns `null` for real placements.
 *
 * Marker key matches the one written by
 * `settings/desktop-shortcuts-sync.ts`.
 */
function readSynthSource( placement: RestPlacementShape ): string | null {
	const meta = placement.meta;
	if ( ! meta || typeof meta !== 'object' ) {
		return null;
	}
	const v = ( meta as Record< string, unknown > ).__synthFromDockItem;
	return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * Hide a dock item the user previously promoted onto the desktop.
 * Mutates `OsSettingsState.itemVisibility[ dockItemId ]` to `'dock'`
 * via the public API; the shortcuts-sync subscription removes the
 * synthetic placement on the next tick.
 */
function hidePromotedDockItem( dockItemId: string ): void {
	const api = (
		window as unknown as {
			wp?: {
				desktop?: {
					getOsSettings?: () => {
						itemVisibility: Record< string, string >;
					};
					updateOsSettings?: ( patch: {
						itemVisibility?: Record< string, string >;
					} ) => void;
				};
			};
		}
	).wp?.desktop;
	if ( ! api?.getOsSettings || ! api?.updateOsSettings ) {
		return;
	}
	const current = api.getOsSettings().itemVisibility ?? {};
	const next = { ...current, [ dockItemId ]: 'dock' };
	api.updateOsSettings( { itemVisibility: next } );
}

/**
 * Register a folder tile as a drop target. Folder tiles claim their
 * own hit-test region; the DragManager routes the drop here when the
 * cursor releases over a folder (the registry's deepest-match wins
 * over the layer-level canvas target). Returns a deregister function
 * the caller stores so the next repaint can release the registration
 * before rebuilding the DOM.
 */
function registerFolderDropTarget(
	dragManager: DragManagerApi,
	tile: HTMLElement,
	targetFolderId: number,
	currentFolderId: number,
): () => void {
	const target: DropTarget = {
		id: `desktop-mode-files-folder-${ targetFolderId }-tile-${ tile.dataset.placementId ?? '?' }`,
		element: tile,
		accept: ( payload ) => {
			if ( payload.type !== 'desktop-file' && payload.type !== 'shortcut' ) {
				return false;
			}
			if ( payload.type === 'desktop-file' ) {
				const data = payload.data as unknown as DesktopFileDragData;
				// Don't accept a folder dropped onto itself.
				if (
					data.placement.file.type === 'folder' &&
					parseInt( data.placement.file.ref, 10 ) === targetFolderId
				) {
					return false;
				}
				// No-op move: dropping a tile from folder X onto folder
				// X's own tile would just round-trip via REST. Reject
				// so the user gets reject feedback instead of a silent
				// no-op.
				if ( data.placement.parentId === targetFolderId ) {
					return false;
				}
			}
			return true;
		},
		onEnter: () => {
			tile.classList.add( `${ TILE_CLASS }--drop-target` );
		},
		onLeave: () => {
			tile.classList.remove( `${ TILE_CLASS }--drop-target` );
		},
		onDrop: ( session ) => {
			tile.classList.remove( `${ TILE_CLASS }--drop-target` );
			if ( session.payload.type === 'desktop-file' ) {
				const data = session.payload.data as unknown as DesktopFileDragData;
				const next: RestPlacementShape = {
					...data.placement,
					parentId: targetFolderId,
				};
				filesStoreApi.upsertPlacement( next );
				void rest
					.updatePlacement(
						data.placement.id,
						{ parentId: targetFolderId },
						data.placement.updatedAtMs,
					)
					.then( ( server ) => {
						filesStoreApi.upsertPlacement( server, 'remote' );
					} )
					.catch( ( err ) => {
						if ( isConflict( err ) ) {
							showConflictToast( err );
						} else {
							// eslint-disable-next-line no-console
							console.error(
								'[desktop-mode] files: move-into-folder persist failed',
								err,
							);
						}
						filesStoreApi.upsertPlacement( data.placement );
					} );
				return;
			}
			if ( session.payload.type === 'shortcut' ) {
				const data = session.payload.data as unknown as ShortcutDragData;
				const peers =
					filesStoreApi
						.getState()
						.placementsByFolder.get( targetFolderId ) ?? [];
				// Row-major pack so newly-filed shortcuts land at the
				// top of the (likely-not-yet-mounted) folder window.
				// We can't read the destination folder window's host
				// width from here, so default to 4 cols inside
				// `nextRowMajorCell` — sensible for any folder window.
				const cell = nextRowMajorCell( buildOccupiedSet( peers ) );
				void rest
					.createPlacement( {
						parentId: targetFolderId,
						type: data.kind,
						ref: data.ref,
						x: cell.x,
						y: cell.y,
					} )
					.then( ( placement ) => {
						filesStoreApi.upsertPlacement( placement );
						doAction( 'desktop-mode.files.shortcut-dropped', {
							folderId: targetFolderId,
							placement,
						} );
					} )
					.catch( ( err: unknown ) => {
						// eslint-disable-next-line no-console
						console.error(
							'[desktop-mode] shortcut drop into folder failed:',
							err,
						);
					} );
			}
		},
	};
	// `currentFolderId` is preserved in the closure so a future
	// extension (e.g. tracking moves vs. shortcut creations from the
	// SAME folder) has the parameter ready.
	void currentFolderId;
	return dragManager.registerDropTarget( target );
}

/**
 * Attach the pointer-based drag start handler to a draggable tile.
 * The DragManager owns everything after `pointerdown`: the document-
 * level pointermove/up listeners, the ghost element, hit-testing,
 * cancellation. We just translate the visible position into the
 * payload `data` so drop targets can compute snap geometry without
 * a second round-trip through the layer.
 *
 * Crucially: we do NOT call `setPointerCapture` here. Pointer capture
 * redirects subsequent pointer events to the captured element, which
 * historically broke HTML5 drag-detection on tiles that were also
 * `draggable=true` (the My WordPress entity-tile bug). The
 * DragManager's document-level listeners need no capture and pay
 * nothing for not having one.
 */
function attachTileDrag(
	tile: HTMLElement,
	placement: RestPlacementShape,
	folderId: number,
): void {
	tile.addEventListener( 'pointerdown', ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			return;
		}
		const dragManager = getDragManager();
		if ( ! dragManager ) {
			// Manager not available (test, headless boot). Fall
			// through to the click/select handler so the tile is at
			// least selectable.
			return;
		}
		// Read the tile's CURRENT visible position from the inline
		// styles, not the placement's server-stored (x, y). They
		// diverge when the layer has displaced this tile to dodge
		// a pinned slot — using `placement.x` would snap the tile
		// back to its stored coords on the first pointermove (the
		// "drag jumps to the pinned slot" bug).
		const visibleX = parseFloat( tile.style.left ) || placement.x;
		const visibleY = parseFloat( tile.style.top ) || placement.y;
		const session = dragManager.start( {
			payload: {
				type: 'desktop-file',
				source: tile,
				data: {
					placement,
					sourceFolderId: folderId,
				} satisfies DesktopFileDragData,
				ghost: {
					offsetX: e.clientX - tile.getBoundingClientRect().left,
					offsetY: e.clientY - tile.getBoundingClientRect().top,
				},
			},
			origin: e,
			// `onClickOnly` intentionally empty — a tile click is
			// handled by the dedicated `attachSelectOnClick` listener
			// below, which fires from the regular `click` event after
			// a sub-threshold pointerup. The manager won't fire a
			// `click` itself; the browser does.
		} );
		// Preserve a reference for diagnostics — the manager owns
		// lifecycle past this point.
		void session;
		void visibleX;
		void visibleY;
	} );
}

/**
 * Wire right-click → context menu on a tile. Items vary by file
 * type — folders get a "Delete folder" that wipes the underlying
 * folder row plus its placements; non-folder user placements get
 * "Move to Trash" that drops only the placement (the entity stays
 * intact — that's the file-references-not-copies contract).
 * Plugin-registered icons (file type `'shortcut'`) and synthetic
 * dock-promotion shortcuts get "Hide from desktop" instead — they
 * aren't user data, so they're hidden via the visibility map and
 * restorable from OS Settings → Apps & Icons rather than trashed.
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

		// "Navigate into" — drills into the entity's detail dossier
		// (Author / Comments / Tags / Categories / Attached media /
		// Revisions). For post-type tiles, route straight to My
		// WordPress's existing detail view via the public
		// `wp.desktop.myWordpress.openDetail` API — no duplication
		// of the dossier code here.
		if ( placement.file.type === 'post' ) {
			items.push( {
				id: 'navigate-into',
				label: 'Navigate into',
				icon: 'dashicons-category',
				sort: 20,
				onClick: () => {
					const postId = parseInt( placement.file.ref, 10 );
					if ( ! postId ) {
						return;
					}
					const api = (
						window.wp as
							| {
									desktop?: {
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
					)?.desktop?.myWordpress;
					// Map the post type → the My WordPress entity
					// id. Pages live under `pages`; everything else
					// (post + CPTs) defaults to `posts`. The shape
					// matches the entities config the My WordPress
					// PHP module ships.
					const postType =
						typeof placement.file.postType === 'string'
							? ( placement.file.postType as string )
							: 'post';
					const entityId =
						postType === 'page' ? 'pages' : 'posts';
					api?.openDetail( {
						entityId,
						postId,
						postTitle: placement.file.title || `#${ postId }`,
					} );
				},
			} );
		}

		const isFolder = placement.file.type === 'folder';
		if ( isFolder ) {
			items.push( {
				id: 'rename-folder',
				label: 'Rename…',
				icon: 'dashicons-edit',
				sort: 30,
				onClick: () => {
					const folderId = parseInt( placement.file.ref, 10 );
					if ( ! folderId ) {
						return;
					}
					// Renaming is purely cosmetic — the folder's
					// numeric `id` is the only thing placements,
					// folder windows, and the auto-place orphan
					// backfill ever reference. Updating `name`
					// can never break a reference.
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
							// Optimistic rename: patch the store so
							// the tile + any open folder window
							// retitle immediately, then sync to REST.
							// Roll back on failure.
							const previousTitle = placement.file.title;
							const optimistic: RestPlacementShape = {
								...placement,
								file: { ...placement.file, title: trimmed },
							};
							filesStoreApi.upsertPlacement( optimistic );
							try {
								const folderUpdatedAtMs =
									filesStoreApi
										.getState()
										.folders.get( folderId )?.updatedAtMs ?? 0;
								const updated = await rest.updateFolder(
									folderId,
									{ name: trimmed },
									folderUpdatedAtMs,
								);
								filesStoreApi.upsertFolder( updated );
								// Refresh the placement list for the
								// tile's parent so all folder views
								// (root + open folder windows that
								// contain this folder as a child) see
								// the new label.
								const refreshed = await rest.listPlacements(
									placement.parentId,
								);
								filesStoreApi.setFolderPlacements(
									placement.parentId,
									refreshed.placements,
								);
							} catch ( err ) {
								// eslint-disable-next-line no-console
								console.error(
									'[desktop-mode] rename folder failed:',
									err,
								);
								// Roll back the optimistic title.
								filesStoreApi.upsertPlacement( {
									...placement,
									file: {
										...placement.file,
										title: previousTitle,
									},
								} );
							}
						},
					} );
				},
			} );
			items.push( {
				id: 'delete-folder',
				label: 'Move folder to Trash',
				icon: 'dashicons-trash',
				sort: 90,
				danger: true,
				onClick: () => trashFolderWithUndo( placement ),
			} );
		} else {
			// Two cases get "Hide from desktop" instead of "Move to
			// Trash":
			//
			//   1. Synthetic shortcuts the user promoted from a dock
			//      item via OS Settings → Apps & Icons. They aren't
			//      real placements — they're derived from the
			//      visibility map and live only in the in-memory store,
			//      so trashing them would 404 on the REST endpoint.
			//
			//   2. Plugin-registered icons (file type `'shortcut'`) —
			//      Content Graph, Recycle Bin, My WordPress, and any
			//      icon registered via `desktop_mode_register_icon()`.
			//      These are framework/plugin shortcuts, not user
			//      data, and shouldn't be deletable from the wallpaper.
			//      The user can hide them here and restore via OS
			//      Settings → Apps & Icons.
			//
			// Both write `itemVisibility[ id ] = 'dock'` — the layout
			// dispatcher's settings subscription drops the desktop tile
			// on the next tick.
			const synthFromDockItem = readSynthSource( placement );
			const isRegisteredIcon = placement.file.type === 'shortcut';
			if ( synthFromDockItem || isRegisteredIcon ) {
				const hideId = synthFromDockItem ?? placement.file.ref;
				items.push( {
					id: 'hide-from-desktop',
					label: 'Hide from desktop',
					icon: 'dashicons-hidden',
					sort: 90,
					onClick: () => hidePromotedDockItem( hideId ),
				} );
			} else {
				items.push( {
					id: 'remove',
					label: 'Move to Trash',
					icon: 'dashicons-trash',
					sort: 90,
					danger: true,
					onClick: () => trashPlacementWithUndo( placement ),
				} );
			}
		}
		openTileMenu( { x: e.clientX, y: e.clientY }, { placement, items } );
	} );
}
