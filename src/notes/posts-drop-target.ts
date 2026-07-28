/**
 * Desktop Mode — "Convert note to post" drop target.
 *
 * Registers the Posts surfaces as drop zones that accept a pinned-note
 * pin drag (`'note'` payload) and convert the note into a draft post —
 * the second entry point for the conversion, alongside the inline
 * "Convert to post" button on each owned note.
 *
 *   1. The Posts dock tile. The dock tags each tile with
 *      `data-menu-slug = sanitize_key( $item[5] ?? $item[2] )` — for the
 *      core Posts menu that's `menu-posts` (WP's `$menu[5][5]`), never
 *      `edit.php` (which `sanitize_key()` would mangle to `editphp`
 *      anyway). The dock is rebuilt on `HOOKS.DOCK_AFTER_RENDER`; we
 *      re-discover + re-register on that signal plus a `MutationObserver`
 *      fallback.
 *   2. The native Posts window body (`[data-desktop-mode-posts-root]`,
 *      the opt-in `desktop-mode-posts` window). Registered on
 *      `WINDOW_OPENED`, deregistered on `WINDOW_CLOSED`.
 *
 *   3. The Posts shortcut TILE in the Spatial layout. On files-layer
 *      shells, core menu icons render as shortcut file-tiles rather than
 *      dock tiles, and every non-folder tile is already claimed by the
 *      files layer's reject target (one target per element). So for this
 *      surface we can't register our own `DropTarget` — we hook the
 *      files-layer tile-payload seam (`registerTilePayloadHandler`) and
 *      claim a `'note'` drop only on tiles whose shortcut points at the
 *      Posts screen.
 *
 * Surfaces (1) and (2) aren't claimed by anything else, so there we
 * register a real `DropTarget` directly.
 *
 * The whole module is a no-op when the viewer can't author posts
 * (`layer.canCreatePosts` is false) — no drop targets, matching the
 * hidden inline button.
 */

import { __ } from '../i18n';
import { addAction, HOOKS } from '../hooks';
import type { DragManagerApi, DragPayload, DragSession } from '../drag';
import {
	registerTilePayloadHandler,
	type TilePayloadContext,
} from '../desktop-files/tile-payloads';
import { NOTE_PAYLOAD_TYPE, type NoteDragData } from './types';
import type { NotesLayer } from './layer';

const DROP_ACTIVE_ATTR = 'data-desktop-mode-posts-drop-active';
const POSTS_WINDOW_ID = 'desktop-mode-posts';
// The core Posts tile carries `menu-posts`; `editphp` is the fallback
// when a site's menu row has no id (`$item[5]`) so the dock falls back
// to `sanitize_key( $item[2] )` = `sanitize_key( 'edit.php' )`.
const POSTS_DOCK_SELECTOR =
	'.desktop-mode-dock__item[data-menu-slug="menu-posts"],' +
	'.desktop-mode-dock__item[data-menu-slug="editphp"]';
const POSTS_WINDOW_SELECTOR = '[data-desktop-mode-posts-root]';

function getDragManager(): DragManagerApi | null {
	return (
		window as unknown as {
			wp?: { desktop?: { dragManager?: DragManagerApi } };
		}
	).wp?.desktop?.dragManager ?? null;
}

function isNotePayload( payload: DragPayload ): boolean {
	if ( payload.type !== NOTE_PAYLOAD_TYPE ) {
		return false;
	}
	const data = payload.data as Partial< NoteDragData >;
	return data.canEdit === true;
}

/**
 * Whether a URL points at the Posts screen — the Posts list (`edit.php`)
 * or Add New Post (`post-new.php`), with `post_type` absent or `post`
 * (so the Pages/CPT icons, which carry `post_type=page` etc., don't
 * masquerade as Posts).
 */
function isPostsUrl( url: string ): boolean {
	if ( ! url ) {
		return false;
	}
	let path = url;
	let search = '';
	try {
		const parsed = new URL( url, window.location.origin );
		path = parsed.pathname;
		search = parsed.search;
	} catch {
		// Relative/malformed — fall back to raw-string matching below.
	}
	const onPostsScreen =
		/(?:^|\/)(?:edit\.php|post-new\.php)$/.test( path ) ||
		( ! path.includes( '/' ) &&
			( path === 'edit.php' || path === 'post-new.php' ) );
	if ( ! onPostsScreen ) {
		return false;
	}
	const postType = new URLSearchParams( search ).get( 'post_type' );
	return ! postType || postType === 'post';
}

/** Whether a tile's placement is the Posts shortcut icon. */
function isPostsShortcutTile( ctx: TilePayloadContext ): boolean {
	const file = ctx.placement.file;
	if ( ! file || file.type !== 'shortcut' ) {
		return false;
	}
	const url = typeof file.shortcutUrl === 'string' ? file.shortcutUrl : '';
	return isPostsUrl( url );
}

/** Shared drop action: convert the dragged note (surfaces 1–3). */
function convertDraggedNote( layer: NotesLayer, session: DragSession ): void {
	if ( session.payload.type !== NOTE_PAYLOAD_TYPE ) {
		return;
	}
	const data = session.payload.data as Partial< NoteDragData >;
	if ( typeof data.noteId !== 'number' ) {
		return;
	}
	const controller = layer.get( data.noteId );
	if ( controller ) {
		layer.convertNote( controller.note );
	}
}

let _installed = false;
let _dockDeregister: ( () => void ) | null = null;
let _windowDeregister: ( () => void ) | null = null;
let _tileDeregister: ( () => void ) | null = null;
let _mutationObserver: MutationObserver | null = null;

function registerOn(
	dragManager: DragManagerApi,
	layer: NotesLayer,
	id: string,
	el: HTMLElement,
): () => void {
	return dragManager.registerDropTarget( {
		id,
		element: el,
		acceptLabel: __( 'Convert to post', 'desktop-mode' ),
		accept: ( payload ) => isNotePayload( payload ),
		onEnter: () => {
			el.setAttribute( DROP_ACTIVE_ATTR, '' );
		},
		onLeave: () => {
			el.removeAttribute( DROP_ACTIVE_ATTR );
		},
		onDrop: ( session: DragSession ) => {
			el.removeAttribute( DROP_ACTIVE_ATTR );
			convertDraggedNote( layer, session );
		},
	} );
}

/**
 * Read the live element of a currently-registered target, or null.
 * Lets the dock reprobe skip re-registration when nothing moved.
 */
function registeredElement(
	dragManager: DragManagerApi,
	id: string,
): HTMLElement | null {
	const t = dragManager
		.debug()
		.listTargets()
		.find( ( target ) => target.id === id );
	return t ? t.element : null;
}

/**
 * Wire up the "convert to post" drop targets. Idempotent, and a no-op
 * when the viewer can't author posts.
 */
export function installNotesPostsDropTarget( layer: NotesLayer ): void {
	if ( _installed || ! layer.canCreatePosts ) {
		return;
	}
	const dragManager = getDragManager();
	if ( ! dragManager ) {
		return;
	}
	_installed = true;

	// Surface 3: the Spatial-layout Posts shortcut tile. The files layer
	// owns the tile's DropTarget; we opt the `'note'` payload in via the
	// tile-payload seam, scoped to tiles whose shortcut points at Posts.
	_tileDeregister = registerTilePayloadHandler( NOTE_PAYLOAD_TYPE, {
		appliesTo: ( ctx ) => isPostsShortcutTile( ctx ),
		acceptLabel: __( 'Convert to post', 'desktop-mode' ),
		accept: ( data ) => ( data as Partial< NoteDragData > ).canEdit === true,
		onDrop: ( session ) => convertDraggedNote( layer, session ),
	} );

	const reprobeTile = (): void => {
		const el = document.querySelector( POSTS_DOCK_SELECTOR );
		if ( ! ( el instanceof HTMLElement ) ) {
			_dockDeregister?.();
			_dockDeregister = null;
			return;
		}
		if (
			_dockDeregister &&
			registeredElement( dragManager, 'notes-convert-dock' ) === el
		) {
			return;
		}
		_dockDeregister?.();
		_dockDeregister = registerOn( dragManager, layer, 'notes-convert-dock', el );
	};

	reprobeTile();

	addAction(
		HOOKS.DOCK_AFTER_RENDER,
		'desktop-mode/notes/convert-dock-target',
		reprobeTile,
	);

	if ( typeof MutationObserver !== 'undefined' ) {
		_mutationObserver = new MutationObserver( () => {
			reprobeTile();
		} );
		_mutationObserver.observe( document.body, {
			childList: true,
			subtree: true,
		} );
	}

	// Native Posts window body — register on open, drop on close.
	addAction(
		HOOKS.WINDOW_OPENED,
		'desktop-mode/notes/convert-window-target',
		( detail: { windowId?: string } ) => {
			if ( detail.windowId !== POSTS_WINDOW_ID ) {
				return;
			}
			_windowDeregister?.();
			_windowDeregister = null;
			const el = document.querySelector( POSTS_WINDOW_SELECTOR );
			if ( el instanceof HTMLElement ) {
				_windowDeregister = registerOn(
					dragManager,
					layer,
					'notes-convert-window',
					el,
				);
			}
		},
	);

	addAction(
		HOOKS.WINDOW_CLOSED,
		'desktop-mode/notes/convert-window-cleanup',
		( detail: { windowId?: string } ) => {
			if ( detail.windowId !== POSTS_WINDOW_ID ) {
				return;
			}
			_windowDeregister?.();
			_windowDeregister = null;
		},
	);
}

/** Test-only — resets the install latch + clears registrations. */
export function __resetNotesPostsDropTargetForTests(): void {
	_dockDeregister?.();
	_windowDeregister?.();
	_tileDeregister?.();
	_mutationObserver?.disconnect();
	_dockDeregister = null;
	_windowDeregister = null;
	_tileDeregister = null;
	_mutationObserver = null;
	_installed = false;
}
