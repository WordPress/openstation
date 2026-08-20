/**
 * Build the flat {@link NavItem} list from the four registration
 * paths, collapsing anything registered more than once into a single
 * entry.
 *
 * The collapse is the load-bearing part. `openstation_register_icon()`
 * and `openstation_register_window()` are documented as orthogonal —
 * "a single plugin can register a window AND an icon that opens it" —
 * so an app legitimately arrives here twice. One id, one item, one
 * default, one answer.
 */

import type { DockItem, SystemDockItem } from '../dock';
import type { DesktopIconServerEntry } from '../types';
import type { NavItem, NavKind } from './types';

/** A system tile plus the kind its registration declared. */
export interface NavSystemTile {
	item: SystemDockItem;
	/** `'app'` for a launcher, `'control'` for a shell affordance. */
	kind: Extract< NavKind, 'app' | 'control' >;
	/** Exit OpenStation. Never movable, never hideable. */
	locked?: boolean;
}

export interface NavSources {
	/** Admin menus from the server payload, core and plugin alike. */
	menuItems: readonly DockItem[];
	/** JS-registered tiles: native-window launchers and shell tiles. */
	systemTiles: readonly NavSystemTile[];
	/** `openstation_register_icon()` entries. */
	icons: readonly DesktopIconServerEntry[];
	/**
	 * Window-manager key for an admin menu, so the running indicator
	 * finds the window a tile actually opens. Supplied by the caller
	 * because it depends on the native-window URL remaps
	 * (`nativePostsEnabled` and friends), which nav has no business
	 * knowing about.
	 */
	resolveMenuWindowId?: ( item: DockItem ) => string;
}

export function buildNavItems( sources: NavSources ): NavItem[] {
	const items: NavItem[] = [];
	const byId = new Map< string, NavItem >();

	const push = ( item: NavItem ): void => {
		items.push( item );
		byId.set( item.id, item );
	};

	for ( const menu of sources.menuItems ) {
		if ( byId.has( menu.id ) ) {
			continue;
		}
		push( {
			id: menu.id,
			kind: menu.isCore ? 'core' : 'plugin',
			title: menu.title,
			icon: menu.icon,
			windowId: sources.resolveMenuWindowId?.( menu ) || undefined,
			menu,
		} );
	}

	for ( const tile of sources.systemTiles ) {
		const existing = byId.get( tile.item.id );
		if ( existing ) {
			existing.tile = tile.item;
			continue;
		}
		const rows = tile.item.submenu ?? [];
		const answersFor = rows
			.map( ( row ) => row.windowId )
			.filter( ( id ): id is string => !! id );
		push( {
			id: tile.item.id,
			kind: tile.kind,
			title: tile.item.title,
			icon: tile.item.icon,
			locked: tile.locked,
			windowId: tile.item.windowId,
			answersFor: answersFor.length > 0 ? answersFor : undefined,
			order: tile.item.order,
			tile: tile.item,
		} );
	}

	// Icons last, and they merge rather than append: an icon whose
	// `window` names a tile already in the list is the same app seen
	// from the wallpaper. Games is the shipped case — it registers a
	// native window with a dock tile and a desktop icon under one id.
	for ( const entry of sources.icons ) {
		const target = entry.window
			? byId.get( entry.id ) ?? byId.get( entry.window )
			: byId.get( entry.id );
		if ( target ) {
			target.entry = entry;
			if ( entry.window ) {
				target.windowId = entry.window;
			}
			continue;
		}
		push( {
			id: entry.id,
			kind: 'app',
			title: entry.title,
			icon: entry.icon,
			windowId: entry.window || undefined,
			entry,
		} );
	}

	return items;
}
