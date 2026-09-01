/**
 * Reading and writing the user's navigation preferences.
 *
 * Everything goes through the public `wp.os` shim rather than an
 * imported store, because the callers live in four different bundles
 * (the shell, the lazy context menu, the Preferences panel, the files
 * layer) and module state does not cross a bundle boundary. See
 * `docs/javascript-reference.md` → `createSharedStore` for the general
 * shape of that hazard.
 */

import { resolvePlacement, withRegion } from './defaults';
import { reorderZone } from './order';
import type { NavConfig, NavItem, NavPlacement } from './types';

interface NavSettingsShim {
	getNavItems?: () => NavItem[];
	getOsSettings?: () => {
		navPlacement?: Record< string, NavPlacement >;
		navOrder?: string[];
	};
	updateOsSettings?: (
		patch: {
			navPlacement?: Record< string, NavPlacement >;
			navOrder?: string[];
		},
		opts?: { windowId?: string },
	) => void;
}

function api(): NavSettingsShim | null {
	return (
		( window as unknown as { wp?: { os?: NavSettingsShim } } ).wp?.os ??
		null
	);
}

/** Current config, or empty defaults when the shell isn't up yet. */
export function readNavConfig(): NavConfig {
	const snapshot = api()?.getOsSettings?.();
	return {
		placement: snapshot?.navPlacement ?? {},
		order: snapshot?.navOrder ?? [],
	};
}

/** The shell's current nav items, or `[]` before it has booted. */
export function readNavItems(): NavItem[] {
	return api()?.getNavItems?.() ?? [];
}

/**
 * One nav item by id, or `null` when nothing registers it.
 *
 * Falls back to the id of the desktop icon behind the item, because a
 * caller working from the wallpaper knows the icon it clicked and an
 * icon whose `window` names a differently-id'd launcher was collapsed
 * onto that launcher's id.
 */
export function findNavItem( id: string ): NavItem | null {
	const items = readNavItems();
	return (
		items.find( ( item ) => item.id === id ) ??
		items.find( ( item ) => item.entry?.id === id ) ??
		null
	);
}

/**
 * Store placements for one or more items, in a single write.
 *
 * Locked items are refused here rather than only being hidden in the
 * UI, so no caller can write a value that would take a locked item
 * off the rail. `null` for an entry's placement means "leave it
 * alone", which is what lets {@link setRegion} skip an id it cannot
 * resolve.
 */
export function setPlacement(
	entries: ReadonlyArray< { item: NavItem; placement: NavPlacement } >,
): void {
	const shim = api();
	if ( ! shim?.getOsSettings || ! shim?.updateOsSettings ) {
		return;
	}
	const next = { ...( shim.getOsSettings().navPlacement ?? {} ) };
	let changed = false;
	for ( const { item, placement } of entries ) {
		if ( item.locked ) {
			continue;
		}
		next[ item.id ] = placement;
		changed = true;
	}
	if ( changed ) {
		shim.updateOsSettings( { navPlacement: next } );
	}
}

/**
 * Add or remove one region for some items, in a single write. Every
 * context-menu pick and every "Hide from …" is this call.
 *
 * Takes items or ids: the context menu holds the item it opened on,
 * the files layer holds the ids of a multi-selection. Ids that resolve
 * to nothing are skipped, because a caller working from DOM state may
 * name something no longer registered.
 */
export function setRegion(
	targets: ReadonlyArray< NavItem | string > | NavItem | string,
	region: 'rail' | 'desktop',
	on: boolean,
): void {
	const list = Array.isArray( targets ) ? targets : [ targets ];
	const placement = readNavConfig().placement;
	const entries: Array< { item: NavItem; placement: NavPlacement } > = [];
	for ( const target of list ) {
		const item =
			'string' === typeof target ? findNavItem( target ) : target;
		if ( ! item ) {
			continue;
		}
		entries.push( {
			item,
			placement: withRegion(
				resolvePlacement( item, placement ),
				region,
				on,
			),
		} );
	}
	setPlacement( entries );
}

/** Commit a drag: the zone's ids in their new order. */
export function persistZoneOrder( nextZoneIds: readonly string[] ): void {
	const shim = api();
	if ( ! shim?.getOsSettings || ! shim?.updateOsSettings ) {
		return;
	}
	const order = shim.getOsSettings().navOrder ?? [];
	shim.updateOsSettings( { navOrder: reorderZone( order, nextZoneIds ) } );
}
