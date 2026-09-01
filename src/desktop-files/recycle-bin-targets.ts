/**
 * OpenStation — Recycle bin drop targets.
 *
 * Registers the cross-window drop zones that accept a soft-trash
 * gesture from a desktop file tile:
 *
 *   1. The recycle-bin tile on the wallpaper. The bin is registered
 *      via `openstation_register_icon()` and surfaces in the unified
 *      files layer as a `'shortcut'` placement carrying
 *      `data-file-ref="desktop-mode-recycle-bin"`. We also accept the
 *      legacy desktop-icon rail (`[data-icon-id]`) and any dock-side
 *      bridge (`[data-system-id]`) so the registration is robust to
 *      future layout shifts.
 *
 *   2. The recycle-bin native window's body
 *      (`[data-os-recycle-bin-root]`). Registered on
 *      `WINDOW_OPENED`, deregistered on `WINDOW_CLOSED`.
 *
 * Both targets accept payloads of type `'desktop-file'`. On drop they
 * route to `trashByFileType()` — the same flow the right-click "Move
 * to Trash" menu uses, including the Undo toast and the cross-window
 * broadcast.
 *
 * Re-discovery: the wallpaper's bin tile is rebuilt on every store
 * change (the FilesLayer's wholesale repaint). We listen for
 * `os-files-changed` (store mutations),
 * `HOOKS.DESKTOP_ICONS_RENDERED` (legacy icon-rail rebuild), and
 * `HOOKS.DOCK_AFTER_RENDER` (legacy dock rebuild), plus a
 * `MutationObserver` on the wallpaper area as a belt-and-braces
 * fallback so the drop target is guaranteed to point at the LIVE
 * DOM element.
 */

import { __ } from '../i18n';
import { addAction, HOOKS } from '../hooks';
import { trashByRestPath } from './rest-trash';
import type { DragManagerApi, DragSession } from '../drag';
import { trashManyWithUndo } from './trash';
import { showToast } from '../toast';
import {
	recycleBinPayloadAccepts,
	recycleBinPayloadDrop,
} from './recycle-bin-payloads';
import type { RestPlacementShape } from './rest';
import {
	dragPlacements,
	dragShortcutItems,
	type DesktopFileDragData,
	type ShortcutDragData,
} from './drag-payloads';

/**
 * Shortcut kinds the recycle bin refuses regardless of payload:
 * `'user'` (deleting a person needs content reassignment, not a
 * trash) and `'attachment'` (media deletes permanently rather than
 * trashing). Everything else — posts, pages, any CPT — is trashable
 * when the payload carries the section's `restPath`, which is what
 * the DELETE runs against.
 */
const UNTRASHABLE_SHORTCUT_KINDS: ReadonlySet< string > = new Set( [
	'user',
	'attachment',
] );

const TRASH_DROP_ACTIVE_ATTR = 'data-os-trash-drop-active';
const RECYCLE_BIN_WINDOW_ID = 'desktop-mode-recycle-bin';

/**
 * Every surface representing the bin: the files layer's wallpaper
 * tile, the legacy icon rail, the dock's system tile.
 *
 * NOT alternatives to pick between. The classic layout shows the
 * wallpaper tile and the dock tile at once, so resolving "the" bin to
 * the first match left the dock tile with no drop target — dropping
 * on it did nothing at all.
 */
const BIN_SURFACES = [
	{ id: 'recycle-bin-tile', selector: `.os-file-tile[data-file-ref="${ RECYCLE_BIN_WINDOW_ID }"]` },
	{ id: 'recycle-bin-icon', selector: `[data-icon-id="${ RECYCLE_BIN_WINDOW_ID }"]` },
	{ id: 'recycle-bin-dock', selector: `[data-system-id="${ RECYCLE_BIN_WINDOW_ID }"]` },
] as const;

let _installed = false;
interface BinRegistration {
	el: HTMLElement;
	deregister: () => void;
}
/** Live tile registrations, keyed by drop-target id. */
const _tileRegistrations = new Map< string, BinRegistration >();
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
 * Whether a shortcut payload describes a trashable explorer entity.
 * The `restPath` is what the DELETE runs against — a payload without
 * one is refused up-front so the tile snaps back instead of
 * disappearing into a silent failure.
 */
function isTrashableShortcut( data: Partial< ShortcutDragData > ): boolean {
	if ( ! data.kind || ! data.ref || ! data.restPath ) {
		return false;
	}
	if ( UNTRASHABLE_SHORTCUT_KINDS.has( data.kind ) ) {
		return false;
	}
	const numericRef = Number.parseInt( data.ref, 10 );
	return Number.isFinite( numericRef ) && numericRef > 0;
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
				// A multi-drag is accepted only when EVERY item can be
				// trashed. Half-trashing a set the user dropped as one
				// gesture is the kind of partial success that reads as
				// total success.
				const set = dragPlacements(
					data as unknown as DesktopFileDragData,
				);
				if ( set.length > 1 ) {
					return set.every(
						( p ) =>
							p.file?.ref !== RECYCLE_BIN_WINDOW_ID &&
							p.canTrash !== false,
					);
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
			// trash via the cross-bundle `wp.os.myWordpress
			// .trashEntity()` API. Mirrors the right-click "Move to
			// Trash" CMO so both gestures end at the same REST call.
			if ( payload.type === 'shortcut' ) {
				const data = payload.data as Partial< ShortcutDragData >;
				const set = dragShortcutItems( data as ShortcutDragData );
				return (
					set.length > 0 && set.every( ( i ) => isTrashableShortcut( i ) )
				);
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
				// One gesture, one trash operation: `trashManyWithUndo`
				// collapses a set into a single toast whose Undo brings
				// all of them back. It routes a single item straight to
				// the per-item helper, so this covers both.
				void trashManyWithUndo(
					dragPlacements(
						session.payload.data as unknown as DesktopFileDragData,
					),
				);
				return;
			}
			if (
				session.payload.type !== 'shortcut' &&
				recycleBinPayloadDrop( session, ev )
			) {
				return;
			}
			if ( isShortcutPayload( session ) ) {
				const set = dragShortcutItems( session.payload.data );
				const trashing = set
					.map( ( item ) => ( {
						restPath: item.restPath,
						kind: item.kind,
						ref: Number.parseInt( item.ref, 10 ),
					} ) )
					.filter(
						( t ): t is { restPath: string; kind: string; ref: number } =>
							!! t.restPath &&
							Number.isFinite( t.ref ) &&
							t.ref > 0,
					);
				if ( trashing.length === 0 ) {
					return;
				}
				void Promise.allSettled(
					trashing.map( ( t ) => trashByRestPath( t.restPath, t.ref ) ),
				).then( ( results ) => {
					const failed = results.filter(
						( r ) => r.status === 'rejected',
					);
					for ( const failure of failed ) {
						// eslint-disable-next-line no-console
						console.error(
							'[openstation] recycle-bin: shortcut trash failed:',
							( failure as PromiseRejectedResult ).reason,
						);
					}
					// Broadcast what actually went — the payload `kind`
					// IS the post type — so every watching surface (the
					// explorer app's lists, the bin's own badge) drops
					// the tile without a reload.
					const trashed = trashing
						.filter( ( _t, i ) => results[ i ]?.status === 'fulfilled' )
						.reduce< Record< string, number[] > >( ( acc, t ) => {
							( acc[ t.kind ] ??= [] ).push( t.ref );
							return acc;
						}, {} );
					const announce = (
						window.wp as
							| {
									os?: {
										announceContentChange?: (
											type: string,
											action: string,
											ids: number[],
											owner?: string,
										) => void;
									};
							}
							| undefined
					)?.os?.announceContentChange;
					for ( const [ kind, ids ] of Object.entries( trashed ) ) {
						announce?.( kind, 'trashed', ids, 'recycle-bin' );
					}
					const moved = trashing.length - failed.length;
					if ( moved > 1 || failed.length > 0 ) {
						showToast( {
							message:
								failed.length > 0
									? `${ moved } moved to Trash · ${ failed.length } could not be moved`
									: `${ moved } items moved to Trash`,
							duration: failed.length > 0 ? 6000 : 4000,
						} );
					}
				} );
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
	// DOM on every store change (`os-files-changed`); the
	// legacy icon rail rebuilds on `DESKTOP_ICONS_RENDERED`; the
	// legacy dock rail rebuilds on `DOCK_AFTER_RENDER`. We listen to
	// all three and re-probe every surface in `BIN_SURFACES`.
	// Idempotent — re-registration is keyed by drop-target id.
	const reprobeTile = (): void => {
		for ( const { id, selector } of BIN_SURFACES ) {
			const el = document.querySelector( selector );
			const live = el instanceof HTMLElement ? el : null;
			const current = _tileRegistrations.get( id );
			if ( ! live ) {
				// Deregister so the registry doesn't hold a detached node.
				current?.deregister();
				_tileRegistrations.delete( id );
				continue;
			}
			if ( current && current.el === live ) {
				continue;
			}
			current?.deregister();
			_tileRegistrations.set( id, {
				el: live,
				deregister: registerOn( dragManager, id, live ),
			} );
		}
	};

	// Initial probe — covers the case where the dock has already
	// rendered or the wallpaper layer has already mounted by the
	// time we run.
	reprobeTile();

	// Files-layer rebuild signal. Fires after every placement
	// upsert/remove that flips the layer's fingerprint. The bin's
	// tile DOM is replaced wholesale, so re-discover and re-register.
	document.addEventListener( 'os-files-changed', reprobeTile );

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
			document.getElementById( 'os-area' ) ?? document.body;
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
				'[data-os-recycle-bin-root]',
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

/** Test-only — resets the install latch + clears registrations. */
export function __resetRecycleBinDropTargetsForTests(): void {
	for ( const { deregister } of _tileRegistrations.values() ) {
		deregister();
	}
	_tileRegistrations.clear();
	_windowDeregister?.();
	_binMutationObserver?.disconnect();
	_windowDeregister = null;
	_binMutationObserver = null;
	_installed = false;
}
