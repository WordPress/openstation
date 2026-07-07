/**
 * Item-placement helpers — apply the user's per-item visibility
 * preferences and dock ordering to the raw dock + desktop-icon lists
 * the layout dispatcher receives.
 *
 * Visibility model (matches OsSettingsState.itemVisibility):
 *
 * - `'both'`    — item appears on both dock and desktop. Synthesized
 *                 across rails when only one carries native metadata.
 * - `'dock'`    — only on the dock. Synthesized when natively desktop-
 *                 only. Suppressed from the desktop grid.
 * - `'desktop'` — only on the wallpaper. Synthesized when natively
 *                 dock-only. Suppressed from the dock.
 * - `'hidden'`  — suppressed from every shell surface.
 *
 * Missing key in the visibility map means "no override" — item appears
 * on its native rail and nowhere else.
 *
 * @since 0.8.2
 */

import type { DockItem } from '../dock';
import type { DesktopIconServerEntry } from '../types';
import type { ItemVisibility, OsSettingsState } from './types';

/**
 * The two rails a placeable item can live on. Items registered through
 * the admin menu pipeline default to `'dock'`; items registered via
 * `desktop_mode_register_icon()` default to `'desktop'`.
 */
export type NativeRail = 'dock' | 'desktop';

/**
 * Union view of a single shell-surface item. Used by the OS Settings
 * "Apps & Icons" tab to list every placeable thing in one table
 * regardless of which rail registered it.
 */
export interface PlaceableItem {
	id: string;
	title: string;
	icon: string;
	/** Where the item was originally registered. Drives the effective default. */
	nativeRail: NativeRail;
	/** Resolved placement after applying the user's override (defaults if absent). */
	placement: ItemVisibility;
}

/**
 * The id used for an item synthesized into the OPPOSITE rail. Kept
 * deterministic so re-renders address the same DOM node — the dock
 * uses `desktop:<id>` for a tile synthesized from a desktop icon, and
 * the desktop icon grid uses `dock:<id>` for an icon synthesized from
 * a dock item. The originating rail keeps the bare id.
 */
function synthDockId( desktopIconId: string ): string {
	return `desktop:${ desktopIconId }`;
}
function synthIconId( dockItemId: string ): string {
	return `dock:${ dockItemId }`;
}

/**
 * Strip the synthesis prefix to recover the user-facing id used as
 * the key in the visibility map. Right-click handlers on either rail
 * call this before reading or writing the override.
 */
export function canonicalItemId( id: string ): string {
	if ( id.startsWith( 'dock:' ) ) {
		return id.slice( 5 );
	}
	if ( id.startsWith( 'desktop:' ) ) {
		return id.slice( 8 );
	}
	return id;
}

/**
 * Resolve the effective placement for an item id given its native
 * rail. Returns the user override when present, otherwise the
 * implicit default ('dock' for dock-native, 'desktop' for desktop-
 * native) — never 'both' as a fallback, since an unconfigured item
 * does not auto-duplicate across rails.
 */
export function resolvePlacement(
	id: string,
	nativeRail: NativeRail,
	visibility: Record< string, ItemVisibility >,
): ItemVisibility {
	const override = visibility[ id ];
	if ( override ) {
		return override;
	}
	return nativeRail;
}

function shouldShowOnDock( placement: ItemVisibility ): boolean {
	return placement === 'dock' || placement === 'both';
}

function shouldShowOnDesktop( placement: ItemVisibility ): boolean {
	return placement === 'desktop' || placement === 'both';
}

/**
 * Apply visibility + ordering to a raw `DockItem[]` list. The result:
 *
 * 1. Items whose effective placement excludes the dock are filtered
 *    out.
 * 2. Desktop-native icons whose effective placement includes the dock
 *    are synthesized into placeholder `DockItem`s and appended (with
 *    `id: 'desktop:<icon-id>'` so live re-renders keep their DOM
 *    handle stable).
 * 3. The combined list is reordered to match `dockOrder`. Ids not in
 *    the order list keep their relative position and render after the
 *    explicitly-ordered ones, preserving the server-supplied order.
 */
export function applyDockPlacement(
	dockItems: DockItem[],
	desktopIcons: DesktopIconServerEntry[],
	settings: Pick< OsSettingsState, 'itemVisibility' | 'dockOrder' >,
	/**
	 * Native-window ids ALREADY mounted on the dock as framework
	 * system tiles (e.g. Recycle Bin's taskbar-placement window
	 * registration, plugin-owned native-window launchers). When an
	 * icon's `window` field is in this set, skip the synthesis —
	 * the dock would otherwise paint the same target twice.
	 *
	 * @since 0.8.2
	 */
	dockedNativeWindows?: ReadonlySet< string >,
): DockItem[] {
	const visibility = settings.itemVisibility;
	const order = settings.dockOrder;

	// 1. Filter native dock items by placement.
	const kept: DockItem[] = [];
	for ( const item of dockItems ) {
		const placement = resolvePlacement( item.id, 'dock', visibility );
		if ( shouldShowOnDock( placement ) ) {
			kept.push( item );
		}
	}

	// 2. Synthesize dock tiles for desktop icons promoted to the
	//    dock, EXCEPT those whose target native window is already
	//    on the dock as a framework system tile (Recycle Bin et al).
	for ( const icon of desktopIcons ) {
		const placement = resolvePlacement( icon.id, 'desktop', visibility );
		if ( ! shouldShowOnDock( placement ) ) {
			continue;
		}
		if (
			icon.window &&
			dockedNativeWindows &&
			dockedNativeWindows.has( icon.window )
		) {
			continue;
		}
		kept.push( {
			id: synthIconId( icon.id ),
			title: icon.title,
			icon: icon.icon,
			url: icon.url || '',
			// Carry the native-window id forward so the dock can light
			// the active-dot indicator + show the hover-peek card when
			// the target window is open. Without this, window-target
			// icons (no `url`) synthesize a tile whose only id-bearing
			// field is an empty string — deriveWindowId('') matches
			// nothing the window manager has stored.
			windowId: icon.window || undefined,
			badge: 0,
			submenu: [],
			isCore: false,
		} );
	}

	// 3. Reorder.
	return applyOrder( kept, order );
}

/**
 * Apply visibility to a raw desktop-icon list. Filters out icons
 * suppressed from the desktop, then synthesizes new icons for any
 * dock-native items promoted to the wallpaper.
 *
 * The synthesized id prefix (`'dock:'`) lets right-click handlers on
 * the wallpaper recover the original dock-item id via
 * {@link canonicalItemId} when writing the visibility override.
 */
export function applyDesktopPlacement(
	desktopIcons: DesktopIconServerEntry[],
	dockItems: DockItem[],
	visibility: Record< string, ItemVisibility >,
): DesktopIconServerEntry[] {
	const out: DesktopIconServerEntry[] = [];

	for ( const icon of desktopIcons ) {
		const placement = resolvePlacement( icon.id, 'desktop', visibility );
		if ( shouldShowOnDesktop( placement ) ) {
			out.push( icon );
		}
	}

	let synthIndex = 0;
	for ( const item of dockItems ) {
		const placement = resolvePlacement( item.id, 'dock', visibility );
		if ( ! shouldShowOnDesktop( placement ) ) {
			continue;
		}
		out.push( {
			id: synthDockId( item.id ),
			title: item.title,
			icon: item.icon,
			window: '',
			url: item.url || '',
			// Place synthesized dock-promoted icons after server-registered
			// ones. Stable ordering by source-list index inside the bucket.
			position: 2000 + synthIndex++,
		} );
	}

	return out;
}

/**
 * Reorder a flat item list to match an explicit id order. Ids not in
 * `order` keep their relative source position and render after the
 * explicitly-ordered slice.
 *
 * Exported for the dock drag-to-reorder handler: it splices an id to
 * a new index and pipes the result through `applyOrder` to render the
 * intermediate state during a drag without committing to state until
 * drop.
 */
export function applyOrder< T extends { id: string } >(
	items: T[],
	order: ReadonlyArray< string >,
): T[] {
	if ( order.length === 0 || items.length <= 1 ) {
		return items;
	}
	const byId = new Map< string, T >();
	for ( const item of items ) {
		byId.set( item.id, item );
	}
	const out: T[] = [];
	const placed = new Set< string >();
	for ( const id of order ) {
		const item = byId.get( id );
		if ( item ) {
			out.push( item );
			placed.add( id );
		}
	}
	for ( const item of items ) {
		if ( ! placed.has( item.id ) ) {
			out.push( item );
		}
	}
	return out;
}

/**
 * Build the union list shown in the OS Settings → Apps & Icons tab.
 * Union of dock items and desktop icons (dock wins on id collisions),
 * sorted alphabetically by display title for the flat picker. The
 * resolved `placement` on each entry is what the picker pre-selects.
 */
export function listPlaceableItems(
	dockItems: DockItem[],
	desktopIcons: DesktopIconServerEntry[],
	visibility: Record< string, ItemVisibility >,
): PlaceableItem[] {
	const out: PlaceableItem[] = [];
	const seen = new Set< string >();

	for ( const item of dockItems ) {
		if ( seen.has( item.id ) ) {
			continue;
		}
		seen.add( item.id );
		out.push( {
			id: item.id,
			title: item.title,
			icon: item.icon,
			nativeRail: 'dock',
			placement: resolvePlacement( item.id, 'dock', visibility ),
		} );
	}

	for ( const icon of desktopIcons ) {
		if ( seen.has( icon.id ) ) {
			continue;
		}
		seen.add( icon.id );
		out.push( {
			id: icon.id,
			title: icon.title,
			icon: icon.icon,
			nativeRail: 'desktop',
			placement: resolvePlacement( icon.id, 'desktop', visibility ),
		} );
	}

	// Alphabetical by display title — the OS Settings → Apps & Icons
	// list is a flat picker, so the user's reading order is the
	// natural sort. `localeCompare` with the `'base'` sensitivity
	// folds case + accents so "WooCommerce" and "woocommerce" land
	// adjacently regardless of how the plugin registered its label.
	out.sort( ( a, b ) =>
		a.title.localeCompare( b.title, undefined, { sensitivity: 'base' } ),
	);

	return out;
}
