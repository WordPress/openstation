/**
 * `computeNav` — the navigation spec, as one pure function.
 *
 * Every rail and the wallpaper render exactly what this returns. No
 * surface resolves a placement, consults the layout, or decides
 * whether a running app deserves a tile; they paint a list. That is
 * what makes the rules testable as a table and impossible for two
 * surfaces to answer differently.
 */

import { onDesktop, onRail, railFor, resolvePlacement, zoneFor } from './defaults';
import { applyOrder, sortByOrder } from './order';
import type { NavInput, NavItem, NavResult, NavZone } from './types';

/** Zones in paint order, which is also divider order. */
export const NAV_ZONES: readonly NavZone[] = [
	'core',
	'apps',
	'controls',
] as const;

export function computeNav( input: NavInput ): NavResult {
	const { items, config, layout, openWindows } = input;

	const dock: Record< NavZone, NavItem[] > = {
		core: [],
		apps: [],
		controls: [],
	};
	const sidebar: NavItem[] = [];
	const desktop: NavItem[] = [];
	const ephemeral = new Set< string >();
	// Ids already on a rail, so the running pass below can tell an app
	// that has somewhere to minimize into from one that does not.
	const railed = new Set< string >();
	// Which item answers for a window. First registration wins; an app
	// registered twice has already been collapsed into one item by
	// `buildNavItems`.
	const byWindow = new Map< string, NavItem >();
	const known = new Set< string >();

	for ( const item of items ) {
		known.add( item.id );
		if ( item.windowId && ! byWindow.has( item.windowId ) ) {
			byWindow.set( item.windowId, item );
		}
		const placement = resolvePlacement( item, config.placement );
		if ( onRail( placement ) ) {
			railed.add( item.id );
			const zone = zoneFor( item.kind );
			if ( 'sidebar' === railFor( item.kind, layout ) ) {
				sidebar.push( item );
			} else {
				dock[ zone ].push( item );
			}
		}
		if ( onDesktop( placement ) ) {
			desktop.push( item );
		}
	}

	// A tile with a submenu answers for whatever its rows open, but
	// only where nothing opens that window directly — a launcher of its
	// own always wins over standing in for one.
	for ( const item of items ) {
		for ( const id of item.answersFor ?? [] ) {
			if ( ! byWindow.has( id ) ) {
				byWindow.set( id, item );
			}
		}
	}

	// Every open window has a tile.
	//
	// Sending Games to the wallpaper says where its launcher lives, not
	// that its open window should be unswitchable with nowhere to
	// minimize back to while every other window has a tile. Same for a
	// window nothing launches from a rail at all. These land in the
	// apps zone — the dock, never the sidebar, even for a core menu in
	// the split layout: the sidebar is a menu, not a taskbar.
	for ( const win of openWindows ) {
		const item = byWindow.get( win.id );
		if ( item ) {
			if ( railed.has( item.id ) || ephemeral.has( item.id ) ) {
				continue;
			}
			dock.apps.push( item );
			ephemeral.add( item.id );
			continue;
		}
		// An admin page is reachable through the menu it belongs to,
		// whose tile lights up for its children — so it gets no tile
		// of its own even when nothing here claims it. `known` guards
		// the other direction: an item that exists but declares no
		// window must not be shadowed by a synthetic twin of its id.
		if (
			win.fromAdminUrl ||
			ephemeral.has( win.id ) ||
			known.has( win.id )
		) {
			continue;
		}
		dock.apps.push( {
			id: win.id,
			kind: 'app',
			title: win.title,
			icon: win.icon,
			windowId: win.id,
			transient: true,
		} );
		ephemeral.add( win.id );
	}

	for ( const zone of NAV_ZONES ) {
		dock[ zone ] = applyOrder( sortByOrder( dock[ zone ] ), config.order );
	}

	return {
		dock,
		sidebar: applyOrder( sortByOrder( sidebar ), config.order ),
		desktop: applyOrder( sortByOrder( desktop ), config.order ),
		ephemeral,
	};
}
