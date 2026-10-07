import type { DockItem, SystemDockItem } from '../dock';
import type { DesktopIconServerEntry } from '../types';
import type { NavItem, NavKind } from './types';

export interface NavSystemTile {
	item: SystemDockItem;

	kind: Extract< NavKind, 'core' | 'app' | 'control' >;

	locked?: boolean;
}

export interface NavSources {

	menuItems: readonly DockItem[];

	systemTiles: readonly NavSystemTile[];

	icons: readonly DesktopIconServerEntry[];

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
			defaultPlacement: tile.item.defaultPlacement,
			windowId: tile.item.windowId,
			answersFor: answersFor.length > 0 ? answersFor : undefined,
			order: tile.item.order,
			tile: tile.item,
		} );
	}

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
