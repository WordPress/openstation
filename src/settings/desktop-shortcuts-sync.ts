/**
 * Reconcile the user's `itemVisibility` map with the modern
 * files-layer placements store so dock-only items can be promoted
 * onto the wallpaper grid and server-registered desktop icons can
 * be hidden from it.
 *
 * Three flows:
 *
 * 1. **Promote a dock item to the desktop.** For every admin-menu
 *    item whose visibility is `'desktop'` or `'both'`, upsert a
 *    synthetic `shortcut` placement into the files store. The
 *    placement carries a deterministic negative id (hashed from the
 *    dock-item id) so re-syncs are idempotent. Position defaults
 *    to (0, 0) — the layer's `snapToEmptyCell` finds an open slot
 *    on first paint.
 *
 *    Placeable **system tiles** (the Trash, Mio) promote the same
 *    way. They carry no url to open, so their placement names the
 *    tile instead and the shortcut opener calls the tile's own
 *    `onOpen` — the wallpaper copy does exactly what the dock copy
 *    does, including for a tile that toggles rather than opens.
 *
 * 2. **Hide a server-registered icon.** For every icon in
 *    `config.desktopIcons` whose visibility is `'dock'` or
 *    `'hidden'`, remove the corresponding placement from the files
 *    store. The server still hydrates it on the next page load —
 *    this module re-applies on every change, so the icon disappears
 *    again immediately.
 *
 * Synthetic placements aren't persisted via the files REST layer;
 * they live only in the JS store. The sources of truth are
 * `itemVisibility` (promotion) and `dockPromotedPositions`
 * (positions), both in the OS Settings user meta — so promotion and
 * the user's last-dragged position survive reloads; this module
 * restores both on every sync.
 */

import { filesApi } from '../desktop-files';
import type { RestPlacementShape } from '../desktop-files/rest';
import type { DesktopConfig, DesktopIconServerEntry, DockItemConfig } from '../types';
import { resolvePlacement, type PlaceableSystemTile } from './item-placement';
import type { ItemVisibility, OsSettingsState } from './types';
import type { OsSettingsSnapshot } from './registry';

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

/**
 * Build a synthetic placement representing a promoted system tile.
 *
 * `shortcutSystemTile` rather than `shortcutUrl`: a system tile has
 * no url, and half of them don't open a window either (Mio's toggles
 * the companion). Naming the tile lets the opener run the tile's own
 * `onOpen`, so the wallpaper copy and the dock copy are the same
 * button in two places.
 */
function buildSyntheticTilePlacement(
	tile: PlaceableSystemTile,
	persistedPositions: Record< string, { x: number; y: number } >,
): RestPlacementShape {
	const saved = persistedPositions[ tile.id ];
	return {
		id: hashToNegativeId( tile.id ),
		parentId: 0,
		x: saved ? saved.x : 0,
		y: saved ? saved.y : 0,
		sortOrder: 9999,
		updatedAtMs: Date.now(),
		meta: { [ SYNTH_META_KEY ]: tile.id },
		file: {
			type: 'shortcut',
			ref: `dock-promoted:${ tile.id }`,
			title: tile.title,
			icon: tile.icon,
			previewUrl: '',
			exists: true,
			shortcutSystemTile: tile.id,
		},
	} as RestPlacementShape;
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
			os?: {
				getMenuItems?: () => Array< {
					id: string;
					title: string;
					icon: string;
					url: string;
					badge?: number;
					submenu?: { title: string; url: string }[];
					isCore?: boolean;
				} >;
			};
		};
	} ).wp?.os;
	if ( api?.getMenuItems ) {
		const items = api.getMenuItems();
		return items.map( ( i ) => ( {
			id: i.id,
			title: i.title,
			icon: i.icon,
			url: i.url,
			badge: i.badge ?? 0,
			submenu: i.submenu ?? [],
			isCore: i.isCore,
		} ) );
	}
	const cfg = ( window as unknown as { openStationConfig?: DesktopConfig } )
		.openStationConfig;
	return cfg?.dockItems ?? [];
}

/**
 * Read the system tiles that opted into per-item placement. Only the
 * live dispatcher knows these — they carry no server-side entry.
 */
function readPlaceableSystemTiles(): PlaceableSystemTile[] {
	const api = ( window as unknown as {
		wp?: { os?: { listSystemTiles?: () => PlaceableSystemTile[] } };
	} ).wp?.os;
	if ( typeof api?.listSystemTiles !== 'function' ) {
		return [];
	}
	return api.listSystemTiles().filter( ( t ) => t.placeable );
}

function readServerIcons(): DesktopIconServerEntry[] {
	const cfg = ( window as unknown as { openStationConfig?: DesktopConfig } )
		.openStationConfig;
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
			os?: {
				getOsSettings?: () => OsSettingsSnapshot;
				updateOsSettings?: (
					patch: Partial< OsSettingsSnapshot >,
				) => void;
			};
		};
	} ).wp?.os;
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

		// 1. Promote dock items the user explicitly moved to the desktop.
		const desiredSynth = new Set< string >();
		for ( const item of dockItems ) {
			const resolved = resolvePlacement( item.id, 'dock', visibility );
			if ( resolved === 'desktop' || resolved === 'both' ) {
				desiredSynth.add( item.id );
				if ( ! currentSynth.has( item.id ) ) {
					filesApi.store.upsertPlacement(
						buildSyntheticPlacement( item, positions ),
					);
				}
			}
		}
		// Same for the system tiles that opted in. Their only native
		// rail is the dock, so one lands here only once the user has
		// asked for it.
		for ( const tile of readPlaceableSystemTiles() ) {
			const resolved = resolvePlacement( tile.id, 'dock', visibility );
			if ( resolved === 'desktop' || resolved === 'both' ) {
				desiredSynth.add( tile.id );
				if ( ! currentSynth.has( tile.id ) ) {
					filesApi.store.upsertPlacement(
						buildSyntheticTilePlacement( tile, positions ),
					);
				}
			}
		}
		// Remove synthetic placements that are no longer wanted, and
		// prune the persisted drag position with them: the item is off
		// the desktop because the user took it off.
		const positionsToPrune: string[] = [];
		for ( const [ sourceId, p ] of currentSynth ) {
			if ( desiredSynth.has( sourceId ) ) {
				continue;
			}
			filesApi.store.removePlacement( p.id );
			if ( positions[ sourceId ] ) {
				positionsToPrune.push( sourceId );
			}
		}
		if ( positionsToPrune.length > 0 ) {
			prunePromotedPositions( positionsToPrune );
		}

		// 2. Reconcile server-registered shortcuts (icons registered via
		//    `openstation_register_icon()`) with the user's visibility:
		//
		//    - 'dock' / 'hidden' → remove the placement from the files
		//      store so the wallpaper stops painting the tile. Cache
		//      the row so we can restore it on a future flip-back
		//      without a REST round-trip.
		//    - 'desktop' / 'both' → if the cached copy says we removed
		//      this icon earlier, put the placement back in the store.
		//      The wallpaper-grid CSS-toggle path (`renderDesktopIcons`)
		//      handles this for `.os-icons` already, but that
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
