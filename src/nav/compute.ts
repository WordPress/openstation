import { onDesktop, onRail, railFor, resolvePlacement, zoneFor } from './defaults';
import { applyOrder, sortByOrder } from './order';
import type { NavInput, NavItem, NavResult, NavZone } from './types';

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

	const railed = new Set< string >();

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

	for ( const item of items ) {
		for ( const id of item.answersFor ?? [] ) {
			if ( ! byWindow.has( id ) ) {
				byWindow.set( id, item );
			}
		}
	}

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

	const ordered = ( list: NavItem[] ) =>
		applyOrder( afterTheLeadMenu( sortByOrder( list ) ), config.order );
	for ( const zone of NAV_ZONES ) {
		dock[ zone ] = ordered( dock[ zone ] );
	}

	return {
		dock,
		sidebar: ordered( sidebar ),
		desktop: applyOrder( sortByOrder( desktop ), config.order ),
		ephemeral,
	};
}

function afterTheLeadMenu( items: NavItem[] ): NavItem[] {
	const tiles = items.filter( ( item ) => 'core' === item.kind && item.tile );
	const menus = items.filter( ( item ) => ! tiles.includes( item ) );
	return 0 === tiles.length || 0 === menus.length
		? items
		: [ menus[ 0 ], ...tiles, ...menus.slice( 1 ) ];
}
