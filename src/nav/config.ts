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

export function readNavConfig(): NavConfig {
	const snapshot = api()?.getOsSettings?.();
	return {
		placement: snapshot?.navPlacement ?? {},
		order: snapshot?.navOrder ?? [],
	};
}

export function readNavItems(): NavItem[] {
	return api()?.getNavItems?.() ?? [];
}

export function findNavItem( id: string ): NavItem | null {
	const items = readNavItems();
	return (
		items.find( ( item ) => item.id === id ) ??
		items.find( ( item ) => item.entry?.id === id ) ??
		null
	);
}

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

export function persistZoneOrder( nextZoneIds: readonly string[] ): void {
	const shim = api();
	if ( ! shim?.getOsSettings || ! shim?.updateOsSettings ) {
		return;
	}
	const order = shim.getOsSettings().navOrder ?? [];
	shim.updateOsSettings( { navOrder: reorderZone( order, nextZoneIds ) } );
}
