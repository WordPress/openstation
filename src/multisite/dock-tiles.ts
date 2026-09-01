/**
 * The Network Admin dock tile: the admin bar's Network Admin node, on
 * the dock. Every row opens a BROWSER TAB — not a window, since the
 * network admin is on another domain and WordPress refuses to be framed
 * cross-origin, and not this tab, since the user has windows open here.
 * See docs/multisite.md.
 */

import type { SystemDockItem } from '../dock';
import type { MultisiteConfig } from '../types';
import { __ } from '../i18n';

export const NETWORK_ADMIN_TILE_ID = 'os-network-admin';

/** Null inside the network admin, where the dock already IS this menu. */
export function getNetworkAdminTileDef(
	multisite: MultisiteConfig,
): SystemDockItem | null {
	const network = multisite.networkAdmin;
	if ( ! network || multisite.isNetworkAdmin ) {
		return null;
	}

	return {
		id: NETWORK_ADMIN_TILE_ID,
		title: __( 'Network Admin' ),
		icon: 'dashicons-admin-multisite',
		placeable: true,
		// It IS an admin menu, one that cannot arrive through `$menu`
		// because it lives on another domain, so it paints with them.
		// `computeNav` decides where in that run it lands.
		navKind: 'core',
		// Keyboards and touch never fan the flyout out, so the tile
		// does what its first row does. A bare `url` with no `onSelect`
		// is what the flyout links out.
		onOpen: () => window.open( network.url, '_blank', 'noopener,noreferrer' ),
		get submenu() {
			return network.rows.map( ( { title, url } ) => ( { title, url } ) );
		},
	};
}
