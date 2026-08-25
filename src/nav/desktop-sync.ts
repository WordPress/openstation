/**
 * Paint the wallpaper half of the navigation into the files layer.
 *
 * The desktop the user sees is the files layer, which renders
 * placements. Registered icons arrive there from the server; anything
 * else the user put on the wallpaper — an admin menu, an app launcher,
 * the Trash — has no row behind it and needs a synthetic placement
 * minted into the store.
 *
 * This module does not decide what belongs on the wallpaper. It is
 * handed `computeNav`'s desktop list and makes the store match it.
 *
 * Synthetic placements are never persisted through the files REST
 * layer; they live only in the JS store. The sources of truth are
 * `navPlacement` (what is on the wallpaper) and `dockPromotedPositions`
 * (where the user last dragged it), both in OS settings — so this
 * module restores both on every sync.
 */

import { filesApi } from '../desktop-files';
import { addAction, removeAction, HOOKS } from '../hooks';
import type { RestPlacementShape } from '../desktop-files/rest';
import type { NavItem } from './types';

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
 * Build a synthetic placement for an item the user put on the
 * wallpaper that has no registered icon of its own.
 *
 * Two things vary with what backs the item.
 *
 * **The opener.** A menu has a url; a system tile has neither a url
 * nor, half the time, a window (Mio's toggles the companion). So a
 * tile carries `shortcutSystemTile` and the opener runs the tile's own
 * `onOpen`, which is what makes the wallpaper copy and the dock copy
 * the same button in two places.
 *
 * **The ref.** A menu's is prefixed, so a promoted admin menu cannot
 * be mistaken for a registered shortcut of the same id. A system
 * tile's is the bare tile id, because being recognisable as itself is
 * the entire point: three lookups in the files layer and the dock find
 * the bin by `file.ref === 'desktop-mode-recycle-bin'` — the
 * drag-to-trash drop target, the drop-rejection exemption, and the
 * empty/full art swap. Prefix it and the wallpaper bin turns into a
 * tile that refuses every drop and never fills up.
 */
function buildSyntheticPlacement(
	item: NavItem,
	persistedPositions: Record< string, { x: number; y: number } >,
): RestPlacementShape {
	const isTile = !! item.tile;
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
			ref: isTile ? item.id : `dock-promoted:${ item.id }`,
			title: item.title,
			icon: item.icon,
			previewUrl: '',
			exists: true,
			...( isTile
				? { shortcutSystemTile: item.id }
				: { shortcutUrl: item.menu?.url ?? '' } ),
		},
	} as RestPlacementShape;
}

/** Reentrancy guard so our own store writes don't trigger re-sync. */
let reentrant = false;

/**
 * Cache of server-icon placements the sync removed from the files
 * store because the user took the icon off the wallpaper.
 *
 * The placements still exist in the database (the removal is JS-only)
 * but without a copy here, putting the icon back has nothing to
 * restore — the wallpaper-grid path renders the change correctly, but
 * the files layer can't surface a placement it no longer has. That is
 * exactly the "right-click → show on desktop → tile doesn't appear
 * until F5" bug.
 *
 * Keyed by the canonical icon id (`placement.file.ref`).
 */
const removedServerPlacementsByRef = new Map< string, RestPlacementShape >();

/**
 * Strip the given ids from the persisted `dockPromotedPositions` map
 * via the public OS-settings writer.
 *
 * Called when a promoted item leaves the wallpaper, so its
 * last-dragged coordinate doesn't linger forever (counting toward the
 * 256-entry cap for, say, a deactivated plugin) or silently resurrect
 * the old slot if it comes back later. The `reentrant` guard blocks
 * the resulting settings-change notification from re-running the sync
 * synchronously, and a later async re-run is a no-op.
 */
function prunePromotedPositions( ids: string[] ): void {
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
 * Bring the files store in line with `computeNav`'s desktop list.
 *
 * @param desktop   Items the navigation says belong on the wallpaper.
 * @param allItems  Every navigable item, so registered icons the
 *                  navigation left off the wallpaper can be pulled out
 *                  of the store.
 * @param positions `dockPromotedPositions` — synth placements land at
 *                  the stored coords instead of (0, 0).
 */
export function syncDesktopShortcuts(
	desktop: readonly NavItem[],
	allItems: readonly NavItem[],
	positions: Record< string, { x: number; y: number } > = {},
): void {
	if ( reentrant ) {
		return;
	}
	reentrant = true;
	try {
		const state = filesApi.store.getState();
		const root = state.placementsByFolder.get( 0 ) ?? [];
		const wanted = new Set( desktop.map( ( item ) => item.id ) );

		// Index current synthetic placements by the item they came from.
		const currentSynth = new Map< string, RestPlacementShape >();
		for ( const p of root ) {
			const sourceId =
				p.meta && typeof p.meta === 'object'
					? ( p.meta as Record< string, unknown > )[ SYNTH_META_KEY ]
					: null;
			if ( typeof sourceId === 'string' ) {
				currentSynth.set( sourceId, p );
			}
		}

		// Index real placements by icon-id ref. Server-registered
		// shortcuts have `file.ref` equal to the registered icon id
		// (PHP's serializer writes the icon's own id into the ref
		// field). Plugin authors creating their own shortcuts via REST
		// may use other refs — those are ignored here.
		const registeredIconIds = new Set< string >();
		for ( const item of allItems ) {
			if ( item.entry ) {
				registeredIconIds.add( item.entry.id );
			}
		}
		const realByRef = new Map< string, RestPlacementShape >();
		for ( const p of root ) {
			const ref = p?.file?.ref;
			if ( typeof ref === 'string' && registeredIconIds.has( ref ) ) {
				realByRef.set( ref, p );
			}
		}

		// 1. Mint a placement for every wallpaper item with no icon of
		//    its own — a promoted admin menu, or a system tile.
		for ( const item of desktop ) {
			if ( item.entry || currentSynth.has( item.id ) ) {
				continue;
			}
			filesApi.store.upsertPlacement(
				buildSyntheticPlacement( item, positions ),
			);
		}

		// 2. Drop synthetic placements that are no longer wanted, and
		//    prune the persisted drag position with them: the item is
		//    off the wallpaper because the user took it off.
		const positionsToPrune: string[] = [];
		for ( const [ sourceId, p ] of currentSynth ) {
			if ( wanted.has( sourceId ) ) {
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

		// 3. Reconcile server-registered icons. The server re-hydrates
		//    every one of them on each page load, so an icon the user
		//    moved off the wallpaper has to be pulled back out; the row
		//    is cached so putting it back needs no REST round-trip.
		for ( const item of allItems ) {
			const entry = item.entry;
			if ( ! entry ) {
				continue;
			}
			const inStore = realByRef.get( entry.id );
			if ( ! wanted.has( item.id ) ) {
				if ( inStore ) {
					removedServerPlacementsByRef.set( entry.id, inStore );
					filesApi.store.removePlacement( inStore.id );
				}
				continue;
			}
			if ( ! inStore ) {
				const cached = removedServerPlacementsByRef.get( entry.id );
				if ( cached ) {
					filesApi.store.upsertPlacement( cached );
					removedServerPlacementsByRef.delete( entry.id );
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
 * - The files store changes (server hydration re-injects an icon the
 *   user took off the wallpaper — we drop it again).
 * - A system tile is appended to a rail. Those arrive late: a native
 *   window's tile is registered only after its bundle has loaded, so
 *   the first pass can run before the tile exists and find nothing to
 *   promote. A user with the Trash on the desktop would then have it
 *   on neither surface until some unrelated store write happened
 *   along. It covers the plugin activated mid-session for free.
 * - The user changes a placement (handled by an external caller
 *   re-invoking {@link syncDesktopShortcuts}).
 *
 * Returns a teardown function for tests / hot-reload.
 */
export function installShortcutsSync( sync: () => void ): () => void {
	// Initial reconciliation — runs on a microtask so any just-mounted
	// desktop icons from the server hydration are in the store before
	// we filter.
	queueMicrotask( sync );

	const off = filesApi.store.subscribe( sync );

	const namespace = 'desktop-mode/shortcuts-sync';
	addAction( HOOKS.DOCK_ITEM_APPENDED, namespace, sync );

	return () => {
		off();
		removeAction( HOOKS.DOCK_ITEM_APPENDED, namespace );
	};
}
