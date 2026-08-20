/**
 * OpenStation — cross-frame drops onto a files canvas.
 *
 * The shell's own tile gestures are pointer-driven: `DragManager`
 * owns the lift, the ghost, the hit-test and the drop, and a canvas
 * accepts them by registering a `DropTarget`. A drag that starts
 * inside an iframe cannot join that pipeline — the gesture belongs to
 * the browser's native HTML5 drag machinery in the child document,
 * and the parent shell never sees a `pointerdown`, let alone a
 * `dragstart`. What the parent DOES see, the moment the pointer
 * leaves the iframe and crosses onto shell chrome, is a normal
 * `dragenter` / `dragover` / `drop` sequence on its own document.
 *
 * This module is the sink for exactly that. It teaches one files
 * canvas — the wallpaper, or a folder window's body — to accept a
 * native drag carrying a WordPress entity and turn it into a
 * placement, which is what makes "drag an image out of the Media
 * Library and drop it on the desktop" file a shortcut instead of
 * navigating the tab to the image.
 *
 * Two channels carry the payload, and we read whichever is available:
 *
 *   1. `wp.os.dragBridge` — the authoritative one. The source iframe
 *      postMessages `os-drag-start` with the full record before the
 *      pointer ever leaves it, so by the time the drag reaches us the
 *      bridge already holds a typed payload. This is the channel the
 *      Gutenberg drop-receiver reads, and it survives browsers that
 *      strip custom MIME types across the frame boundary.
 *   2. `application/x-wp-media-attachment` on the `DataTransfer` —
 *      the fallback, for a source that fills the DataTransfer but
 *      never talks to the shell (a third-party media grid, an older
 *      copy of the Media Library shim). Note it can only be READ on
 *      `drop`: during `dragover` the spec exposes `types` but not
 *      values, which is why acceptance is decided from the type list
 *      and the payload is resolved a moment later.
 *
 * What this module deliberately does NOT do is claim OS file drags.
 * A drag carrying `Files` is a real upload and belongs to
 * `src/os-file-drop/` — we bail before touching it.
 */

import type { DragBridgePayload } from '../drag-bridge';
import type { ShortcutDragItem } from './drag-payloads';
import { TILE_CLASS } from './file-tile';

/**
 * Custom MIME the Media Library shim
 * (`assets/js/media-library-enhanced.js`) stamps on the
 * `DataTransfer` alongside `text/plain` / `text/uri-list` /
 * `text/html`. Carries the full attachment record as JSON.
 *
 * @public
 */
export const ATTACHMENT_DROP_MIME = 'application/x-wp-media-attachment';

/** Marker the canvas wears while a cross-frame drag hovers it. */
const CANVAS_ACTIVE_ATTR = 'data-files-drop-active';

/**
 * What the canvas does with a resolved drop.
 *
 * The module owns the DOM and the event plumbing; the caller owns the
 * store, the REST client and the grid maths. Keeping the split here
 * means this file can be tested with nothing but a document.
 */
export interface CrossFrameDropContext {
	/** Element whose bounds define the canvas — `#os-area`, or a folder body. */
	host: HTMLElement;
	/** The layer container the tiles live in. */
	container: HTMLElement;
	/** Folder the canvas is showing. `0` is the desktop root. */
	folderId: number;
	/**
	 * File the entities as shortcuts under `parentId`. Called once
	 * per drop with at least one entity.
	 */
	fileEntities: (
		entities: ReadonlyArray< ShortcutDragItem >,
		parentId: number,
	) => void;
}

/** Read the shell's bridge, if it has booted. */
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

/**
 * Turn a bridge payload into the `{ kind, ref }` pair a placement is
 * created from. Returns `null` for a payload shape this canvas has no
 * file type for — better to let the drag fall through than to POST a
 * placement the registry can't render.
 */
function payloadToEntity(
	payload: DragBridgePayload | null,
): ShortcutDragItem | null {
	if ( ! payload || typeof payload.id !== 'number' ) {
		return null;
	}
	// The bridge's union and the file-type registry happen to agree on
	// every slug (`attachment`, `post`, `user`), so `kind` maps across
	// unchanged. A new bridge kind without a registered file type
	// lands in the default and is refused.
	switch ( payload.kind ) {
		case 'attachment':
		case 'post':
		case 'user':
			return {
				kind: payload.kind,
				ref: String( payload.id ),
				title: payload.title,
			};
		default:
			return null;
	}
}

/** Parse the DataTransfer fallback. */
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

/** Does this native drag carry something we can file? */
function dragCarriesEntity( ev: DragEvent ): boolean {
	const types = ev.dataTransfer?.types;
	const list = types ? Array.from( types ) : [];
	// An OS file drag is an upload, not a shortcut. `src/os-file-drop/`
	// owns those, and claiming them here would swap the upload dialog
	// for a broken placement.
	if ( list.includes( 'Files' ) ) {
		return false;
	}
	if ( list.includes( ATTACHMENT_DROP_MIME ) ) {
		return true;
	}
	return payloadToEntity( bridgePayload() ) !== null;
}

/**
 * Is the event aimed at the canvas, rather than at something floating
 * above it?
 *
 * The wallpaper's host is `#os-area`, which also contains every open
 * window and the widget column — a drop on a window's title bar
 * bubbles to the same host as a drop on bare wallpaper. Walk up from
 * the target and stop at the first thing that answers the question:
 * reaching the layer container means a tile, reaching the host means
 * open canvas, and hitting a window or the widget column on the way
 * means this drop was never ours.
 *
 * The walk is deliberately relative to `host`: a folder window's
 * canvas lives INSIDE a `.wp-window`, so an absolute
 * `closest( '.wp-window' )` would reject every drop in a folder.
 */
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

/**
 * Folder tile under the pointer, if any — dropping onto a closed
 * folder files into it, matching what a pointer-driven shortcut drag
 * onto the same tile does.
 */
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

/**
 * Wire native drag events on a files canvas so cross-frame drags can
 * land on it. Returns a dispose function.
 *
 * @public
 */
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
		// Both halves are mandatory: without `preventDefault()` on
		// EVERY dragover the browser keeps the "no drop allowed"
		// cursor and never fires `drop`; without `dropEffect` the
		// pointer says "move" over a gesture that copies.
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
		// `dragleave` fires on every internal boundary crossing too, so
		// only treat it as an exit when the pointer actually left the
		// host subtree.
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

		// Claim the drop before resolving the payload. A media drag
		// also carries `text/uri-list`, and the browser's default for
		// that on a plain document is to NAVIGATE — dropping a photo
		// on the desktop would replace the whole shell with the image.
		ev.preventDefault();
		ev.stopPropagation();

		const entity =
			payloadToEntity( bridgePayload() ) ??
			entityFromDataTransfer( ev.dataTransfer );
		if ( ! entity ) {
			return;
		}

		// Read the folder tile from the event, not from the hover
		// bookkeeping `clearHover()` just reset.
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
