import { __ } from '../i18n';
import { addAction, HOOKS } from '../hooks';
import type { DragManagerApi, DragPayload, DragSession } from '../drag';
import {
	registerTilePayloadHandler,
	type TilePayloadContext,
} from '../desktop-files/tile-payloads';
import { NOTE_PAYLOAD_TYPE, type NoteDragData } from './types';
import type { NotesLayer } from './layer';

const DROP_ACTIVE_ATTR = 'data-os-posts-drop-active';
const POSTS_WINDOW_ID = 'desktop-mode-posts';

const POSTS_DOCK_SELECTOR =
	'.os-dock__item[data-menu-slug="menu-posts"],' +
	'.os-dock__item[data-menu-slug="editphp"]';
const POSTS_WINDOW_SELECTOR = '[data-os-posts-root]';

function getDragManager(): DragManagerApi | null {
	return (
		window as unknown as {
			wp?: { os?: { dragManager?: DragManagerApi } };
		}
	).wp?.os?.dragManager ?? null;
}

function isNotePayload( payload: DragPayload ): boolean {
	if ( payload.type !== NOTE_PAYLOAD_TYPE ) {
		return false;
	}
	const data = payload.data as Partial< NoteDragData >;
	return data.canEdit === true;
}

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

function isPostsShortcutTile( ctx: TilePayloadContext ): boolean {
	const file = ctx.placement.file;
	if ( ! file || file.type !== 'shortcut' ) {
		return false;
	}
	const url = typeof file.shortcutUrl === 'string' ? file.shortcutUrl : '';
	return isPostsUrl( url );
}

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

export function installNotesPostsDropTarget( layer: NotesLayer ): void {
	if ( _installed || ! layer.canCreatePosts ) {
		return;
	}
	const dragManager = getDragManager();
	if ( ! dragManager ) {
		return;
	}
	_installed = true;

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
