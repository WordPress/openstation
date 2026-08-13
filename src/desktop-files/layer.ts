/**
 * OpenStation — `FilesLayer`.
 *
 * Mounts on a host element (the `#os-area` for the
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
 */

import { doAction } from '../hooks';
import { rest, store as filesStoreApi } from './layer-deps';
import { buildTile, placementLabel, setTilePosition, TILE_CLASS } from './file-tile';
import { buildDragStackGhost } from './tile-spec';
import {
	tilePayloadAccepts,
	tilePayloadAcceptLabel,
	tilePayloadDrop,
} from './tile-payloads';
import { openPlacementActionMenu } from './tile-menu';
import { buildPlacementActions } from './tile-actions';
import { attachSelection, type SelectionHandle } from '../selection/controller';
import { resolveCommonActions } from '../selection/actions';
import {
	isSyntheticPlacement as isSyntheticPlacementImpl,
	readSynthSource,
} from './synthetic';
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
import { canvasPayloadAccepts, canvasPayloadDrop } from './canvas-payloads';
import type { DragManagerApi, DragSession, DropTarget } from '../drag';
import {
	dragPlacements,
	dragShortcutItems,
	type DesktopFileDragData,
	type ShortcutDragData,
} from './drag-payloads';

/**
 * Build a cross-frame bridge payload from a placement, or return
 * `undefined` when the placement's file type isn't one we know how
 * to deliver into an iframe (anything outside attachment/post/user).
 *
 * The placement's `file` shape carries everything we need because
 * the PHP `OpenStation_*_File::serialize()` methods surface `link`
 * / `sourceUrl` / `alt` / `mime` / `postType` on every list
 * response.
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
 * exposes it on `wp.os.dragManager` BEFORE `mountFilesLayer()`
 * is called. We re-read each access rather than caching to make
 * per-test overrides possible (vitest can stub `wp.os.dragManager`
 * before the layer mounts).
 */
function getDragManager(): DragManagerApi | null {
	const api = (
		window as { wp?: { os?: { dragManager?: DragManagerApi } } }
	).wp?.os?.dragManager;
	return api ?? null;
}

const LAYER_CLASS = 'os-files-layer';

/**
 * Sort modes accepted by `FilesLayer.sort()`. Same keys the icon-
 * canvas Sort By menu uses (and the wallpaper's own sort callback).
 *
 * @public
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
	 * the selected placement when exactly ONE is selected, and with
	 * `null` otherwise — an empty selection and a multi-selection are
	 * the same news to a consumer that shows one thing at a time.
	 * Use {@link FilesLayer.onSelectionChanged} to see the whole set.
	 * Returns an unsubscribe function.
	 */
	onSelectionChange: (
		cb: ( placement: RestPlacementShape | null ) => void,
	) => () => void;
	/**
	 * Subscribe to the full selection. Fires with every selected
	 * placement in visual order, empty array included. Returns an
	 * unsubscribe function.
	 */
	onSelectionChanged: (
		cb: ( placements: RestPlacementShape[] ) => void,
	) => () => void;
	/** Currently selected placements, in visual order. */
	getSelection: () => RestPlacementShape[];
	/** Select every tile in this layer. */
	selectAll: () => void;
	/** Drop the selection. */
	clearSelection: () => void;
	/**
	 * Sort the visible tiles row-major into a clean grid in the
	 * requested order, persisting each new (x, y) to REST. Same
	 * gesture macOS Finder calls "Clean Up By → Name / Date."
	 */
	sort: ( mode: FilesLayerSortMode ) => void;
	/**
	 * Visually re-flow tiles into the current canvas width when the
	 * stored layout overflows. Cheap, doesn't persist — the next
	 * drag or sort writes back to REST.
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
	 */
	readonly hydrated: Promise< void >;
	dispose: () => void;
}

/**
 * Mount a files layer on `host`, scoped to `folderId`. Returns
 * a handle the caller uses to unmount.
 */
/**
 * Read (and consume) the boot-inlined root-folder placements from the
 * shell config. PHP builds `filesBootPlacements` with the same code
 * path as GET /placements for `folder=0`, so seeding the store with
 * it is indistinguishable from a REST hydration — minus the
 * round-trip the boot path used to await before revealing the
 * desktop. One-shot by design: the key is deleted on first read so a
 * later un-hydrated render (restore-sync eviction, trash reset)
 * refetches fresh state instead of resurrecting the boot snapshot.
 */
function takeBootPlacements( folderId: number ): RestPlacementShape[] | null {
	if ( folderId !== 0 ) {
		return null;
	}
	const cfg = ( window as unknown as {
		openStationConfig?: { filesBootPlacements?: RestPlacementShape[] };
	} ).openStationConfig;
	const list = cfg?.filesBootPlacements;
	if ( ! cfg || ! Array.isArray( list ) ) {
		return null;
	}
	delete cfg.filesBootPlacements;
	return list;
}

export function mountFilesLayer( host: HTMLElement, folderId = 0 ): FilesLayer {
	const container = document.createElement( 'div' );
	container.className = LAYER_CLASS;
	container.setAttribute( 'role', 'list' );
	container.dataset.folderId = String( folderId );
	host.appendChild( container );

	let lastFingerprint = '';

	/**
	 * Resolve a selected key (the placement id as a string) back to
	 * the LIVE placement. Reads the store rather than a cached list —
	 * a menu opened after a heartbeat delta must act on what the
	 * server last said, not on what was painted.
	 */
	const placementsForKeys = ( keys: readonly string[] ): RestPlacementShape[] => {
		const bucket =
			filesStoreApi.getState().placementsByFolder.get( folderId ) ?? [];
		const byId = new Map< string, RestPlacementShape >();
		for ( const p of bucket ) {
			if ( p ) {
				byId.set( String( p.id ), p );
			}
		}
		return keys
			.map( ( key ) => byId.get( key ) )
			.filter( ( p ): p is RestPlacementShape => !! p );
	};

	type SelectionListener = (
		placement: RestPlacementShape | null,
	) => void;
	type MultiSelectionListener = (
		placements: RestPlacementShape[],
	) => void;
	const selectionListeners = new Set< SelectionListener >();
	const multiSelectionListeners = new Set< MultiSelectionListener >();

	const selection = attachSelection( container, {
		itemSelector: `.${ TILE_CLASS }`,
		background: host,
		surface: 'files',
		scope: String( folderId ),
		keyOf: ( el ) => el.dataset.placementId ?? null,
		onChange: ( keys ) => {
			const placements = placementsForKeys( keys );
			// The single-placement listeners are the older contract
			// (preview panes, the right pane in a folder window). They
			// hear `null` for an empty selection AND for a multi one:
			// "no single thing to preview" is the same message either
			// way, and it keeps every existing consumer correct without
			// teaching it about sets.
			const single = placements.length === 1 ? placements[ 0 ] : null;
			for ( const cb of selectionListeners ) {
				try {
					cb( single );
				} catch ( err ) {
					// eslint-disable-next-line no-console
					console.error(
						'[openstation] files: selection listener threw:',
						err,
					);
				}
			}
			for ( const cb of multiSelectionListeners ) {
				try {
					cb( placements );
				} catch ( err ) {
					// eslint-disable-next-line no-console
					console.error(
						'[openstation] files: selection listener threw:',
						err,
					);
				}
			}
		},
	} );

	const currentSelection = (): RestPlacementShape[] =>
		placementsForKeys( selection.keys() );

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
			attachContextMenu( tile, placement, selection, currentSelection );
			if ( shouldRejectTileDrops( placement ) ) {
				const dragManager = getDragManager();
				if ( dragManager ) {
					tileRejectDeregisters.set(
						placement.id,
						registerTileRejectTarget( dragManager, tile, placement ),
					);
				}
			}
			return tile;
		}
		const moved = displaced.get( placement.id );
		if ( moved ) {
			setTilePosition( tile, moved.x, moved.y );
		}
		attachTileDrag( tile, placement, folderId, selection, currentSelection );
		attachContextMenu( tile, placement, selection, currentSelection );
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
				tileRejectDeregisters.set(
					placement.id,
					registerTileRejectTarget( dragManager, tile, placement ),
				);
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

		// Update positions + labels on shared tiles, build new ones
		// for adds. The label sync covers "a shared tile was renamed
		// in the same delta that added/removed another placement".
		for ( const placement of list ) {
			const tile = existing.get( placement.id );
			if ( tile ) {
				applyTilePosition( tile, placement, pinnedSlots, displaced );
				syncTileLabel( tile, placement );
				continue;
			}
			container.appendChild(
				wireTile( placement, pinnedSlots, displaced ),
			);
		}

		// Selection bookkeeping — re-assert the selected attribute on
		// reused tiles and drop keys whose tiles were just removed, so
		// right-pane consumers stay in sync when a selected tile was
		// the deleted one.
		selection.refresh();

		doAction( 'os.files.grid-rendered', {
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
		// Re-apply selected state after the wholesale rebuild (every
		// tile is a fresh node) and drop keys whose placements are
		// gone — deleted, or moved to another folder.
		selection.refresh();
		doAction( 'os.files.grid-rendered', {
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
		previewEl.className = 'os-files-drop-preview';
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
		id: `os-files-canvas-${ folderId }`,
		element: host,
		accept: ( payload ) => {
			if ( payload.type !== 'desktop-file' && payload.type !== 'shortcut' ) {
				// Payload types this layer doesn't own (e.g. the
				// pinned-notes `'note'` / `'note-draft'` drags) can be
				// claimed by a registered canvas payload handler — the
				// registry keys drop targets by element, so features
				// that want the wallpaper route through this target.
				return canvasPayloadAccepts( payload, { folderId, host } );
			}
			// Folder-cycle preflight for drops onto a folder
			// window's canvas. The wallpaper root (`folderId === 0`)
			// can never be a descendant of any folder, so this only
			// kicks in when a folder window has the canvas. Mirror
			// of the server-side check; the only difference here is
			// instant snap-back vs. a 409 toast after the REST hit.
			if ( folderId > 0 && payload.type === 'desktop-file' ) {
				const data = payload.data as unknown as DesktopFileDragData;
				// Every member of the set has to be droppable, not just
				// the grabbed one. Accepting a set and then silently
				// moving four of five is worse than refusing: the user
				// sees a successful drop and finds out later.
				for ( const placement of dragPlacements( data ) ) {
					if ( placement.file?.type !== 'folder' ) {
						continue;
					}
					const movingFolderId = parseInt( placement.file.ref, 10 );
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
			// The grid-cell drop preview only makes sense for the
			// tile payloads this layer owns — handler-owned payloads
			// (pinned notes) place freely, no snap.
			if (
				session.payload.type === 'desktop-file' ||
				session.payload.type === 'shortcut'
			) {
				installCanvasDropPreview( session );
			}
		},
		onLeave: () => {
			host.removeAttribute( 'data-files-drop-active' );
			teardownCanvasDropPreview();
		},
		onDrop: ( session, ev ) => {
			host.removeAttribute( 'data-files-drop-active' );
			teardownCanvasDropPreview();
			if (
				session.payload.type !== 'desktop-file' &&
				session.payload.type !== 'shortcut'
			) {
				canvasPayloadDrop( session, ev, { folderId, host } );
				return;
			}
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
				const moving = dragPlacements( data );
				const movingIds = new Set( moving.map( ( p ) => p.id ) );
				// Every tile in the set vacates its cell, so none of
				// them counts as occupied while we place the others.
				const occupied = buildVisualOccupiedSet( peers, movingIds );
				const primaryCell = snapToEmptyCell( rawX, rawY, occupied, host );
				occupied.add( cellKey( primaryCell.col, primaryCell.row ) );

				for ( const placement of moving ) {
					let cell = primaryCell;
					if ( placement.id !== data.placement.id ) {
						// Keep the set's shape: each tile lands the same
						// distance from the grabbed one as it started,
						// then snaps to the nearest free cell. Dropping
						// three icons in a row gives you three icons in
						// a row, which is what the ghost implied.
						const dx = placement.x - data.placement.x;
						const dy = placement.y - data.placement.y;
						cell = snapToEmptyCell(
							Math.max( 0, primaryCell.x + dx ),
							Math.max( 0, primaryCell.y + dy ),
							occupied,
							host,
						);
						occupied.add( cellKey( cell.col, cell.row ) );
					}
					const next: RestPlacementShape = {
						...placement,
						x: cell.x,
						y: cell.y,
						parentId: folderId,
					};
					filesStoreApi.upsertPlacement( next );
					// Notify the shell that a tile was placed by the user
					// (not by Sort By / Clean Up). The desktop root listens
					// to drop out of auto-arrange mode so the user's manual
					// position survives the next desktop resize.
					doAction( 'os.files.tile-manually-placed', {
						folderId,
						placementId: placement.id,
					} );
					if ( isSyntheticPlacement( placement ) ) {
						// Synthetic placements (dock-item promotions —
						// negative ids minted by
						// `settings/desktop-shortcuts-sync.ts`) have no DB
						// row, so the REST `/files/placements/(?P<id>\d+)`
						// route can't accept the PATCH. Persist the new
						// position into `OsSettingsState.dockPromotedPositions`
						// instead so the synthesizer can restore it on the
						// next page load — without this write the icon
						// snaps back to (0, 0) every reload.
						const dockItemId = readSynthSource( placement );
						if ( dockItemId ) {
							persistDockPromotedPosition(
								dockItemId,
								cell.x,
								cell.y,
							);
						}
						continue;
					}
					void rest
						.updatePlacement(
							placement.id,
							{
								x: cell.x,
								y: cell.y,
								parentId: folderId,
							},
							placement.updatedAtMs,
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
									'[openstation] files: drag persist failed',
									err,
								);
							}
							filesStoreApi.upsertPlacement( placement );
						} );
				}
				return;
			}

			if ( session.payload.type === 'shortcut' ) {
				const data = session.payload.data as unknown as ShortcutDragData;
				// New shortcuts — pack row-major (top-left, then across)
				// so the new tiles land at visible cells regardless of
				// where the user released the cursor. Cursor-position
				// snap is wrong for shortcut creates because users
				// rarely aim precisely; row-major is the "tidy" outcome.
				const occupied = buildVisualOccupiedSet( peers );
				for ( const entity of dragShortcutItems( data ) ) {
					const cell = nextRowMajorCell( occupied, host );
					occupied.add( cellKey( cell.col, cell.row ) );
					void rest
						.createPlacement( {
							parentId: folderId,
							type: entity.kind,
							ref: entity.ref,
							x: cell.x,
							y: cell.y,
						} )
						.then( ( placement ) => {
							filesStoreApi.upsertPlacement( placement );
							doAction( 'os.files.shortcut-dropped', {
								folderId,
								placement,
							} );
						} )
						.catch( ( err: unknown ) => {
							// eslint-disable-next-line no-console
							console.error(
								'[openstation] shortcut drop failed:',
								err,
							);
						} );
				}
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

	// Click, Ctrl/Cmd-click, Shift-click, marquee, Ctrl/Cmd+A and
	// Escape are all owned by the selection controller attached
	// above — the layer no longer wires per-tile click handlers.

	// Boot fast-path: PHP inlines the root folder's placements into
	// the shell config (`filesBootPlacements`, built by the same
	// code path as GET /placements) so first paint doesn't wait on a
	// REST round-trip. Consumed one-shot — a later re-render that
	// finds the folder un-hydrated (e.g. after the restore-sync
	// eviction) must fetch fresh state, not resurrect the boot
	// snapshot.
	if ( ! filesStoreApi.getState().hydratedFolders.has( folderId ) ) {
		const boot = takeBootPlacements( folderId );
		if ( boot ) {
			filesStoreApi.setFolderPlacements( folderId, boot );
		}
	}

	// Initial paint from whatever the store currently knows.
	repaint( filesStoreApi.getState() );
	// Every paint writes stored coordinates back onto the tiles, so
	// a tile parked outside the canvas needs rescuing again after
	// each one — not only when the host is resized. `reflow` is a
	// no-op unless something actually overflows, and it is declared
	// below, so both calls are deferred past its initialization.
	queueMicrotask( () => reflow() );
	const off = filesStoreApi.subscribe( ( state ) => {
		repaint( state );
		reflow();
	} );

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
				console.error( '[openstation] files: failed to hydrate folder', folderId, err );
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
						'[openstation] files: sort persist failed',
						err,
					);
				} );
		} );
	};

	/**
	 * If any tile would render past the canvas's edge given its
	 * stored (x, y), do an in-memory row-major reflow so the user
	 * sees them all. Doesn't persist — once the user drags a tile
	 * after the reflow, that single drag is what sticks. Repaints
	 * clobber the visual reflow on the next store change, so we
	 * apply positions directly via DOM mutation.
	 *
	 * Both edges count. The layer is `position: absolute; inset: 0`
	 * and does not scroll, so a tile past the BOTTOM edge isn't
	 * below the fold — there is no fold — it is unreachable. That
	 * is how a tile filed into a folder from low down on the
	 * desktop went missing: stored at a `y` no folder window is
	 * tall enough to show. Filing now re-packs (see the folder-tile
	 * drop handler), but rows written before that, or by any other
	 * route, still need rescuing on sight.
	 */
	const reflow = (): void => {
		const live = filesStoreApi.getState().placementsByFolder.get( folderId );
		if ( ! live || live.length === 0 ) {
			return;
		}
		const w = host.clientWidth > 0 ? host.clientWidth : Infinity;
		const h = host.clientHeight > 0 ? host.clientHeight : Infinity;
		const overflowing = live.some(
			( p ) => p.x + GRID_CELL_W > w || p.y + GRID_CELL_H > h,
		);
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

	// Watch the host for size changes — fire `reflow` whenever a
	// resize would push tiles off an edge. Same mechanism the My
	// WordPress canvas uses; folders share the model. Height counts
	// as much as width: shortening a folder window strands its
	// bottom row exactly the way narrowing it strands the right
	// column, and the layer has no scroll to fall back on.
	let lastWidth = host.clientWidth;
	let lastHeight = host.clientHeight;
	let resizeObserver: ResizeObserver | null = null;
	if ( typeof ResizeObserver !== 'undefined' ) {
		resizeObserver = new ResizeObserver( () => {
			const w = host.clientWidth;
			const h = host.clientHeight;
			if ( w === lastWidth && h === lastHeight ) {
				return;
			}
			lastWidth = w;
			lastHeight = h;
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
		onSelectionChanged( cb ) {
			multiSelectionListeners.add( cb );
			return () => {
				multiSelectionListeners.delete( cb );
			};
		},
		getSelection: currentSelection,
		selectAll: () => selection.model.selectAll(),
		clearSelection: () => selection.model.clear(),
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
			selection.destroy();
			selectionListeners.clear();
			multiSelectionListeners.clear();
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
 * `openstation_register_icon( …, [ 'pinned' => true ] )`.
 */
function isPinned( placement: RestPlacementShape ): boolean {
	return Boolean( placement.file.pinned );
}

/**
 * Whether `placement` is a synthetic (no DB row) one — see
 * `synthetic.ts`. Re-exported here because this module's path is the
 * published one for it; the implementation moved so the tile-action
 * builder could share it without importing the layer.
 */
export function isSyntheticPlacement( placement: RestPlacementShape ): boolean {
	return isSyntheticPlacementImpl( placement );
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
 * Plugins that need to accept a drop on their own icon do it through
 * `wp.os.files.registerTilePayloadHandler( type, handler )` — the
 * tile-payload seam this claimant already consults for its accept
 * predicate, hover chip, and drop dispatch.
 *
 * Note for anyone tempted by the other route: registering a competing
 * `DropTarget` on the tile element does NOT work. The registry allows
 * one target per element and this claimant is installed last, so a
 * target installed during `os.files.tile-rendered` (which
 * fires from inside `buildTile`, before this runs) is immediately
 * displaced. Cooperating with the claimant is the supported path;
 * fighting it for the element is not.
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
 * pinned tiles (`openstation_register_icon( …, [ 'pinned' => true ] )`),
 * anchoring them to column 0, rows 0..N-1 in the order they appear.
 * So a tile pinned at the top of the column has stored coords that
 * could be anywhere — and the plain occupied set would miss it
 * entirely, letting drop snaps land on top of the pinned slot.
 *
 * Symptom this fixes: in a column rendered as
 * `My WordPress | empty | Icon A | Icon B`, dragging Icon B at the
 * empty cell used to highlight My WordPress's slot because
 * `snapToEmptyCell` thought (0, 0) was free.
 */
function buildVisualOccupiedSet(
	placements: ReadonlyArray< RestPlacementShape >,
	/**
	 * Id (or ids) to treat as absent — the tiles being dragged. They
	 * are about to vacate their cells, so counting them as occupied
	 * would push the drop one cell sideways for a single drag, and
	 * scatter a multi-drag around its own footprint.
	 */
	excludeId?: number | ReadonlySet< number >,
): Set< string > {
	const excluded =
		typeof excludeId === 'number'
			? new Set( [ excludeId ] )
			: excludeId ?? null;
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
		if ( excluded?.has( p.id ) ) {
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
 * `openstation_files_would_create_folder_cycle()`; this is a
 * client-side preflight so the `accept` callbacks can reject the
 * drop up-front (no REST round-trip, no 409 in the console, visible
 * snap-back at the drop site).
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
 */
function persistDockPromotedPosition(
	dockItemId: string,
	x: number,
	y: number,
): void {
	const api = (
		window as unknown as {
			wp?: {
				os?: {
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
	).wp?.os;
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
 * or more tiles' `x` / `y` / `sortOrder` / `updatedAtMs` — or the
 * visible label, which `syncTileLabel()` patches in place (the
 * `<os-tile>` component observes its `label` attribute and repaints
 * itself, so a rename doesn't need any rewiring). We can detect
 * structural sameness without keeping a previous-snapshot map by
 * reading the fields the renderer already encodes onto tile data
 * attributes (`data-placement-id`, `data-file-type`, `data-file-ref`)
 * plus the `--pinned` class. Anything else — adds, removes,
 * file-type changes, parent moves, pin-flag flips — falls back so
 * the renderer can re-run pinned-slot allocation, drop-target
 * registration, drag wiring, etc.
 *
 * Why the fast path matters: after a drag-and-drop the wholesale
 * rebuild paints to users as "the whole desktop just reloaded" —
 * every tile vanishes for one frame and re-appears. Patching
 * positions in place keeps DOM identity for unchanged tiles so the
 * grid feels continuous.
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
		syncTileLabel( tile, placement );
	}

	return true;
}

/**
 * Sync a reused tile's visible label with the placement's current
 * title. `<os-tile>` observes `label`, so writing the attribute
 * repaints the label + aria-label in place while preserving
 * consumer-appended children (share badges). No-op when already
 * current.
 *
 * Both DOM-reusing repaint paths call this — without it a folder
 * rename patches the store but the tile keeps showing the old name
 * until the next wholesale rebuild (i.e. until F5).
 */
function syncTileLabel(
	tile: HTMLElement,
	placement: RestPlacementShape,
): void {
	const label = placementLabel( placement );
	if ( tile.getAttribute( 'label' ) !== label ) {
		tile.setAttribute( 'label', label );
	}
}

/**
 * Register the per-tile drop claimant for a NON-folder tile. A tile
 * normally hard-rejects every foreign payload so the drop doesn't fall
 * through to the wallpaper (`shouldRejectTileDrops`). A feature can opt
 * a payload type IN via the tile-payload seam (`tile-payloads.ts`) —
 * e.g. pinned notes accept a `'note'` drop on the Posts shortcut icon
 * (Spatial layout) and convert it to a draft. Unknown payloads — and
 * payloads whose handler doesn't recognize this placement — still
 * reject, preserving the original "Can't drop here" feedback.
 */
function registerTileRejectTarget(
	dragManager: DragManagerApi,
	tile: HTMLElement,
	placement: RestPlacementShape,
): () => void {
	const ctx = { placement };
	// The manager calls `accept( payload )` and then reads `acceptLabel`
	// in the same hover pass, so recording the hovered type here lets the
	// getter below return the label for the exact handler that accepted —
	// and recompute each hover, so a handler registered after this tile
	// mounted still gets the right chip.
	let hoveredType: string | null = null;
	return dragManager.registerDropTarget( {
		id: `os-files-tile-${ placement.id }-reject`,
		element: tile,
		get acceptLabel() {
			return hoveredType
				? tilePayloadAcceptLabel( hoveredType, ctx )
				: undefined;
		},
		accept: ( payload ) => {
			hoveredType = payload.type;
			return tilePayloadAccepts( payload, ctx );
		},
		onEnter: () => {
			tile.classList.add( `${ TILE_CLASS }--drop-target` );
		},
		onLeave: () => {
			tile.classList.remove( `${ TILE_CLASS }--drop-target` );
		},
		onDrop: ( session, ev ) => {
			tile.classList.remove( `${ TILE_CLASS }--drop-target` );
			tilePayloadDrop( session, ev, ctx );
		},
	} );
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
		id: `os-files-folder-${ targetFolderId }-tile-${ tile.dataset.placementId ?? '?' }`,
		element: tile,
		accept: ( payload ) => {
			if ( payload.type !== 'desktop-file' && payload.type !== 'shortcut' ) {
				return false;
			}
			if ( payload.type === 'desktop-file' ) {
				const data = payload.data as unknown as DesktopFileDragData;
				// Each of these gates is per-placement, and the whole
				// set has to clear them. Accepting a mixed set and
				// moving only the legal half would report success for
				// a move that half-happened.
				for ( const placement of dragPlacements( data ) ) {
					// Don't accept a folder dropped onto itself.
					if (
						placement.file.type === 'folder' &&
						parseInt( placement.file.ref, 10 ) === targetFolderId
					) {
						return false;
					}
					// No-op move: dropping a tile from folder X onto folder
					// X's own tile would just round-trip via REST. Reject
					// so the user gets reject feedback instead of a silent
					// no-op.
					if ( placement.parentId === targetFolderId ) {
						return false;
					}
					// Synthetic placements (dock-item promotions) have no
					// DB row, so "move into folder" can't be persisted
					// today — the REST PATCH would 404 on its negative
					// id. Reject the drop so the user gets a clear "this
					// can't go there" cue instead of an apparent move that
					// silently snaps back on the next sync.
					if ( isSyntheticPlacement( placement ) ) {
						return false;
					}
					// Folder cycle: dropping folder X onto folder Y
					// when Y is somewhere inside X creates an
					// unreachable loop. The server's authoritative
					// check rejects it too, but doing the preflight
					// here gives the user a clean "this can't go
					// there" snap-back instead of a 409 toast.
					if ( placement.file.type === 'folder' ) {
						const movingFolderId = parseInt( placement.file.ref, 10 );
						if (
							! Number.isNaN( movingFolderId ) &&
							wouldCreateFolderCycle( movingFolderId, targetFolderId )
						) {
							return false;
						}
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
				// Re-pack into the destination folder rather than
				// carrying the coordinates the tile had out here. A
				// desktop is far taller than a folder window, so a
				// tile filed from low down kept a `y` no folder canvas
				// reaches — and the layer doesn't scroll, so the tile
				// wasn't merely below the fold, it was unreachable.
				// The file looked like it had swallowed the icon.
				//
				// Row-major for the same reason the shortcut branch
				// below packs that way: the destination window is
				// probably not mounted, so we can't measure it and
				// aim — landing at the top-left of a folder is the
				// outcome that's visible whatever its size.
				const peers =
					filesStoreApi
						.getState()
						.placementsByFolder.get( targetFolderId ) ?? [];
				const occupied = buildVisualOccupiedSet( peers );
				for ( const placement of dragPlacements( data ) ) {
					const cell = nextRowMajorCell( occupied );
					occupied.add( cellKey( cell.col, cell.row ) );
					filesStoreApi.upsertPlacement( {
						...placement,
						x: cell.x,
						y: cell.y,
						parentId: targetFolderId,
					} );
					void rest
						.updatePlacement(
							placement.id,
							{
								x: cell.x,
								y: cell.y,
								parentId: targetFolderId,
							},
							placement.updatedAtMs,
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
									'[openstation] files: move-into-folder persist failed',
									err,
								);
							}
							filesStoreApi.upsertPlacement( placement );
						} );
				}
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
				const occupied = buildVisualOccupiedSet( peers );
				for ( const entity of dragShortcutItems( data ) ) {
					const cell = nextRowMajorCell( occupied );
					occupied.add( cellKey( cell.col, cell.row ) );
					void rest
						.createPlacement( {
							parentId: targetFolderId,
							type: entity.kind,
							ref: entity.ref,
							x: cell.x,
							y: cell.y,
						} )
						.then( ( placement ) => {
							filesStoreApi.upsertPlacement( placement );
							doAction( 'os.files.shortcut-dropped', {
								folderId: targetFolderId,
								placement,
							} );
						} )
						.catch( ( err: unknown ) => {
							// eslint-disable-next-line no-console
							console.error(
								'[openstation] shortcut drop into folder failed:',
								err,
							);
						} );
				}
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
	selection: SelectionHandle,
	selectedPlacements: () => RestPlacementShape[],
): void {
	tile.addEventListener( 'pointerdown', ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			return;
		}
		// A modifier means the user is composing a selection, not
		// picking the tile up. Without this, Ctrl/Cmd-clicking a
		// second tile arms a drag session whose ghost follows the
		// pointer for the rest of the gesture.
		if ( e.shiftKey || e.ctrlKey || e.metaKey ) {
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

		// Grabbing a tile that is part of the selection drags the whole
		// selection; grabbing one outside it drags only that tile, and
		// the selection catches up when the drag actually lifts.
		//
		// The selection is deliberately NOT mutated here. `pointerdown`
		// is the one moment where changing it is destructive: a
		// selection change repaints the tile, and a tile that repaints
		// between `mousedown` and `mouseup` gets no `click` from the
		// browser — so no `dblclick`, and the tile stops opening. That
		// is the bug this comment exists to prevent from coming back.
		// (`<os-tile>` now takes a children-preserving path for
		// selection attributes too — belt and braces.)
		const inSelection = selection.model.has( String( livePlacement.id ) );
		const set = inSelection ? selectedPlacements() : [];
		const placements =
			set.length > 1 && set.some( ( p ) => p.id === livePlacement.id )
				? set
				: [ livePlacement ];

		if ( ! inSelection ) {
			// Sync the highlight to what's moving — but only once the
			// gesture is provably a drag. By `os.drag.start` the
			// pointer has passed the threshold, so there is no pending
			// click left to break.
			const syncSelection = (): void => {
				document.removeEventListener( 'os.drag.start', syncSelection );
				selection.model.set( [ String( livePlacement.id ) ] );
			};
			document.addEventListener( 'os.drag.start', syncSelection );
			// A sub-threshold press is a click, not a drag: drop the
			// listener so a later, unrelated drag can't apply it.
			const cancelSync = (): void => {
				document.removeEventListener( 'os.drag.start', syncSelection );
				document.removeEventListener( 'pointerup', cancelSync );
			};
			document.addEventListener( 'pointerup', cancelSync );
		}

		// Dim every tile in the set, not just the grabbed one — the
		// manager only knows about `payload.source`.
		//
		// Hung off `os.drag.start` rather than applied here, for the
		// same reason the selection is: a press that turns out to be a
		// click must leave the canvas exactly as it found it. Dimming
		// on `pointerdown` would grey five tiles for every click on a
		// multi-selection and only undim them at the next drag's end.
		if ( placements.length > 1 ) {
			const dimmed: HTMLElement[] = [];
			const undim = (): void => {
				for ( const el of dimmed ) {
					el.classList.remove( `${ TILE_CLASS }--dragging` );
				}
				dimmed.length = 0;
				document.removeEventListener( 'os.drag.start', dim );
				document.removeEventListener( 'os.drag.end', undim );
				document.removeEventListener( 'pointerup', undim );
			};
			const dim = (): void => {
				for ( const p of placements ) {
					const el = tile.parentElement?.querySelector< HTMLElement >(
						`[data-placement-id="${ p.id }"]`,
					);
					if ( el && el !== tile ) {
						el.classList.add( `${ TILE_CLASS }--dragging` );
						dimmed.push( el );
					}
				}
			};
			document.addEventListener( 'os.drag.start', dim );
			document.addEventListener( 'os.drag.end', undim );
			// Backstop for the press that never became a drag — the
			// manager fires no `end` for those.
			document.addEventListener( 'pointerup', undim );
		}

		const session = dragManager.start( {
			payload: {
				type: 'desktop-file',
				source: tile,
				data: {
					placement: livePlacement,
					// Only set for a real multi-drag, so a single-item
					// gesture produces byte-identical payloads to the
					// ones every existing drop target was written for.
					...( placements.length > 1 ? { placements } : {} ),
					sourceFolderId: folderId,
					// Synthesize a cross-frame bridge payload from the
					// placement's file shape so a wallpaper-placed
					// shortcut can be dropped into an open Gutenberg
					// iframe and inserted as the matching block. The
					// PHP serialize() methods (`OpenStation_Post_File`,
					// `OpenStation_User_File`, `OpenStation_Attachment_File`)
					// surface the URL fields this needs.
					bridgePayload: buildBridgePayloadFromPlacement( livePlacement ),
				} satisfies DesktopFileDragData,
				ghost: {
					offsetX: e.clientX - tile.getBoundingClientRect().left,
					offsetY: e.clientY - tile.getBoundingClientRect().top,
					element:
						placements.length > 1
							? buildDragStackGhost( tile, placements.length )
							: undefined,
					// Say the count in words as well as on the badge —
					// the chip is what the user reads while hovering a
					// target, and "Move here" over the Trash with five
					// tiles in hand is an under-statement.
					hint:
						placements.length > 1
							? {
								accept: `Move ${ placements.length } items here`,
								reject: `Can’t drop ${ placements.length } items here`,
								neutral: `Moving ${ placements.length } items`,
							}
							: undefined,
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
 * Wire right-click → context menu on a tile.
 *
 * The item set for ONE placement lives in `tile-actions.ts`; what
 * happens here is the selection part. Right-clicking a tile that
 * isn't selected replaces the selection with it — Finder and
 * Explorer both do that, and the alternative (acting on a hidden
 * selection elsewhere on the canvas) is how people delete the wrong
 * files. Right-clicking one that IS selected leaves the set alone,
 * so a menu on five selected tiles acts on all five.
 *
 * `resolveCommonActions` then decides what a mixed set may offer.
 */
function attachContextMenu(
	tile: HTMLElement,
	wiredPlacement: RestPlacementShape,
	selection: SelectionHandle,
	selectedPlacements: () => RestPlacementShape[],
): void {
	tile.addEventListener( 'contextmenu', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		// Same staleness hazard as `attachTileDrag`: the fast-path
		// repaints reuse tile DOM without re-wiring, so the
		// closure-captured placement can be stale by open time (old
		// title after an in-place rename, old coords after a drag).
		// Menu actions spread the placement into optimistic store
		// patches — and the rename dialog pre-fills its title — so
		// re-read the live version here.
		const placement = filesStoreApi.currentPlacement( wiredPlacement );
		if ( ! selection.model.has( String( placement.id ) ) ) {
			selection.model.set( [ String( placement.id ) ] );
		}
		const targets = selectedPlacements();
		const items = targets.length > 0 ? targets : [ placement ];
		const actions = resolveCommonActions( items, buildPlacementActions );
		openPlacementActionMenu( { x: e.clientX, y: e.clientY }, actions, {
			placementIds: items.map( ( p ) => p.id ),
		} );
	} );
}
