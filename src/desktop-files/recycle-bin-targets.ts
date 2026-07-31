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
 * change (the FilesLayer's wholesale repaint). We listen for
 * `desktop-mode-files-changed` (store mutations),
 * `HOOKS.DESKTOP_ICONS_RENDERED` (legacy icon-rail rebuild), and
 * `HOOKS.DOCK_AFTER_RENDER` (legacy dock rebuild), plus a
 * `MutationObserver` on the wallpaper area as a belt-and-braces
 * fallback so the drop target is guaranteed to point at the LIVE
 * DOM element.
 */

import { __ } from '../i18n';
import { addAction, HOOKS } from '../hooks';
import type { DragManagerApi, DragSession } from '../drag';
import { trashByFileType } from './trash';
import {
	recycleBinPayloadAccepts,
	recycleBinPayloadDrop,
} from './recycle-bin-payloads';
import type { RestPlacementShape } from './rest';
import type { ShortcutDragData } from './drag-payloads';

/**
 * My WordPress entity kinds the recycle bin knows how to trash via
 * the cross-bundle `wp.desktop.myWordpress.trashEntity()` API. `kind`
 * here is the abstract drag-payload kind (matches `ShortcutDragData
 * .kind`), not the entity id — both posts and pages drag as
 * `'post'`. The `entityId` field on the payload disambiguates which
 * REST endpoint the trash hits.
 *
 * Limited to `'post'` for now (covers Posts + Pages). `'user'` and
 * `'media'` require different DELETE semantics (user reassignment,
 * attachment vs post-trash) — wire those when the corresponding
 * confirm + REST paths are in place.
 */
const TRASHABLE_SHORTCUT_KINDS: ReadonlySet< string > = new Set( [ 'post' ] );

interface MyWordpressTrashApi {
	trashEntity?: ( entityId: string, id: number ) => Promise< void >;
}

function getMyWordpressTrashApi(): MyWordpressTrashApi | null {
	const api = (
		window as unknown as {
			wp?: { desktop?: { myWordpress?: MyWordpressTrashApi } };
		}
	).wp?.desktop?.myWordpress;
	return api && typeof api.trashEntity === 'function' ? api : null;
}

const TRASH_DROP_ACTIVE_ATTR = 'data-desktop-mode-trash-drop-active';
const RECYCLE_BIN_WINDOW_ID = 'desktop-mode-recycle-bin';

/**
 * Selectors that all match the recycle bin tile, in order of
 * preference. The first matching element wins.
 *
 *   - `.desktop-mode-file-tile[data-file-ref="…"]` — the unified
 *     files layer's representation (current default).
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

function isShortcutPayload(
	session: DragSession,
): session is DragSession & { payload: { type: 'shortcut'; data: ShortcutDragData } } {
	return session.payload.type === 'shortcut';
}

/**
 * Whether a shortcut payload describes a trashable My WordPress
 * entity. Both the `entityId` (REST routing) and the My Wordpress
 * trash API must be available — otherwise the drop would either 403
 * or no-op, and we'd rather refuse it up-front so the tile snaps
 * back instead of disappearing into a silent failure.
 */
function isTrashableShortcut( data: Partial< ShortcutDragData > ): boolean {
	if ( ! data.kind || ! data.ref || ! data.entityId ) {
		return false;
	}
	if ( ! TRASHABLE_SHORTCUT_KINDS.has( data.kind ) ) {
		return false;
	}
	const numericRef = Number.parseInt( data.ref, 10 );
	if ( ! Number.isFinite( numericRef ) || numericRef <= 0 ) {
		return false;
	}
	return getMyWordpressTrashApi() !== null;
}

function registerOn(
	dragManager: DragManagerApi,
	id: string,
	el: HTMLElement,
): () => void {
	return dragManager.registerDropTarget( {
		id,
		element: el,
		// Override the ghost-chip label: while the cursor is over
		// the bin the user is trashing, not creating a shortcut /
		// moving the placement. The DragManager swaps this in for
		// the payload-default "Drop here to create shortcut" /
		// "Drop here to move" chip text whenever this target is the
		// current accept-mode target.
		acceptLabel: __( 'Move to Trash', 'desktop-mode' ),
		// Reject the drop UP FRONT when the viewer can't trash the
		// payload's placement (e.g. an item inside a read-only
		// shared folder, or someone else's tile in a shared
		// namespace). `accept` flipping to `false` means the
		// drop-active highlight never lights up + onDrop never
		// fires + the drag manager surfaces a `rejected` outcome.
		// The user sees the icon snap back instead of attempting a
		// REST call that would 403 and only log to the console.
		accept: ( payload ) => {
			if ( payload.type === 'desktop-file' ) {
				const data = payload.data as Partial< DesktopFilePayloadData >;
				const placement = data?.placement;
				if ( ! placement ) {
					return false;
				}
				// Never trash the recycle bin into itself. Both drop
				// surfaces (the bin's wallpaper tile + the bin window
				// body) share this `accept`, so dragging the bin onto
				// either one used to land on `trashByFileType` →
				// `trashPlacementWithUndo` and the bin's own placement
				// got soft-trashed. Visible result: the bin vanished
				// from the desktop, with no obvious way back short of
				// a reload (which re-auto-placed it because the orphan
				// backfill only counts non-trashed placements).
				if ( placement.file?.ref === RECYCLE_BIN_WINDOW_ID ) {
					return false;
				}
				// `canTrash === false` is an explicit veto from the
				// server. `undefined` (legacy clients / older payloads
				// that pre-date the flag) defaults to "let it through"
				// — the existing REST 403 path still backstops anything
				// that slips past this check.
				return placement.canTrash !== false;
			}
			// `'shortcut'` payloads originate from My WordPress entity
			// tiles (and any plugin that builds the same shape). The
			// recycle bin accepts those whose `kind` we know how to
			// trash via the cross-bundle `wp.desktop.myWordpress
			// .trashEntity()` API. Mirrors the right-click "Move to
			// Trash" CMO so both gestures end at the same REST call.
			if ( payload.type === 'shortcut' ) {
				const data = payload.data as Partial< ShortcutDragData >;
				return isTrashableShortcut( data );
			}
			// Payload types this module doesn't own (the pinned-notes
			// `'note'` drag today) can be claimed by a registered bin
			// payload handler — the drop-target registry allows one
			// target per element, so other features route their trash
			// gesture through these shared targets.
			return recycleBinPayloadAccepts( payload );
		},
		onEnter: () => {
			el.setAttribute( TRASH_DROP_ACTIVE_ATTR, '' );
		},
		onLeave: () => {
			el.removeAttribute( TRASH_DROP_ACTIVE_ATTR );
		},
		onDrop: ( session, ev ) => {
			el.removeAttribute( TRASH_DROP_ACTIVE_ATTR );
			if ( isDesktopFilePayload( session ) ) {
				const placement = session.payload.data.placement;
				void trashByFileType( placement );
				return;
			}
			if (
				session.payload.type !== 'shortcut' &&
				recycleBinPayloadDrop( session, ev )
			) {
				return;
			}
			if ( isShortcutPayload( session ) ) {
				const data = session.payload.data;
				const api = getMyWordpressTrashApi();
				if ( ! api?.trashEntity || ! data.entityId ) {
					return;
				}
				const numericRef = Number.parseInt( data.ref, 10 );
				if ( ! Number.isFinite( numericRef ) || numericRef <= 0 ) {
					return;
				}
				void api.trashEntity( data.entityId, numericRef ).catch(
					( err: unknown ) => {
						// eslint-disable-next-line no-console
						console.error(
							'[desktop-mode] recycle-bin: shortcut trash failed:',
							err,
						);
					},
				);
			}
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
	// legacy icon rail rebuilds on `DESKTOP_ICONS_RENDERED`; the
	// legacy dock rail rebuilds on `DOCK_AFTER_RENDER`. We listen to
	// all three and re-discover via `findBinTile()`. Idempotent
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
	// fires this hook action on each render that changed the DOM.
	addAction(
		HOOKS.DESKTOP_ICONS_RENDERED,
		'desktop-mode/files/recycle-bin-icons-target',
		reprobeTile,
	);
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
