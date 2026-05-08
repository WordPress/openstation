/**
 * Desktop Mode — Recycle bin drop targets.
 *
 * Registers the cross-window drop zones that accept a soft-trash
 * gesture from a desktop file tile:
 *
 *   1. The recycle-bin tile on the wallpaper. The bin is registered
 *      via `desktop_mode_register_icon()` and surfaces in the unified
 *      files layer as a `'shortcut'` placement carrying
 *      `data-file-ref="desktop-mode-recycle-bin"`. We also accept the
 *      legacy desktop-icon rail (`[data-icon-id]`) and any dock-side
 *      bridge (`[data-system-id]`) so the registration is robust to
 *      future layout shifts.
 *
 *   2. The recycle-bin native window's body
 *      (`[data-desktop-mode-recycle-bin-root]`). Registered on
 *      `WINDOW_OPENED`, deregistered on `WINDOW_CLOSED`.
 *
 * Both targets accept payloads of type `'desktop-file'`. On drop they
 * route to `trashByFileType()` — the same flow the right-click "Move
 * to Trash" menu uses, including the Undo toast and the cross-window
 * broadcast.
 *
 * Re-discovery: the wallpaper's bin tile is rebuilt on every store
 * change (the FilesLayer's wholesale repaint). We listen for both
 * `desktop-mode-files-changed` (store mutations) and
 * `HOOKS.DOCK_AFTER_RENDER` (legacy dock rebuild) and a
 * `MutationObserver` on the wallpaper area as a belt-and-braces
 * fallback so the drop target is guaranteed to point at the LIVE
 * DOM element.
 *
 * @since 0.18.0
 */

import { addAction, HOOKS } from '../hooks';
import type { DragManagerApi, DragSession } from '../drag';
import { trashByFileType } from './trash';
import type { RestPlacementShape } from './rest';

const TRASH_DROP_ACTIVE_ATTR = 'data-desktop-mode-trash-drop-active';
const RECYCLE_BIN_WINDOW_ID = 'desktop-mode-recycle-bin';

/**
 * Selectors that all match the recycle bin tile, in order of
 * preference. The first matching element wins.
 *
 *   - `.desktop-mode-file-tile[data-file-ref="…"]` — the unified
 *     files layer's representation (current default since 0.9.0).
 *   - `[data-icon-id="…"]` — legacy desktop-icons rail
 *     (`src/desktop-icons.ts`), still rendered when the files
 *     layer is absent.
 *   - `[data-system-id="…"]` — any dock-side system-tile bridge.
 */
const BIN_TILE_SELECTORS = [
	`.desktop-mode-file-tile[data-file-ref="${ RECYCLE_BIN_WINDOW_ID }"]`,
	`[data-icon-id="${ RECYCLE_BIN_WINDOW_ID }"]`,
	`[data-system-id="${ RECYCLE_BIN_WINDOW_ID }"]`,
];

function findBinTile(): HTMLElement | null {
	for ( const sel of BIN_TILE_SELECTORS ) {
		const el = document.querySelector( sel );
		if ( el instanceof HTMLElement ) {
			return el;
		}
	}
	return null;
}

let _installed = false;
let _dockDeregister: ( () => void ) | null = null;
let _windowDeregister: ( () => void ) | null = null;
let _binMutationObserver: MutationObserver | null = null;

interface DesktopFilePayloadData {
	placement: RestPlacementShape;
}

function isDesktopFilePayload(
	session: DragSession,
): session is DragSession & { payload: { type: 'desktop-file'; data: DesktopFilePayloadData } } {
	return session.payload.type === 'desktop-file';
}

function registerOn(
	dragManager: DragManagerApi,
	id: string,
	el: HTMLElement,
): () => void {
	return dragManager.registerDropTarget( {
		id,
		element: el,
		accept: ( payload ) => payload.type === 'desktop-file',
		onEnter: () => {
			el.setAttribute( TRASH_DROP_ACTIVE_ATTR, '' );
		},
		onLeave: () => {
			el.removeAttribute( TRASH_DROP_ACTIVE_ATTR );
		},
		onDrop: ( session ) => {
			el.removeAttribute( TRASH_DROP_ACTIVE_ATTR );
			if ( ! isDesktopFilePayload( session ) ) {
				return;
			}
			const placement = session.payload.data.placement;
			void trashByFileType( placement );
		},
	} );
}

/**
 * Wire up the recycle-bin drop targets. Idempotent — calling twice
 * is safe (the second call is a no-op).
 */
export function installRecycleBinDropTargets( dragManager: DragManagerApi ): void {
	if ( _installed ) {
		return;
	}
	_installed = true;

	// Re-register the bin TILE drop target whenever the wallpaper
	// might have rebuilt it. The unified files layer rebuilds tile
	// DOM on every store change (`desktop-mode-files-changed`); the
	// legacy dock rail rebuilds on `DOCK_AFTER_RENDER`. We listen to
	// both and re-discover via `findBinTile()`. Idempotent
	// re-registration via the registry's id-based replacement.
	const reprobeTile = (): void => {
		const el = findBinTile();
		if ( ! el ) {
			// Tile gone (legacy rail, no placement yet) — drop the
			// stale registration so the registry doesn't keep a
			// detached element.
			_dockDeregister?.();
			_dockDeregister = null;
			return;
		}
		// If the registered element is still the live tile, no work.
		if ( _dockDeregister && getRegisteredElementId( dragManager ) === el ) {
			return;
		}
		_dockDeregister?.();
		_dockDeregister = registerOn( dragManager, 'recycle-bin-dock', el );
	};

	// Initial probe — covers the case where the dock has already
	// rendered or the wallpaper layer has already mounted by the
	// time we run.
	reprobeTile();

	// Files-layer rebuild signal. Fires after every placement
	// upsert/remove that flips the layer's fingerprint. The bin's
	// tile DOM is replaced wholesale, so re-discover and re-register.
	document.addEventListener( 'desktop-mode-files-changed', reprobeTile );

	// Legacy desktop-icons rail rebuild signal — `renderDesktopIcons`
	// fires this CustomEvent (and the dock-after-render hook) on each
	// render.
	document.addEventListener( 'desktop-mode-desktop-icons-rendered', reprobeTile );
	addAction(
		HOOKS.DOCK_AFTER_RENDER,
		'desktop-mode/files/recycle-bin-dock-target',
		reprobeTile,
	);

	// Belt-and-braces: a MutationObserver on the wallpaper area
	// catches any DOM swap we missed (third-party plugin replacing
	// the tile, future renderer we don't know about). Disconnects
	// only on test reset; in production it lives forever.
	if ( typeof MutationObserver !== 'undefined' ) {
		_binMutationObserver = new MutationObserver( () => {
			reprobeTile();
		} );
		const desktopArea =
			document.getElementById( 'desktop-mode-area' ) ?? document.body;
		_binMutationObserver.observe( desktopArea, {
			childList: true,
			subtree: true,
		} );
	}

	// Window body — register on open, deregister on close.
	addAction(
		HOOKS.WINDOW_OPENED,
		'desktop-mode/files/recycle-bin-window-target',
		( detail: { windowId?: string } ) => {
			if ( detail.windowId !== RECYCLE_BIN_WINDOW_ID ) {
				return;
			}
			_windowDeregister?.();
			_windowDeregister = null;
			const el = document.querySelector(
				'[data-desktop-mode-recycle-bin-root]',
			);
			if ( el instanceof HTMLElement ) {
				_windowDeregister = registerOn(
					dragManager,
					'recycle-bin-window',
					el,
				);
			}
		},
	);

	addAction(
		HOOKS.WINDOW_CLOSED,
		'desktop-mode/files/recycle-bin-window-cleanup',
		( detail: { windowId?: string } ) => {
			if ( detail.windowId !== RECYCLE_BIN_WINDOW_ID ) {
				return;
			}
			_windowDeregister?.();
			_windowDeregister = null;
		},
	);
}

/**
 * Read the live `element` of the currently-registered
 * `recycle-bin-dock` target, or `null` if not registered. Used by
 * `reprobeTile` to skip re-registration when the element hasn't
 * changed.
 */
function getRegisteredElementId( dragManager: DragManagerApi ): HTMLElement | null {
	const t = dragManager
		.debug()
		.listTargets()
		.find( ( target ) => target.id === 'recycle-bin-dock' );
	return t ? t.element : null;
}

/** Test-only — resets the install latch + clears registrations. */
export function __resetRecycleBinDropTargetsForTests(): void {
	_dockDeregister?.();
	_windowDeregister?.();
	_binMutationObserver?.disconnect();
	_dockDeregister = null;
	_windowDeregister = null;
	_binMutationObserver = null;
	_installed = false;
}
