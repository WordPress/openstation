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
import type { DragBridgePayload } from '../drag-bridge';
import { isConflict, showConflictToast } from './conflict-toast';
import type { DragManagerApi, DragSession, DropTarget } from '../drag';
import { trashFolderWithUndo, trashPlacementWithUndo } from './trash';
import type {
	DesktopFileDragData,
	ShortcutDragData,
} from './drag-payloads';

/**
 * Build a cross-frame bridge payload from a placement, or return
 * `undefined` when the placement's file type isn't one we know how
 * to deliver into an iframe (anything outside attachment/post/user).
 *
 * The placement's `file` shape carries everything we need because
 * the PHP `Desktop_Mode_*_File::serialize()` methods surface `link`
 * / `sourceUrl` / `alt` / `mime` / `postType` on every list
 * response.
 *
 * @since 0.8.7
 */
function buildBridgePayloadFromPlacement(
	placement: RestPlacementShape,
): DragBridgePayload | undefined {
	const file = placement.file;
	if ( ! file ) {
		return undefined;
	}
	const id = parseInt( String( file.ref ?? '' ), 10 );
	if ( ! Number.isFinite( id ) || id <= 0 ) {
		return undefined;
	}
	const title = String( file.title ?? '' );
	if ( file.type === 'attachment' ) {
		const url = String( file.sourceUrl ?? file.previewUrl ?? '' );
		return {
			kind: 'attachment',
			id,
			url,
			title,
			alt: String( file.alt ?? '' ),
			mime: String( file.mime ?? '' ),
			thumbnailUrl: file.previewUrl
				? String( file.previewUrl )
				: undefined,
		};
	}
	if ( file.type === 'post' ) {
		return {
			kind: 'post',
			id,
			postType: String( file.postType ?? 'post' ),
			url: String( file.link ?? '' ),
			title,
		};
	}
	if ( file.type === 'user' ) {
		return {
			kind: 'user',
			id,
			url: String( file.link ?? '' ),
			title,
		};
	}
	return undefined;
}

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
	/**
	 * Resolves once this folder's initial REST hydration has settled
	 * (either the placements list returned and was upserted into the
	 * store, OR the folder was already hydrated from a previous mount
	 * and no REST call was needed).
	 *
	 * Boot path uses this to defer revealing the desktop area until
	 * the icon set is final, so the user doesn't see a brief paint
	 * with only server-side wallpaper icons (then a re-paint a frame
	 * later when REST returns the folders + placements). Never
	 * rejects — REST failure is reported via `console.error` from the
	 * mount path and the promise still resolves so the caller's
	 * reveal-after-hydrate isn't stranded forever.
	 *
	 * @since 0.8.5
	 */
	readonly hydrated: Promise< void >;
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
		// Selected state lives on the `selected` attribute —
		// `<wpd-tile>._paint()` derives the `--selected` class from
		// it. Toggling the class directly survives until the next
		// attribute change repaints the tile and wipes it.
		container
			.querySelectorAll( `.${ TILE_CLASS }--selected` )
			.forEach( ( n ) => n.removeAttribute( 'selected' ) );
		if ( placement ) {
			const tile = container.querySelector< HTMLElement >(
				`[data-placement-id="${ placement.id }"]`,
			);
			tile?.setAttribute( 'selected', '' );
		}
		selectedId = newId;
		notifySelection( placement );
	};

	/**
	 * Compute pinned-slot map + displaced map for a list. Shared by
	 * the wholesale rebuild and the incremental path so both end up
	 * with bit-identical layouts.
	 */
	const computeLayout = (
		list: readonly RestPlacementShape[],
	): {
		pinnedSlots: Map< number, { x: number; y: number } >;
		displaced: Map< number, { x: number; y: number } >;
	} => {
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
		const displaced = new Map< number, { x: number; y: number } >();
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
			const free = snapToEmptyCell(
				placement.x,
				placement.y,
				occupiedCells,
				host,
			);
			occupiedCells.add( cellKey( free.col, free.row ) );
			displaced.set( placement.id, { x: free.x, y: free.y } );
		}
		return { pinnedSlots, displaced };
	};

	/**
	 * Apply final position to an existing tile based on the pinned /
	 * displaced / stored coordinates. Pure DOM mutation — no rebuild.
	 */
	const applyTilePosition = (
		tile: HTMLElement,
		placement: RestPlacementShape,
		pinnedSlots: Map< number, { x: number; y: number } >,
		displaced: Map< number, { x: number; y: number } >,
	): void => {
		const pinned = pinnedSlots.get( placement.id );
		const moved = displaced.get( placement.id );
		if ( pinned ) {
			setTilePosition( tile, pinned.x, pinned.y );
		} else if ( moved ) {
			setTilePosition( tile, moved.x, moved.y );
		} else {
			setTilePosition( tile, placement.x, placement.y );
		}
	};

	/**
	 * Build a fully-wired tile DOM node for a placement. Encapsulates
	 * everything the wholesale rebuild used to do inline per tile:
	 * position, drag wiring, context menu, click-select, drop-target
	 * registrations. Used by BOTH the wholesale rebuild and the
	 * incremental add path so the behaviour stays in lock-step.
	 *
	 * Caller is responsible for appending the returned element to
	 * `container`.
	 */
	const wireTile = (
		placement: RestPlacementShape,
		pinnedSlots: Map< number, { x: number; y: number } >,
		displaced: Map< number, { x: number; y: number } >,
	): HTMLElement => {
		const tile = buildTile( placement, folderId );
		const pinnedSlot = pinnedSlots.get( placement.id );
		if ( pinnedSlot ) {
			setTilePosition( tile, pinnedSlot.x, pinnedSlot.y );
			tile.classList.add( `${ TILE_CLASS }--pinned` );
			attachContextMenu( tile, placement );
			attachSelectOnClick( tile, placement );
			if ( shouldRejectTileDrops( placement ) ) {
				const dragManager = getDragManager();
				if ( dragManager ) {
					const deregister = dragManager.registerDropTarget( {
						id: `desktop-mode-files-tile-${ placement.id }-reject`,
						element: tile,
						accept: () => false,
						onDrop: () => {},
					} );
					tileRejectDeregisters.set( placement.id, deregister );
				}
			}
			return tile;
		}
		const moved = displaced.get( placement.id );
		if ( moved ) {
			setTilePosition( tile, moved.x, moved.y );
		}
		attachTileDrag( tile, placement, folderId );
		attachContextMenu( tile, placement );
		attachSelectOnClick( tile, placement );
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
		} else if ( shouldRejectTileDrops( placement ) ) {
			const dragManager = getDragManager();
			if ( dragManager ) {
				const deregister = dragManager.registerDropTarget( {
					id: `desktop-mode-files-tile-${ placement.id }-reject`,
					element: tile,
					accept: () => false,
					onDrop: () => {},
				} );
				tileRejectDeregisters.set( placement.id, deregister );
			}
		}
		return tile;
	};

	/**
	 * Incremental repaint path — handles the common "added and/or
	 * removed one or more placements, otherwise same set" case
	 * without nuking the entire container's DOM. Preserves DOM
	 * identity for unchanged tiles so the user doesn't see a
	 * "desktop reload" flash on file creation, shortcut drop, or
	 * deletion.
	 *
	 * Returns `true` if the patch applied; `false` if the caller
	 * must fall through to the wholesale rebuild. Bails when ANY
	 * shared tile has a structural change (file-type, file-ref,
	 * pinned-flag) — those cases need the wholesale path's full
	 * re-wiring.
	 *
	 * @since 0.8.7
	 */
	const tryPatchIncremental = (
		list: readonly RestPlacementShape[],
	): boolean => {
		const existing = new Map< number, HTMLElement >();
		for ( const tile of container.querySelectorAll< HTMLElement >(
			'[data-placement-id]',
		) ) {
			const raw = tile.dataset.placementId ?? '';
			const id = parseInt( raw, 10 );
			if ( raw === '' || ( Number.isNaN( id ) && raw !== '-0' ) ) {
				return false;
			}
			existing.set( id, tile );
		}

		const wantIds = new Set< number >();
		for ( const placement of list ) {
			wantIds.add( placement.id );
		}

		// Verify every SHARED id has matching structural fields. If
		// any differ (file-type, file-ref, or pinned flag flipped),
		// the wholesale path's full re-wiring is needed.
		for ( const placement of list ) {
			const tile = existing.get( placement.id );
			if ( ! tile ) {
				continue; // added — handled below.
			}
			if ( tile.dataset.fileType !== placement.file.type ) {
				return false;
			}
			if ( tile.dataset.fileRef !== placement.file.ref ) {
				return false;
			}
			const wasPinned = tile.classList.contains(
				`${ TILE_CLASS }--pinned`,
			);
			if ( wasPinned !== isPinned( placement ) ) {
				return false;
			}
		}

		// Remove tiles whose placements are gone — deregister their
		// drop-target claims first so the registry doesn't keep
		// detached-element references.
		for ( const [ id, tile ] of existing ) {
			if ( wantIds.has( id ) ) {
				continue;
			}
			const folderDereg = folderDropDeregisters.get( id );
			if ( folderDereg ) {
				try {
					folderDereg();
				} catch {
					// ignore
				}
				folderDropDeregisters.delete( id );
			}
			const rejectDereg = tileRejectDeregisters.get( id );
			if ( rejectDereg ) {
				try {
					rejectDereg();
				} catch {
					// ignore
				}
				tileRejectDeregisters.delete( id );
			}
			tile.remove();
		}

		const { pinnedSlots, displaced } = computeLayout( list );

		// Update positions on shared tiles + build new ones for adds.
		for ( const placement of list ) {
			const tile = existing.get( placement.id );
			if ( tile ) {
				applyTilePosition( tile, placement, pinnedSlots, displaced );
				continue;
			}
			container.appendChild(
				wireTile( placement, pinnedSlots, displaced ),
			);
		}

		// Selection bookkeeping — match the wholesale path so right-
		// pane consumers stay in sync when the selected tile was the
		// removed one.
		if (
			selectedId !== null &&
			! container.querySelector(
				`[data-placement-id="${ selectedId }"]`,
			)
		) {
			selectedId = null;
			notifySelection( null );
		}

		doAction( 'desktop-mode.files.grid-rendered', {
			folderId,
			count: list.length,
		} );

		return true;
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

		// Fastest path: position-only changes (intra-folder drag,
		// auto-arrange). Same set, same structure, no rewiring.
		if ( tryPatchPositions( list, container, host ) ) {
			return;
		}

		// Incremental path: same set MOSTLY, with adds and/or removes
		// but no structural mutations on the unchanged tiles. Covers
		// the file-creation, shortcut-drop, and delete flows — which
		// otherwise would each visibly flash the wallpaper with a
		// full `replaceChildren()` rebuild.
		if ( tryPatchIncremental( list ) ) {
			return;
		}

		// Wholesale rebuild — last-resort path for transitions the
		// incremental walker can't handle (pin-flag flips, parent-
		// folder moves, file-type changes). Plugins that want stable
		// decorations re-attach via `tile-rendered`.
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
		for ( const [ , deregister ] of tileRejectDeregisters ) {
			try {
				deregister();
			} catch {
				// ignore
			}
		}
		tileRejectDeregisters.clear();

		// Layout passes — pinned-slot allocation then displacement of
		// non-pinned tiles whose stored coords landed on a pinned
		// slot. Shared with the incremental + fast paths via
		// `computeLayout()`.
		const { pinnedSlots, displaced } = computeLayout( list );

		for ( const placement of list ) {
			container.appendChild(
				wireTile( placement, pinnedSlots, displaced ),
			);
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
			// Re-apply the selected state after a wholesale rebuild
			// (attribute, not class — see notes in `setSelectedId`).
			const tile = container.querySelector< HTMLElement >(
				`[data-placement-id="${ selectedId }"]`,
			);
			tile?.setAttribute( 'selected', '' );
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
	// Per-tile REJECT claimants for non-folder, non-bin shortcut
	// tiles. Without these, dragging onto e.g. the My WordPress tile
	// walks past it to the canvas drop target → green "Drop here to
	// move" chip, but the drop snaps to the next free cell (since
	// pinned/occupied tiles are in the visual-occupied set). The
	// chip text and the actual outcome disagreed. Claiming with
	// `accept: false` paints the red "Can't drop here" chip
	// + reject snap-back instead.
	const tileRejectDeregisters: Map< number, () => void > = new Map();

	// ── Live drop-cell preview ─────────────────────────────────────────
	// A soft outline that hovers at the cell the drop will land in.
	// The user reported drops drifting "down-and-right of where I
	// aimed"; the math fix (subtracting the ghost grab offset) does
	// most of the work, but a visible target helps the gap between
	// "where the cursor is" and "where the snapped cell is" stop
	// being surprising — especially at the edges of the grid where
	// the snap can skip a column.
	//
	// One outline per layer; we install a `pointermove` listener
	// while the canvas is the active hover target, and tear it down
	// the instant we leave / drop. The handlers live in this closure
	// so they can reach `container`, `host`, `folderId`, and the
	// store.
	let dropPreviewEl: HTMLElement | null = null;
	let dropPreviewMoveHandler: ( ( ev: PointerEvent ) => void ) | null = null;
	const installCanvasDropPreview = ( session: DragSession ): void => {
		if ( dropPreviewEl ) {
			return;
		}
		// Only worth previewing for desktop-file payloads — for
		// shortcut creates the layer packs row-major into the next
		// free cell rather than snapping to the cursor, so a
		// cursor-tracking preview would lie about the landing slot.
		if ( session.payload.type !== 'desktop-file' ) {
			return;
		}
		const previewEl = document.createElement( 'div' );
		previewEl.className = 'desktop-mode-files-drop-preview';
		previewEl.setAttribute( 'aria-hidden', 'true' );
		container.appendChild( previewEl );
		dropPreviewEl = previewEl;

		const ghost = session.payload.ghost;
		const offsetX = ghost?.offsetX ?? 0;
		const offsetY = ghost?.offsetY ?? 0;
		const data = session.payload.data as unknown as DesktopFileDragData;
		const movingId = data?.placement?.id;

		const updatePreview = ( clientX: number, clientY: number ): void => {
			const rect = container.getBoundingClientRect();
			const rawX = Math.max( 0, clientX - rect.left - offsetX );
			const rawY = Math.max( 0, clientY - rect.top - offsetY );
			const peers =
				filesStoreApi
					.getState()
					.placementsByFolder.get( folderId ) ?? [];
			const occupied = buildVisualOccupiedSet( peers, movingId );
			const cell = snapToEmptyCell( rawX, rawY, occupied, host );
			previewEl.style.transform = `translate3d(${ cell.x }px, ${ cell.y }px, 0)`;
		};

		// Prime the preview position before the first `pointermove`
		// fires (~16 ms gap). The drag manager hides the source tile
		// via the `--dragging` class but doesn't move it, so its
		// `getBoundingClientRect()` still reads the spot the user
		// grabbed from — we synthesize a cursor at the tile center +
		// offset and feed that into `updatePreview`.
		const sourceRect = session.payload.source.getBoundingClientRect();
		updatePreview(
			sourceRect.left + offsetX,
			sourceRect.top + offsetY,
		);

		const moveHandler = ( ev: PointerEvent ): void => {
			updatePreview( ev.clientX, ev.clientY );
		};
		document.addEventListener( 'pointermove', moveHandler );
		dropPreviewMoveHandler = moveHandler;
	};
	const teardownCanvasDropPreview = (): void => {
		if ( dropPreviewMoveHandler ) {
			document.removeEventListener( 'pointermove', dropPreviewMoveHandler );
			dropPreviewMoveHandler = null;
		}
		if ( dropPreviewEl ) {
			dropPreviewEl.remove();
			dropPreviewEl = null;
		}
	};
	const canvasDropTarget: DropTarget = {
		id: `desktop-mode-files-canvas-${ folderId }`,
		element: host,
		accept: ( payload ) => {
			if ( payload.type !== 'desktop-file' && payload.type !== 'shortcut' ) {
				return false;
			}
			// Folder-cycle preflight for drops onto a folder
			// window's canvas. The wallpaper root (`folderId === 0`)
			// can never be a descendant of any folder, so this only
			// kicks in when a folder window has the canvas. Mirror
			// of the server-side check; the only difference here is
			// instant snap-back vs. a 409 toast after the REST hit.
			if ( folderId > 0 && payload.type === 'desktop-file' ) {
				const data = payload.data as unknown as DesktopFileDragData;
				if ( data.placement.file?.type === 'folder' ) {
					const movingFolderId = parseInt( data.placement.file.ref, 10 );
					if (
						! Number.isNaN( movingFolderId ) &&
						wouldCreateFolderCycle( movingFolderId, folderId )
					) {
						return false;
					}
				}
			}
			return true;
		},
		onEnter: ( session ) => {
			host.setAttribute( 'data-files-drop-active', '' );
			installCanvasDropPreview( session );
		},
		onLeave: () => {
			host.removeAttribute( 'data-files-drop-active' );
			teardownCanvasDropPreview();
		},
		onDrop: ( session, ev ) => {
			host.removeAttribute( 'data-files-drop-active' );
			teardownCanvasDropPreview();
			const rect = container.getBoundingClientRect();
			// Subtract the grab offset so we snap based on where the
			// tile's TOP-LEFT would land, not where the cursor is. The
			// drag manager renders the ghost at
			// `(cursor − ghost.offsetX, cursor − ghost.offsetY)` —
			// without mirroring that here, the drop site would always
			// drift down-and-right of where the user sees the ghost.
			const ghost = session.payload.ghost;
			const offsetX = ghost?.offsetX ?? 0;
			const offsetY = ghost?.offsetY ?? 0;
			const rawX = Math.max( 0, ev.clientX - rect.left - offsetX );
			const rawY = Math.max( 0, ev.clientY - rect.top - offsetY );
			const peers =
				filesStoreApi.getState().placementsByFolder.get( folderId ) ?? [];

			if ( session.payload.type === 'desktop-file' ) {
				const data = session.payload.data as unknown as DesktopFileDragData;
				const occupied = buildVisualOccupiedSet( peers, data.placement.id );
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
				if ( isSyntheticPlacement( data.placement ) ) {
					// Synthetic placements (dock-item promotions —
					// negative ids minted by
					// `settings/desktop-shortcuts-sync.ts`) have no DB
					// row, so the REST `/files/placements/(?P<id>\d+)`
					// route can't accept the PATCH. Persist the new
					// position into `OsSettingsState.dockPromotedPositions`
					// instead so the synthesizer can restore it on the
					// next page load — without this write the icon
					// snaps back to (0, 0) every reload.
					const dockItemId = readSynthSource( data.placement );
					if ( dockItemId ) {
						persistDockPromotedPosition(
							dockItemId,
							cell.x,
							cell.y,
						);
					}
					return;
				}
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
				const occupied = buildVisualOccupiedSet( peers );
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

	// Hydrate from REST if we haven't seen this folder yet. Resolves
	// the `hydrated` promise so the boot path can hold off revealing
	// the desktop until the placements list has landed in the store
	// — avoids the "wallpaper icons paint first, folders/posts a
	// frame later" staircase the user sees on F5.
	let resolveHydrated: () => void = () => undefined;
	const hydrated = new Promise< void >( ( resolve ) => {
		resolveHydrated = resolve;
	} );
	if ( ! filesStoreApi.getState().hydratedFolders.has( folderId ) ) {
		void rest
			.listPlacements( folderId )
			.then( ( res ) => {
				filesStoreApi.setFolderPlacements( folderId, res.placements );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( '[desktop-mode] files: failed to hydrate folder', folderId, err );
			} )
			.finally( () => {
				resolveHydrated();
			} );
	} else {
		// Already hydrated — resolve on the next microtask so the
		// caller's `.then` runs after the synchronous repaint above.
		queueMicrotask( resolveHydrated );
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
			if ( isSyntheticPlacement( p ) ) {
				// No DB row — see the drop-on-canvas note below for the
				// `\d+`-vs-negative-id reason. Store update above is
				// enough for the visible sort outcome.
				return;
			}
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
		hydrated,
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
			for ( const deregister of tileRejectDeregisters.values() ) {
				try {
					deregister();
				} catch {
					// ignore
				}
			}
			tileRejectDeregisters.clear();
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
 * Whether `placement` is a synthetic (no DB row) one. Two signals:
 *   - The `__synthFromDockItem` meta marker — definitive when present.
 *   - A non-positive id — `settings/desktop-shortcuts-sync.ts` mints
 *     deterministic negative ids for these, and Core's REST regex on
 *     `/files/placements/(?P<id>\d+)` only matches positive integers,
 *     so any non-positive id would 404 anyway. Treating the two as
 *     equivalent keeps the gate robust against future synth sources
 *     that forget to stamp the marker.
 *
 * Used to gate the three REST PATCH callsites in this module — synth
 * placements live JS-only, so persisting their (x, y) / parentId
 * would 404 with `rest_no_route`.
 */
function isSyntheticPlacement( placement: RestPlacementShape ): boolean {
	return placement.id <= 0 || readSynthSource( placement ) !== null;
}

/** Recycle-bin tile id; matched on the shortcut tile's `file.ref`. */
const RECYCLE_BIN_REF = 'desktop-mode-recycle-bin';

/**
 * Whether a tile should claim drops with `accept: false` — i.e.
 * surface the red "Can't drop here" chip when the user drags
 * another tile over it.
 *
 * Folders are excluded because `registerFolderDropTarget` already
 * claims them with `accept: true` for matching payloads. The
 * Recycle Bin is excluded because `recycle-bin-targets.ts` claims
 * it as a TRASH target (the registry overwrites by element, so
 * adding a reject claimant on the bin tile would silently break
 * trash-by-drop). Everything else — system shortcuts (My
 * WordPress), dock-item promotions, plugin-registered icons,
 * post / page references — gets the rejection.
 *
 * No plugin escape hatch yet. `desktop-mode.files.tile-rendered`
 * fires from inside `buildTile` BEFORE the layer registers the
 * reject claimant on the returned element. Since
 * `registerDropTarget` overwrites by element and the reject
 * claimant runs last, any plugin target installed during
 * `tile-rendered` is immediately overwritten — the claimant wins,
 * not the plugin. If a real plugin needs to accept drops on its
 * own icon, the right fix is a new action fired AFTER the layer's
 * registration (e.g. `desktop-mode.files.tile-drop-registered`)
 * so plugins can install their own target last. Not adding that
 * action speculatively — the feature is 0.8.6 / Experimental and
 * no in-tree caller needs it today.
 *
 * @since 0.8.6
 */
function shouldRejectTileDrops( placement: RestPlacementShape ): boolean {
	if ( placement.file?.type === 'folder' ) {
		return false;
	}
	if ( placement.file?.ref === RECYCLE_BIN_REF ) {
		return false;
	}
	return true;
}

/**
 * Build an occupied-cells set that reflects what's actually painted
 * on the grid — including pinned tiles' assigned visual slots.
 *
 * `grid.ts`'s `buildOccupiedSet` only consults each placement's
 * stored `(x, y)`, but the repaint deliberately IGNORES those for
 * pinned tiles (`desktop_mode_register_icon( …, [ 'pinned' => true ] )`),
 * anchoring them to column 0, rows 0..N-1 in the order they appear.
 * So a tile pinned at the top of the column has stored coords that
 * could be anywhere — and the plain occupied set would miss it
 * entirely, letting drop snaps land on top of the pinned slot.
 *
 * Symptom this fixes: in a column rendered as
 * `My WordPress | empty | Icon A | Icon B`, dragging Icon B at the
 * empty cell used to highlight My WordPress's slot because
 * `snapToEmptyCell` thought (0, 0) was free.
 *
 * @since 0.8.6
 */
function buildVisualOccupiedSet(
	placements: ReadonlyArray< RestPlacementShape >,
	excludeId?: number,
): Set< string > {
	// Sort pinned-first to mirror the repaint's iteration order, so
	// pinned-slot indices match what's on screen. `Array.sort` is
	// stable across all engines we support — within the pinned
	// group, original placement order is preserved.
	const sorted = placements.slice().sort( ( a, b ) => {
		const ap = isPinned( a ) ? 0 : 1;
		const bp = isPinned( b ) ? 0 : 1;
		return ap - bp;
	} );

	const set = new Set< string >();
	let pinnedIdx = 0;
	for ( const p of sorted ) {
		if ( excludeId !== undefined && p.id === excludeId ) {
			continue;
		}
		if ( isPinned( p ) ) {
			// Visual slot: column 0, row = position in the pinned
			// sequence. Stored coords ignored, same as the repaint.
			set.add( cellKey( 0, pinnedIdx ) );
			pinnedIdx += 1;
		} else {
			const cell = pointToCell( p.x, p.y );
			set.add( cellKey( cell.col, cell.row ) );
		}
	}
	return set;
}

/**
 * Would moving folder `movingFolderId` into folder `targetParentId`
 * create a cycle? A move is cyclic when the target parent is the
 * moving folder itself OR any of its descendants — committing
 * `moving.parent_id = target` would leave the chain looping back
 * through the moving folder, stranding every descendant outside the
 * root.
 *
 * Walks the parent chain by reading the live store. Treats a
 * pre-existing visit as a cycle so a corrupted client state can't
 * drive the loop forever. Returns `false` when the target sits at
 * root (`<= 0`) — that case is always safe.
 *
 * Authoritative gate lives server-side in
 * `desktop_mode_files_would_create_folder_cycle()`; this is a
 * client-side preflight so the `accept` callbacks can reject the
 * drop up-front (no REST round-trip, no 409 in the console, visible
 * snap-back at the drop site).
 *
 * @since 0.8.6
 */
function wouldCreateFolderCycle(
	movingFolderId: number,
	targetParentId: number,
): boolean {
	if ( targetParentId <= 0 || movingFolderId <= 0 ) {
		return false;
	}
	if ( movingFolderId === targetParentId ) {
		return true;
	}
	// Build a folder-id → containing-folder-id map from every live
	// placement we know about. Folder identity is `file.ref` parsed
	// as an int; the containing folder is the placement's parentId.
	const parentByFolderId = new Map< number, number >();
	const state = filesStoreApi.getState();
	for ( const bucket of state.placementsByFolder.values() ) {
		for ( const p of bucket ) {
			if ( p.file?.type !== 'folder' ) {
				continue;
			}
			const fid = parseInt( p.file.ref, 10 );
			if ( Number.isNaN( fid ) || fid <= 0 ) {
				continue;
			}
			// First-seen wins. Folders with multiple placements
			// (rare; shared semantics) only need one upward chain to
			// flag a cycle.
			if ( ! parentByFolderId.has( fid ) ) {
				parentByFolderId.set( fid, p.parentId );
			}
		}
	}

	const visited = new Set< number >();
	let cursor = targetParentId;
	let maxDepth = 256;
	while ( cursor > 0 && maxDepth-- > 0 ) {
		if ( cursor === movingFolderId ) {
			return true;
		}
		if ( visited.has( cursor ) ) {
			return true; // pre-existing cycle — bail safe
		}
		visited.add( cursor );
		const next = parentByFolderId.get( cursor );
		if ( next === undefined ) {
			// Unknown ancestry. Let the server's authoritative check
			// decide — defaulting to "allow" here keeps shared
			// folders the viewer can't fully see from being falsely
			// blocked.
			return false;
		}
		cursor = next;
	}
	return false;
}

/**
 * Persist the new (x, y) of a synthetic dock-promoted placement
 * into `OsSettingsState.dockPromotedPositions`. The synthesizer
 * (`settings/desktop-shortcuts-sync.ts`) reads this map on every
 * sync, so the next reload restores the icon at the saved coords
 * instead of resetting to (0, 0).
 *
 * Silent no-op when the public OS Settings facade isn't available
 * (tests, embedded previews, or a host that disabled the facade).
 *
 * @since 0.8.6
 */
function persistDockPromotedPosition(
	dockItemId: string,
	x: number,
	y: number,
): void {
	const api = (
		window as unknown as {
			wp?: {
				desktop?: {
					getOsSettings?: () => {
						dockPromotedPositions?: Record<
							string,
							{ x: number; y: number }
						>;
					};
					updateOsSettings?: ( patch: {
						dockPromotedPositions?: Record<
							string,
							{ x: number; y: number }
						>;
					} ) => void;
				};
			};
		}
	).wp?.desktop;
	if ( ! api?.getOsSettings || ! api?.updateOsSettings ) {
		return;
	}
	const current = api.getOsSettings().dockPromotedPositions ?? {};
	api.updateOsSettings( {
		dockPromotedPositions: {
			...current,
			[ dockItemId ]: { x, y },
		},
	} );
}

/**
 * Try to apply a repaint as an in-place position update — no
 * `replaceChildren()`, no tile rebuild. Returns `true` if the patch
 * applied; `false` if the caller must fall back to the wholesale
 * rebuild path.
 *
 * The fast path is correct when the ONLY thing that changed is one
 * or more tiles' `x` / `y` / `sortOrder` / `updatedAtMs`. We can
 * detect that without keeping a previous-snapshot map by reading
 * the structural fields the renderer already encodes onto tile data
 * attributes (`data-placement-id`, `data-file-type`, `data-file-ref`)
 * plus the `--pinned` class. Anything else — adds, removes, renames,
 * file-type changes, parent moves, pin-flag flips — falls back so
 * the renderer can re-run pinned-slot allocation, drop-target
 * registration, drag wiring, etc.
 *
 * Why the fast path matters: after a drag-and-drop the wholesale
 * rebuild paints to users as "the whole desktop just reloaded" —
 * every tile vanishes for one frame and re-appears. Patching
 * positions in place keeps DOM identity for unchanged tiles so the
 * grid feels continuous.
 *
 * @since 0.8.6
 */
function tryPatchPositions(
	list: readonly RestPlacementShape[],
	container: HTMLElement,
	host: HTMLElement,
): boolean {
	const tiles = Array.from(
		container.querySelectorAll< HTMLElement >( '[data-placement-id]' ),
	);
	if ( tiles.length !== list.length ) {
		return false;
	}

	const byId = new Map< number, HTMLElement >();
	for ( const tile of tiles ) {
		const raw = tile.dataset.placementId ?? '';
		const id = parseInt( raw, 10 );
		// `parseInt` on a negative-id synth placement still returns
		// the negative number, so synth tiles roundtrip cleanly. Only
		// genuinely unparseable values short-circuit.
		if ( raw === '' || ( Number.isNaN( id ) && raw !== '-0' ) ) {
			return false;
		}
		byId.set( id, tile );
	}

	for ( const placement of list ) {
		const tile = byId.get( placement.id );
		if ( ! tile ) {
			return false;
		}
		if ( tile.dataset.fileType !== placement.file.type ) {
			return false;
		}
		if ( tile.dataset.fileRef !== placement.file.ref ) {
			return false;
		}
		// Pin flag is encoded as a class on the wholesale rebuild —
		// disagreement means the pin state changed and the drag
		// wiring needs to be added or removed, which only the full
		// rebuild does.
		const wasPinned = tile.classList.contains( `${ TILE_CLASS }--pinned` );
		if ( wasPinned !== isPinned( placement ) ) {
			return false;
		}
	}

	// All checks passed — recompute pinned slots + displacement
	// exactly as the wholesale path would, then apply positions.
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
	const displaced = new Map< number, { x: number; y: number } >();
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
		const tile = byId.get( placement.id );
		if ( ! tile ) {
			continue; // unreachable — guarded above; keeps the typechecker happy.
		}
		const pinned = pinnedSlots.get( placement.id );
		const disp = displaced.get( placement.id );
		if ( pinned ) {
			setTilePosition( tile, pinned.x, pinned.y );
		} else if ( disp ) {
			setTilePosition( tile, disp.x, disp.y );
		} else {
			setTilePosition( tile, placement.x, placement.y );
		}
	}

	return true;
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
				// Synthetic placements (dock-item promotions) have no
				// DB row, so "move into folder" can't be persisted
				// today — the REST PATCH would 404 on its negative
				// id. Reject the drop so the user gets a clear "this
				// can't go there" cue instead of an apparent move that
				// silently snaps back on the next sync.
				if ( isSyntheticPlacement( data.placement ) ) {
					return false;
				}
				// Folder cycle: dropping folder X onto folder Y
				// when Y is somewhere inside X creates an
				// unreachable loop. The server's authoritative
				// check rejects it too, but doing the preflight
				// here gives the user a clean "this can't go
				// there" snap-back instead of a 409 toast.
				if ( data.placement.file.type === 'folder' ) {
					const movingFolderId = parseInt( data.placement.file.ref, 10 );
					if (
						! Number.isNaN( movingFolderId ) &&
						wouldCreateFolderCycle( movingFolderId, targetFolderId )
					) {
						return false;
					}
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
				const cell = nextRowMajorCell( buildVisualOccupiedSet( peers ) );
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
		// IMPORTANT: re-read the placement from the live store. The
		// closure-captured `placement` is the value as of the LAST
		// wholesale repaint — the fast-path repaint
		// (`tryPatchPositions`) reuses tile DOM and never re-attaches
		// the drag handler, so without this lookup the closure holds
		// stale `updatedAtMs` indefinitely after the first move. The
		// REST PATCH that the canvas drop fires uses that field as
		// the `If-Match` header; a stale value lands a 409 with
		// `reason: 'parent_changed'`, surfaced to the user as
		// "<their own name> moved this to 'another folder'." Shared
		// folders see this most often because the heartbeat bumps
		// `updatedAtMs` on every tick a peer is active.
		const liveBucket =
			filesStoreApi.getState().placementsByFolder.get( folderId );
		const livePlacement =
			liveBucket?.find( ( p ) => p.id === placement.id ) ?? placement;
		// Read the tile's CURRENT visible position from the inline
		// styles, not the placement's server-stored (x, y). They
		// diverge when the layer has displaced this tile to dodge
		// a pinned slot — using `placement.x` would snap the tile
		// back to its stored coords on the first pointermove (the
		// "drag jumps to the pinned slot" bug).
		const visibleX = parseFloat( tile.style.left ) || livePlacement.x;
		const visibleY = parseFloat( tile.style.top ) || livePlacement.y;
		const session = dragManager.start( {
			payload: {
				type: 'desktop-file',
				source: tile,
				data: {
					placement: livePlacement,
					sourceFolderId: folderId,
					// Synthesize a cross-frame bridge payload from the
					// placement's file shape so a wallpaper-placed
					// shortcut can be dropped into an open Gutenberg
					// iframe and inserted as the matching block. The
					// PHP serialize() methods (`Desktop_Mode_Post_File`,
					// `Desktop_Mode_User_File`, `Desktop_Mode_Attachment_File`)
					// surface the URL fields this needs.
					bridgePayload: buildBridgePayloadFromPlacement( livePlacement ),
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
			// Only surface "Move folder to Trash" when the server
			// says the viewer is allowed to. For a recipient's root
			// placement of a SHARED folder the share-trash gate
			// returns false (the correct affordance is "Leave shared
			// folder", added by `share-menu-items.ts`), so the
			// destructive entry stays out of their menu entirely.
			// `undefined` falls through for legacy payloads — the
			// server REST 403 + toast still backstop those.
			if ( placement.canTrash !== false ) {
				items.push( {
					id: 'delete-folder',
					label: 'Move folder to Trash',
					icon: 'dashicons-trash',
					sort: 90,
					danger: true,
					onClick: () => trashFolderWithUndo( placement ),
				} );
			}
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
			} else if ( placement.canTrash !== false ) {
				// Only surface "Move to Trash" when the server says
				// the viewer is allowed to. `canTrash === false`
				// applies to placements inside a shared folder where
				// the viewer lacks write capability — without this
				// guard the user could pick the menu item, attempt
				// the REST call, and only see the failure logged to
				// the console while the tile sat un-moved. `undefined`
				// (legacy payloads) falls through to "let it through"
				// so older clients keep behaving as today.
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
