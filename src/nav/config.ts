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

/**
 * Store an item's placement. Locked items are refused here rather
 * than only being hidden in the UI, so no caller can write a value
 * that would take Exit OpenStation off the rail.
 */
export function setPlacement( item: NavItem, placement: NavPlacement ): void {
	const shim = api();
	if ( item.locked || ! shim?.getOsSettings || ! shim?.updateOsSettings ) {
		return;
	}
	const next = { ...( shim.getOsSettings().navPlacement ?? {} ) };
	next[ item.id ] = placement;
	shim.updateOsSettings( { navPlacement: next } );
}

/**
 * Add or remove one region for an item — every context-menu pick and
 * every "Hide from …" is this call.
 */
export function setRegion(
	item: NavItem,
	region: 'rail' | 'desktop',
	on: boolean,
): void {
	const current = resolvePlacement( item, readNavConfig().placement );
	setPlacement( item, withRegion( current, region, on ) );
}

/** Store several placements in one write, for a multi-selection. */
export function setPlacements(
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
 * Add or remove one region for several ids at once, in a single
 * settings write. Unknown ids are skipped — the caller is working from
 * DOM state that may name something no longer registered.
 */
export function setRegionByIds(
	ids: readonly string[],
	region: 'rail' | 'desktop',
	on: boolean,
): void {
	const placement = readNavConfig().placement;
	const entries: Array< { item: NavItem; placement: NavPlacement } > = [];
	for ( const id of ids ) {
		const item = findNavItem( id );
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
	setPlacements( entries );
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
