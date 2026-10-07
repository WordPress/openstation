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
	canvasSize,
	cellKey,
	cellToPos,
	nextFreeCell,
	packCells,
	pointToCell,
	snapToEmptyCell,
	TILE_H,
	TILE_W,
	type GridCanvas,
	type GridOrder,
} from './grid';
import { workAreaRectOf } from '../work-area';
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
	type ShortcutDragItem,
} from './drag-payloads';
import { attachCrossFrameDrop } from './cross-frame-drop';
import { uploadBridgePayload } from './media-drag';

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
	if ( file.type === 'upload' ) {
		return uploadBridgePayload( file );
	}
	return undefined;
}

function getDragManager(): DragManagerApi | null {
	const api = (
		window as { wp?: { os?: { dragManager?: DragManagerApi } } }
	).wp?.os?.dragManager;
	return api ?? null;
}

const LAYER_CLASS = 'os-files-layer';

export function orderForFolder( folderId: number ): GridOrder {
	return 0 === folderId ? 'column' : 'row';
}

export type FilesLayerSortMode =
	| 'name-asc'
	| 'name-desc'
	| 'date-asc'
	| 'date-desc';

export interface FilesLayer {
	host: HTMLElement;
	folderId: number;

	onSelectionChange: (
		cb: ( placement: RestPlacementShape | null ) => void,
	) => () => void;

	onSelectionChanged: (
		cb: ( placements: RestPlacementShape[] ) => void,
	) => () => void;

	getSelection: () => RestPlacementShape[];

	selectAll: () => void;

	clearSelection: () => void;

	sort: ( mode: FilesLayerSortMode ) => void;

	reflow: () => void;

	readonly hydrated: Promise< void >;
	dispose: () => void;
}

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

export function gridCanvasFor(
	host: HTMLElement | null | undefined,
	folderId: number,
): GridCanvas {
	if ( folderId !== 0 || ! host ) {
		return host;
	}
	return {
		get width(): number {
			return workAreaRectOf( host ).width;
		},
		get height(): number {
			return workAreaRectOf( host ).height;
		},
	};
}

export function mountFilesLayer( host: HTMLElement, folderId = 0 ): FilesLayer {
	const order = orderForFolder( folderId );
	const canvas = gridCanvasFor( host, folderId );

	const container = document.createElement( 'div' );
	container.className = LAYER_CLASS;
	container.setAttribute( 'role', 'list' );
	container.dataset.folderId = String( folderId );
	host.appendChild( container );

	let lastFingerprint = '';

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

			const single = placements.length === 1 ? placements[ 0 ] : null;
			for ( const cb of selectionListeners ) {
				try {
					cb( single );
				} catch ( err ) {
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

	const computeLayout = ( list: readonly RestPlacementShape[] ): TileLayout =>
		computeTileLayout( list, canvas, order );

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

		for ( const placement of list ) {
			const tile = existing.get( placement.id );
			if ( ! tile ) {
				continue;
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

		for ( const [ id, tile ] of existing ) {
			if ( wantIds.has( id ) ) {
				continue;
			}
			const folderDereg = folderDropDeregisters.get( id );
			if ( folderDereg ) {
				try {
					folderDereg();
				} catch {

				}
				folderDropDeregisters.delete( id );
			}
			const rejectDereg = tileRejectDeregisters.get( id );
			if ( rejectDereg ) {
				try {
					rejectDereg();
				} catch {

				}
				tileRejectDeregisters.delete( id );
			}
			tile.remove();
		}

		const { pinnedSlots, displaced } = computeLayout( list );

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

		selection.refresh();

		doAction( 'os.files.grid-rendered', {
			folderId,
			count: list.length,
		} );

		return true;
	};

	const repaint = ( state: FilesState ): void => {
		const raw = state.placementsByFolder.get( folderId ) ?? [];

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

		if ( tryPatchPositions( list, container, canvas, order ) ) {
			return;
		}

		if ( tryPatchIncremental( list ) ) {
			return;
		}

		container.replaceChildren();

		for ( const [ , deregister ] of folderDropDeregisters ) {
			try {
				deregister();
			} catch {

			}
		}
		folderDropDeregisters.clear();
		for ( const [ , deregister ] of tileRejectDeregisters ) {
			try {
				deregister();
			} catch {

			}
		}
		tileRejectDeregisters.clear();

		const { pinnedSlots, displaced } = computeLayout( list );

		for ( const placement of list ) {
			container.appendChild(
				wireTile( placement, pinnedSlots, displaced ),
			);
		}

		selection.refresh();
		doAction( 'os.files.grid-rendered', {
			folderId,
			count: list.length,
		} );
	};

	const dropTargetDeregisters: Array< () => void > = [];

	const folderDropDeregisters: Map< number, () => void > = new Map();

	const tileRejectDeregisters: Map< number, () => void > = new Map();

	let dropPreviewEl: HTMLElement | null = null;
	let dropPreviewMoveHandler: ( ( ev: PointerEvent ) => void ) | null = null;
	const installCanvasDropPreview = ( session: DragSession ): void => {
		if ( dropPreviewEl ) {
			return;
		}

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
			const cell = snapToEmptyCell( rawX, rawY, occupied, canvas, order );
			previewEl.style.transform = `translate3d(${ cell.x }px, ${ cell.y }px, 0)`;
		};

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
				return canvasPayloadAccepts( payload, { folderId, host } );
			}

			if ( folderId > 0 && payload.type === 'desktop-file' ) {
				const data = payload.data as unknown as DesktopFileDragData;

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

				const occupied = buildVisualOccupiedSet( peers, movingIds );
				const primaryCell = snapToEmptyCell(
					rawX,
					rawY,
					occupied,
					canvas,
					order,
				);
				occupied.add( cellKey( primaryCell.col, primaryCell.row ) );

				for ( const placement of moving ) {
					let cell = primaryCell;
					if ( placement.id !== data.placement.id ) {
						const dx = placement.x - data.placement.x;
						const dy = placement.y - data.placement.y;
						cell = snapToEmptyCell(
							Math.max( 0, primaryCell.x + dx ),
							Math.max( 0, primaryCell.y + dy ),
							occupied,
							canvas,
							order,
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

					doAction( 'os.files.tile-manually-placed', {
						folderId,
						placementId: placement.id,
					} );
					if ( isSyntheticPlacement( placement ) ) {
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

				fileShortcutEntities( dragShortcutItems( data ), folderId, host );

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

	dropTargetDeregisters.push(
		attachCrossFrameDrop( {
			host,
			container,
			folderId,
			fileEntities: ( entities, parentId ) => {
				fileShortcutEntities(
					entities,
					parentId,
					parentId === folderId ? host : null,
				);
			},
		} ),
	);

	if ( ! filesStoreApi.getState().hydratedFolders.has( folderId ) ) {
		const boot = takeBootPlacements( folderId );
		if ( boot ) {
			filesStoreApi.setFolderPlacements( folderId, boot );
		}
	}

	repaint( filesStoreApi.getState() );

	queueMicrotask( () => reflow() );
	const off = filesStoreApi.subscribe( ( state ) => {
		repaint( state );
		reflow();
	} );

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
				console.error( '[openstation] files: failed to hydrate folder', folderId, err );
			} )
			.finally( () => {
				resolveHydrated();
			} );
	} else {
		queueMicrotask( resolveHydrated );
	}

	const reservedCells = ( count: number ): Set< string > => {
		const out = new Set< string >();
		for ( let i = 0; i < count; i += 1 ) {
			out.add( cellKey( 0, i ) );
		}
		return out;
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

		const pinned = live.filter( ( p ) => isPinned( p ) );
		const draggable = live.filter( ( p ) => ! isPinned( p ) );
		const sorted = sortPlacements( draggable, mode );

		const cells = packCells(
			sorted.length,
			reservedCells( pinned.length ),
			order,
			canvas,
		);

		sorted.forEach( ( p, i ) => {
			const { x, y } = cells[ i ];
			const next: RestPlacementShape = {
				...p,
				x,
				y,
				sortOrder: i,
			};
			filesStoreApi.upsertPlacement( next );
			if ( isSyntheticPlacement( p ) ) {
				return;
			}
			void rest
				.updatePlacement( p.id, { x, y, sortOrder: i } )
				.catch( ( err: unknown ) => {
					console.error(
						'[openstation] files: sort persist failed',
						err,
					);
				} );
		} );
	};

	const reflow = (): void => {
		const live = filesStoreApi.getState().placementsByFolder.get( folderId );
		if ( ! live || live.length === 0 ) {
			return;
		}
		const size = canvasSize( canvas );
		const w = size.width > 0 ? size.width : Infinity;
		const h = size.height > 0 ? size.height : Infinity;

		const overflowing = live.some(
			( p ) => p.x + TILE_W > w || p.y + TILE_H > h,
		);
		if ( ! overflowing ) {
			return;
		}

		const pinned = live.filter( ( p ) => isPinned( p ) );
		const draggable = live.filter( ( p ) => ! isPinned( p ) );
		const cells = packCells(
			draggable.length,
			reservedCells( pinned.length ),
			order,
			canvas,
		);
		draggable.forEach( ( p, i ) => {
			const tile = container.querySelector< HTMLElement >(
				`[data-placement-id="${ p.id }"]`,
			);
			if ( tile ) {
				setTilePosition( tile, cells[ i ].x, cells[ i ].y );
			}
		} );
	};

	let last = canvasSize( canvas );
	let resizeObserver: ResizeObserver | null = null;
	if ( typeof ResizeObserver !== 'undefined' ) {
		resizeObserver = new ResizeObserver( () => {
			const size = canvasSize( canvas );
			if ( size.width === last.width && size.height === last.height ) {
				return;
			}
			last = size;
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

				}
			}
			dropTargetDeregisters.length = 0;
			for ( const deregister of folderDropDeregisters.values() ) {
				try {
					deregister();
				} catch {

				}
			}
			folderDropDeregisters.clear();
			for ( const deregister of tileRejectDeregisters.values() ) {
				try {
					deregister();
				} catch {

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

function isPinned( placement: RestPlacementShape ): boolean {
	return Boolean( placement.file.pinned );
}

interface TileLayout {

	pinnedSlots: Map< number, { x: number; y: number } >;

	displaced: Map< number, { x: number; y: number } >;
}

function computeTileLayout(
	list: readonly RestPlacementShape[],
	canvas: GridCanvas,
	order: GridOrder,
): TileLayout {
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
			canvas,
			order,
		);
		occupiedCells.add( cellKey( free.col, free.row ) );
		displaced.set( placement.id, { x: free.x, y: free.y } );
	}
	return { pinnedSlots, displaced };
}

export function settleArrivedShortcuts(
	host: HTMLElement,
	refs: readonly string[],
): void {
	if ( refs.length === 0 ) {
		return;
	}
	const wanted = new Set( refs );
	const bucket = filesStoreApi.getState().placementsByFolder.get( 0 ) ?? [];
	const isArrival = ( p: RestPlacementShape ): boolean =>
		p.file?.type === 'shortcut' &&
		wanted.has( p.file.ref ) &&
		! isPinned( p ) &&
		! isSyntheticPlacement( p );
	const arrivals = bucket.filter( isArrival ).sort( ( a, b ) => a.id - b.id );
	if ( arrivals.length === 0 ) {
		return;
	}

	const canvas = gridCanvasFor( host, 0 );
	const order = orderForFolder( 0 );
	const others = bucket
		.filter( ( p ) => ! isArrival( p ) )
		.sort( ( a, b ) => ( isPinned( a ) ? 0 : 1 ) - ( isPinned( b ) ? 0 : 1 ) );
	const { pinnedSlots, displaced } = computeTileLayout( others, canvas, order );
	const occupied = new Set< string >();
	for ( const p of others ) {
		const at = pinnedSlots.get( p.id ) ?? displaced.get( p.id ) ?? p;
		const cell = pointToCell( at.x, at.y );
		occupied.add( cellKey( cell.col, cell.row ) );
	}

	for ( const placement of arrivals ) {
		const cell = nextFreeCell( occupied, order, canvas );
		occupied.add( cellKey( cell.col, cell.row ) );
		if ( cell.x === placement.x && cell.y === placement.y ) {
			continue;
		}
		filesStoreApi.upsertPlacement( { ...placement, x: cell.x, y: cell.y } );
		void rest
			.updatePlacement( placement.id, { x: cell.x, y: cell.y } )
			.catch( ( err: unknown ) => {
				console.error(
					'[openstation] files: placing a new desktop icon failed',
					err,
				);
			} );
	}
}

export function isSyntheticPlacement( placement: RestPlacementShape ): boolean {
	return isSyntheticPlacementImpl( placement );
}

const RECYCLE_BIN_REF = 'desktop-mode-recycle-bin';

function shouldRejectTileDrops( placement: RestPlacementShape ): boolean {
	if ( placement.file?.type === 'folder' ) {
		return false;
	}
	if ( placement.file?.ref === RECYCLE_BIN_REF ) {
		return false;
	}
	return true;
}

function buildVisualOccupiedSet(
	placements: ReadonlyArray< RestPlacementShape >,

	excludeId?: number | ReadonlySet< number >,
): Set< string > {
	const excluded =
		typeof excludeId === 'number'
			? new Set( [ excludeId ] )
			: excludeId ?? null;

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
			set.add( cellKey( 0, pinnedIdx ) );
			pinnedIdx += 1;
		} else {
			const cell = pointToCell( p.x, p.y );
			set.add( cellKey( cell.col, cell.row ) );
		}
	}
	return set;
}

function fileShortcutEntities(
	entities: ReadonlyArray< ShortcutDragItem >,
	parentId: number,
	host?: HTMLElement | null,
): void {
	const peers =
		filesStoreApi.getState().placementsByFolder.get( parentId ) ?? [];
	const occupied = buildVisualOccupiedSet( peers );
	const order = orderForFolder( parentId );
	for ( const entity of entities ) {
		const cell = nextFreeCell( occupied, order, gridCanvasFor( host, parentId ) );
		occupied.add( cellKey( cell.col, cell.row ) );
		void rest
			.createPlacement( {
				parentId,
				type: entity.kind,
				ref: entity.ref,
				x: cell.x,
				y: cell.y,
			} )
			.then( ( placement ) => {
				filesStoreApi.upsertPlacement( placement );
				doAction( 'os.files.shortcut-dropped', {
					folderId: parentId,
					placement,
				} );
			} )
			.catch( ( err: unknown ) => {
				console.error( '[openstation] shortcut drop failed:', err );
			} );
	}
}

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
			return true;
		}
		visited.add( cursor );
		const next = parentByFolderId.get( cursor );
		if ( next === undefined ) {
			return false;
		}
		cursor = next;
	}
	return false;
}

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

function tryPatchPositions(
	list: readonly RestPlacementShape[],
	container: HTMLElement,
	canvas: GridCanvas,
	order: GridOrder,
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

		const wasPinned = tile.classList.contains( `${ TILE_CLASS }--pinned` );
		if ( wasPinned !== isPinned( placement ) ) {
			return false;
		}
	}

	const { pinnedSlots, displaced } = computeTileLayout( list, canvas, order );

	for ( const placement of list ) {
		const tile = byId.get( placement.id );
		if ( ! tile ) {
			continue;
		}
		const at =
			pinnedSlots.get( placement.id ) ??
			displaced.get( placement.id ) ?? {
				x: placement.x,
				y: placement.y,
			};
		setTilePosition( tile, at.x, at.y );
		syncTileLabel( tile, placement );
	}

	return true;
}

function syncTileLabel(
	tile: HTMLElement,
	placement: RestPlacementShape,
): void {
	const label = placementLabel( placement );
	if ( tile.getAttribute( 'label' ) !== label ) {
		tile.setAttribute( 'label', label );
	}
}

function registerTileRejectTarget(
	dragManager: DragManagerApi,
	tile: HTMLElement,
	placement: RestPlacementShape,
): () => void {
	const ctx = { placement };

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

				for ( const placement of dragPlacements( data ) ) {
					if (
						placement.file.type === 'folder' &&
						parseInt( placement.file.ref, 10 ) === targetFolderId
					) {
						return false;
					}

					if ( placement.parentId === targetFolderId ) {
						return false;
					}

					if ( isSyntheticPlacement( placement ) ) {
						return false;
					}

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

				const peers =
					filesStoreApi
						.getState()
						.placementsByFolder.get( targetFolderId ) ?? [];
				const occupied = buildVisualOccupiedSet( peers );
				const targetOrder = orderForFolder( targetFolderId );
				for ( const placement of dragPlacements( data ) ) {
					const cell = nextFreeCell( occupied, targetOrder );
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

				fileShortcutEntities( dragShortcutItems( data ), targetFolderId );
			}
		},
	};

	void currentFolderId;
	return dragManager.registerDropTarget( target );
}

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

		if ( e.shiftKey || e.ctrlKey || e.metaKey ) {
			return;
		}
		const dragManager = getDragManager();
		if ( ! dragManager ) {
			return;
		}

		const liveBucket =
			filesStoreApi.getState().placementsByFolder.get( folderId );
		const livePlacement =
			liveBucket?.find( ( p ) => p.id === placement.id ) ?? placement;

		const visibleX = parseFloat( tile.style.left ) || livePlacement.x;
		const visibleY = parseFloat( tile.style.top ) || livePlacement.y;

		const inSelection = selection.model.has( String( livePlacement.id ) );
		const set = inSelection ? selectedPlacements() : [];
		const placements =
			set.length > 1 && set.some( ( p ) => p.id === livePlacement.id )
				? set
				: [ livePlacement ];

		if ( ! inSelection ) {
			const syncSelection = (): void => {
				document.removeEventListener( 'os.drag.start', syncSelection );
				selection.model.set( [ String( livePlacement.id ) ] );
			};
			document.addEventListener( 'os.drag.start', syncSelection );

			const cancelSync = (): void => {
				document.removeEventListener( 'os.drag.start', syncSelection );
				document.removeEventListener( 'pointerup', cancelSync );
			};
			document.addEventListener( 'pointerup', cancelSync );
		}

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

			document.addEventListener( 'pointerup', undim );
		}

		const session = dragManager.start( {
			payload: {
				type: 'desktop-file',
				source: tile,
				data: {
					placement: livePlacement,

					...( placements.length > 1 ? { placements } : {} ),
					sourceFolderId: folderId,

					bridgePayload: buildBridgePayloadFromPlacement( livePlacement ),
				} satisfies DesktopFileDragData,
				ghost: {
					offsetX: e.clientX - tile.getBoundingClientRect().left,
					offsetY: e.clientY - tile.getBoundingClientRect().top,
					element:
						placements.length > 1
							? buildDragStackGhost( tile, placements.length )
							: undefined,

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

		} );

		void session;
		void visibleX;
		void visibleY;
	} );
}

function attachContextMenu(
	tile: HTMLElement,
	wiredPlacement: RestPlacementShape,
	selection: SelectionHandle,
	selectedPlacements: () => RestPlacementShape[],
): void {
	tile.addEventListener( 'contextmenu', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();

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
