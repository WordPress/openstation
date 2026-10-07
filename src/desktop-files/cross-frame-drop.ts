import type { DragBridgePayload } from '../drag-bridge';
import type { ShortcutDragItem } from './drag-payloads';
import { TILE_CLASS } from './file-tile';

export const ATTACHMENT_DROP_MIME = 'application/x-wp-media-attachment';

const CANVAS_ACTIVE_ATTR = 'data-files-drop-active';

export interface CrossFrameDropContext {

	host: HTMLElement;

	container: HTMLElement;

	folderId: number;

	fileEntities: (
		entities: ReadonlyArray< ShortcutDragItem >,
		parentId: number,
	) => void;
}

function bridgePayload(): DragBridgePayload | null {
	const bridge = (
		window as {
			wp?: { os?: { dragBridge?: { getPayload(): DragBridgePayload | null } } };
		}
	).wp?.os?.dragBridge;
	if ( ! bridge ) {
		return null;
	}
	try {
		return bridge.getPayload();
	} catch {
		return null;
	}
}

function payloadToEntity(
	payload: DragBridgePayload | null,
): ShortcutDragItem | null {
	if ( ! payload ) {
		return null;
	}

	switch ( payload.kind ) {
		case 'attachment':
		case 'post':
		case 'user':
			if ( typeof payload.id !== 'number' ) {
				return null;
			}
			return {
				kind: payload.kind,
				ref: String( payload.id ),
				title: payload.title,
			};
		default:
			return null;
	}
}

function entityFromDataTransfer(
	dt: DataTransfer | null,
): ShortcutDragItem | null {
	if ( ! dt ) {
		return null;
	}
	let raw = '';
	try {
		raw = dt.getData( ATTACHMENT_DROP_MIME );
	} catch {
		return null;
	}
	if ( ! raw ) {
		return null;
	}
	try {
		const record = JSON.parse( raw ) as { id?: unknown; title?: unknown };
		const id = typeof record.id === 'number' ? record.id : Number( record.id );
		if ( ! Number.isFinite( id ) || id <= 0 ) {
			return null;
		}
		return {
			kind: 'attachment',
			ref: String( id ),
			title: typeof record.title === 'string' ? record.title : undefined,
		};
	} catch {
		return null;
	}
}

function dragCarriesEntity( ev: DragEvent ): boolean {
	const types = ev.dataTransfer?.types;
	const list = types ? Array.from( types ) : [];

	if ( list.includes( 'Files' ) ) {
		return false;
	}
	if ( list.includes( ATTACHMENT_DROP_MIME ) ) {
		return true;
	}
	return payloadToEntity( bridgePayload() ) !== null;
}

function isCanvasSurface(
	target: EventTarget | null,
	host: HTMLElement,
	container: HTMLElement,
): boolean {
	if ( ! ( target instanceof Element ) || ! host.contains( target ) ) {
		return false;
	}
	let node: Element | null = target;
	while ( node && node !== host ) {
		if ( node === container ) {
			return true;
		}
		if ( node.classList.contains( 'wp-window' ) || node.id === 'os-widgets' ) {
			return false;
		}
		node = node.parentElement;
	}
	return node === host;
}

function folderTileAt(
	target: EventTarget | null,
	container: HTMLElement,
): HTMLElement | null {
	if ( ! ( target instanceof Element ) ) {
		return null;
	}
	const tile = target.closest( `.${ TILE_CLASS }` );
	if ( ! ( tile instanceof HTMLElement ) || ! container.contains( tile ) ) {
		return null;
	}
	return tile.dataset.fileType === 'folder' ? tile : null;
}

export function attachCrossFrameDrop( ctx: CrossFrameDropContext ): () => void {
	const { host, container, folderId } = ctx;
	let hoveredFolderTile: HTMLElement | null = null;

	const clearHover = (): void => {
		host.removeAttribute( CANVAS_ACTIVE_ATTR );
		if ( hoveredFolderTile ) {
			hoveredFolderTile.classList.remove( `${ TILE_CLASS }--drop-target` );
			hoveredFolderTile = null;
		}
	};

	const onDragOver = ( ev: DragEvent ): void => {
		if ( ! dragCarriesEntity( ev ) ) {
			return;
		}
		if ( ! isCanvasSurface( ev.target, host, container ) ) {
			clearHover();
			return;
		}

		ev.preventDefault();
		if ( ev.dataTransfer ) {
			ev.dataTransfer.dropEffect = 'copy';
		}

		host.setAttribute( CANVAS_ACTIVE_ATTR, '' );
		const tile = folderTileAt( ev.target, container );
		if ( tile !== hoveredFolderTile ) {
			hoveredFolderTile?.classList.remove( `${ TILE_CLASS }--drop-target` );
			tile?.classList.add( `${ TILE_CLASS }--drop-target` );
			hoveredFolderTile = tile;
		}
	};

	const onDragLeave = ( ev: DragEvent ): void => {
		const next = ev.relatedTarget;
		if ( next instanceof Node && host.contains( next ) ) {
			return;
		}
		clearHover();
	};

	const onDrop = ( ev: DragEvent ): void => {
		if ( ! dragCarriesEntity( ev ) ) {
			return;
		}
		if ( ! isCanvasSurface( ev.target, host, container ) ) {
			clearHover();
			return;
		}
		clearHover();

		ev.preventDefault();
		ev.stopPropagation();

		const entity =
			payloadToEntity( bridgePayload() ) ??
			entityFromDataTransfer( ev.dataTransfer );
		if ( ! entity ) {
			return;
		}

		const tile = folderTileAt( ev.target, container );
		let parentId = folderId;
		if ( tile ) {
			const ref = parseInt( tile.getAttribute( 'ref' ) ?? '', 10 );
			if ( ! Number.isNaN( ref ) && ref > 0 ) {
				parentId = ref;
			}
		}
		ctx.fileEntities( [ entity ], parentId );
	};

	host.addEventListener( 'dragover', onDragOver );
	host.addEventListener( 'dragleave', onDragLeave );
	host.addEventListener( 'drop', onDrop );

	return () => {
		clearHover();
		host.removeEventListener( 'dragover', onDragOver );
		host.removeEventListener( 'dragleave', onDragLeave );
		host.removeEventListener( 'drop', onDrop );
	};
}
