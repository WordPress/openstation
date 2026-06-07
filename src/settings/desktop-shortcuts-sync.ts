/**
 * Reconcile the user's `itemVisibility` map with the modern
 * files-layer placements store so dock-only items can be promoted
 * onto the wallpaper grid and server-registered desktop icons can
 * be hidden from it.
 *
 * Two flows:
 *
 * 1. **Promote a dock item to the desktop.** For every admin-menu
 *    item whose visibility is `'desktop'` or `'both'`, upsert a
 *    synthetic `shortcut` placement into the files store. The
 *    placement carries a deterministic negative id (hashed from the
 *    dock-item id) so re-syncs are idempotent. Position defaults
 *    to (0, 0) — the layer's `snapToEmptyCell` finds an open slot
 *    on first paint.
 *
 * 2. **Hide a server-registered icon.** For every icon in
 *    `config.desktopIcons` whose visibility is `'dock'` or
 *    `'hidden'`, remove the corresponding placement from the files
 *    store. The server still hydrates it on the next page load —
 *    this module re-applies on every change, so the icon disappears
 *    again immediately.
 *
 * Synthetic placements aren't persisted via REST; they live only
 * in the JS store. The source of truth is `itemVisibility`, so
 * promotion survives reloads even though placement positions don't.
 * If/when we want true position persistence for promoted items, a
 * follow-up can swap the in-memory upsert for `createPlacement` +
 * track the assigned real id in a side-map on the user meta.
 *
 * @since 0.25.0
 */

import { filesApi } from '../desktop-files';
import type { RestPlacementShape } from '../desktop-files/rest';
import type { DesktopConfig, DesktopIconServerEntry, DockItemConfig } from '../types';
import type { ItemVisibility, OsSettingsState } from './types';

/** Marker on `placement.meta` for shortcuts we synthesized. */
const SYNTH_META_KEY = '__synthFromDockItem';

/** Deterministic negative id from a string. */
function hashToNegativeId( s: string ): number {
	// Plain multiplicative hash — no bitwise ops so the result stays
	// safely within JS's number range without needing >>> coercion.
	// `Math.abs` + modulo into a positive range, then negate so we
	// never collide with the REST layer's positive ids.
	let h = 0;
	for ( let i = 0; i < s.length; i++ ) {
		h = ( h * 31 + s.charCodeAt( i ) ) % 0x7fffffff;
	}
	return -( h + 1 );
}

/** Build a synthetic placement representing a promoted dock item. */
function buildSyntheticPlacement(
	item: DockItemConfig,
	persistedPositions: Record< string, { x: number; y: number } >,
): RestPlacementShape {
	// Restore the user's last-dragged position if we have one. Falls
	// through to (0, 0) so the layer's `snapToEmptyCell` can find a
	// free grid slot on first promote.
	const saved = persistedPositions[ item.id ];
	return {
		id: hashToNegativeId( item.id ),
		parentId: 0,
		x: saved ? saved.x : 0,
		y: saved ? saved.y : 0,
		sortOrder: 9999,
		updatedAtMs: Date.now(),
		meta: { [ SYNTH_META_KEY ]: item.id },
		file: {
			type: 'shortcut',
			ref: `dock-promoted:${ item.id }`,
			title: item.title,
			icon: item.icon,
			previewUrl: '',
			exists: true,
			// The shortcut opener (built-in-openers.ts) reads these
			// off the file shape — `shortcutUrl` is what a dock-item
			// promotion naturally has.
			shortcutUrl: item.url,
		},
	};
}

/** Read the live dock items (from the dispatcher when available). */
function readDockItems(): DockItemConfig[] {
	const api = ( window as unknown as {
		wp?: {
			desktop?: {
				getMenuItems?: () => Array< {
					id: string;
					title: string;
					icon: string;
					url: string;
					badge?: number;
					submenu?: { title: string; url: string }[];
				} >;
			};
		};
	} ).wp?.desktop;
	if ( api?.getMenuItems ) {
		const items = api.getMenuItems();
		return items.map( ( i ) => ( {
			id: i.id,
			title: i.title,
			icon: i.icon,
			url: i.url,
			badge: i.badge ?? 0,
			submenu: i.submenu ?? [],
		} ) );
	}
	const cfg = ( window as unknown as { desktopModeConfig?: DesktopConfig } )
		.desktopModeConfig;
	return cfg?.dockItems ?? [];
}

function readServerIcons(): DesktopIconServerEntry[] {
	const cfg = ( window as unknown as { desktopModeConfig?: DesktopConfig } )
		.desktopModeConfig;
	return cfg?.desktopIcons ?? [];
}

/** Reentrancy guard so our own store writes don't trigger re-sync. */
let reentrant = false;

/**
 * Cache of server-icon placements that the sync removed from the
 * files store because the user set their visibility to `'dock'` or
 * `'hidden'`.
 *
 * Why we cache them: the placements still exist in the database (the
 * removal is JS-only) but if we don't keep a copy here, flipping the
 * visibility back to `'desktop'` / `'both'` has nothing to put back —
 * the wallpaper-grid path renders the change correctly, but the
 * files-layer can't surface a placement it no longer has. That's
 * exactly the "right-click → 'Also show on desktop' → tile doesn't
 * appear until F5" bug.
 *
 * Keyed by the canonical icon id (`placement.file.ref`).
 */
const removedServerPlacementsByRef = new Map< string, RestPlacementShape >();

/**
 * Strip the given source-item ids from the persisted
 * `dockPromotedPositions` map via the public OS-settings writer.
 *
 * Called when a promoted item is demoted or hidden, so its
 * last-dragged coordinate doesn't linger forever (counting toward the
 * 256-entry cap for, say, a deactivated plugin) or silently resurrect
 * the old slot if the item is re-promoted later. The `reentrant` guard
 * in {@link syncShortcutsWithVisibility} blocks the resulting
 * settings-change notification from re-running the sync synchronously,
 * and a later async re-run is a no-op (the position is already gone).
 */
function prunePromotedPositions( ids: string[] ): void {
	const api = ( window as unknown as {
		wp?: {
			desktop?: {
				getOsSettings?: () => {
					dockPromotedPositions?: Record<
						string,
						{ x: number; y: number }
					>;
				};
				updateOsSettings?: ( patch: {
					dockPromotedPositions: Record<
						string,
						{ x: number; y: number }
					>;
				} ) => void;
			};
		};
	} ).wp?.desktop;
	if ( ! api?.getOsSettings || ! api?.updateOsSettings ) {
		return;
	}
	const current = api.getOsSettings().dockPromotedPositions ?? {};
	const next: Record< string, { x: number; y: number } > = { ...current };
	let changed = false;
	for ( const id of ids ) {
		if ( id in next ) {
			delete next[ id ];
			changed = true;
		}
	}
	if ( changed ) {
		api.updateOsSettings( { dockPromotedPositions: next } );
	}
}

/**
 * Bring the files store in line with the current
 * {@link OsSettingsState.itemVisibility} map. The `positions`
 * argument is the matching `dockPromotedPositions` map — synth
 * placements built from a previously-dragged dock item land at the
 * stored coords instead of (0, 0).
 */
export function syncShortcutsWithVisibility(
	visibility: Record< string, ItemVisibility >,
	positions: Record< string, { x: number; y: number } > = {},
): void {
	if ( reentrant ) {
		return;
	}
	reentrant = true;
	try {
		const dockItems = readDockItems();
		const serverIcons = readServerIcons();

		const state = filesApi.store.getState();
		const root = state.placementsByFolder.get( 0 ) ?? [];

		// Index current synthetic placements by the source dock-item id.
		const currentSynth = new Map< string, RestPlacementShape >();
		for ( const p of root ) {
			const sourceId = ( p.meta ?? null ) &&
				typeof p.meta === 'object'
				? ( p.meta as Record< string, unknown > )[ SYNTH_META_KEY ]
				: null;
			if ( typeof sourceId === 'string' ) {
				currentSynth.set( sourceId, p );
			}
		}

		// Index real placements by icon-id ref. Server-registered
		// shortcuts have `file.ref` equal to the registered icon id
		// (PHP's serializer writes the icon's own id into the ref
		// field). Plugin authors creating their own shortcuts via
		// REST may use other refs — those are ignored here.
		const realByRef = new Map< string, RestPlacementShape >();
		const registeredIconIds = new Set< string >(
			serverIcons.map( ( i ) => i.id ),
		);
		for ( const p of root ) {
			const ref = p?.file?.ref;
			if ( typeof ref === 'string' && registeredIconIds.has( ref ) ) {
				realByRef.set( ref, p );
			}
		}

		// 1. Promote dock items.
		const desiredSynth = new Set< string >();
		for ( const item of dockItems ) {
			const placement = visibility[ item.id ];
			if ( placement === 'desktop' || placement === 'both' ) {
				desiredSynth.add( item.id );
				if ( ! currentSynth.has( item.id ) ) {
					filesApi.store.upsertPlacement(
						buildSyntheticPlacement( item, positions ),
					);
				}
			}
		}
		// Remove synthetic placements that are no longer wanted, and
		// prune their persisted drag position so stale coordinates can't
		// leak or silently resurrect on a future re-promote.
		const positionsToPrune: string[] = [];
		for ( const [ sourceId, p ] of currentSynth ) {
			if ( ! desiredSynth.has( sourceId ) ) {
				filesApi.store.removePlacement( p.id );
				if ( positions[ sourceId ] ) {
					positionsToPrune.push( sourceId );
				}
			}
		}
		if ( positionsToPrune.length > 0 ) {
			prunePromotedPositions( positionsToPrune );
		}

		// 2. Reconcile server-registered shortcuts (icons registered via
		//    `desktop_mode_register_icon()`) with the user's visibility:
		//
		//    - 'dock' / 'hidden' → remove the placement from the files
		//      store so the wallpaper stops painting the tile. Cache
		//      the row so we can restore it on a future flip-back
		//      without a REST round-trip.
		//    - 'desktop' / 'both' → if the cached copy says we removed
		//      this icon earlier, put the placement back in the store.
		//      The wallpaper-grid CSS-toggle path (`renderDesktopIcons`)
		//      handles this for `.desktop-mode-icons` already, but that
		//      grid is hidden whenever a files-layer is mounted
		//      (see `desktop-files.css`'s `:has(...)` rule) — so the
		//      visible surface is the files-layer, and the files-layer
		//      needs the placement back in its bucket to paint it.
		for ( const icon of serverIcons ) {
			const placement = visibility[ icon.id ];
			const inStore = realByRef.get( icon.id );
			if ( placement === 'dock' || placement === 'hidden' ) {
				if ( inStore ) {
					removedServerPlacementsByRef.set( icon.id, inStore );
					filesApi.store.removePlacement( inStore.id );
				}
				continue;
			}
			// 'desktop' / 'both' / undefined (native default) — should
			// be visible. If the store currently doesn't have it AND we
			// have a cached copy from an earlier hide, restore it.
			if ( ! inStore ) {
				const cached = removedServerPlacementsByRef.get( icon.id );
				if ( cached ) {
					filesApi.store.upsertPlacement( cached );
					removedServerPlacementsByRef.delete( icon.id );
				}
			}
		}
	} finally {
		reentrant = false;
	}
}

/**
 * Wire up the live reconciliation. Called once during shell boot.
 * Re-syncs whenever:
 *
 * - The files store changes (server hydration re-injects a hidden
 *   icon — we drop it again).
 * - The user updates visibility via OS Settings or the right-click
 *   menu (handled by an external caller passing the new snapshot).
 *
 * `getPositions` returns the persisted `dockPromotedPositions` map
 * (defaults to an empty record when the caller doesn't supply one,
 * for backwards-compat with older boot paths that didn't know about
 * the field yet).
 *
 * Returns a teardown function for tests / hot-reload.
 */
export function installShortcutsSync(
	getVisibility: () => Record< string, ItemVisibility >,
	getPositions: () => Record< string, { x: number; y: number } > = () => ( {} ),
): () => void {
	// Initial reconciliation — runs on a microtask so any
	// just-mounted desktop icons from the server hydration are in
	// the store before we filter.
	queueMicrotask( () =>
		syncShortcutsWithVisibility( getVisibility(), getPositions() ),
	);

	// Re-run on every store change so server-driven hydration
	// (e.g. a refresh fetching the full placements list) gets
	// filtered. The reentrancy guard prevents our own writes from
	// triggering an infinite loop.
	const off = filesApi.store.subscribe( () => {
		syncShortcutsWithVisibility( getVisibility(), getPositions() );
	} );

	return off;
}

export type OsSettingsVisibility = Pick<
	OsSettingsState,
	'itemVisibility'
>;
