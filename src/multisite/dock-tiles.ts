/**
 * The Network Admin dock tile: the admin bar's Network Admin node, on
 * the dock. Every row HOPS — navigates this tab to the network admin's
 * own shell — rather than opening a window: the network admin is on
 * another domain and WordPress refuses to be framed cross-origin. The
 * desktop being left behind is safe to leave: every admin keeps its own
 * desktop under its own session key, so the hop restores each side
 * exactly as it was, and a modifier click still opens the browser tab
 * for standing the two desktops side by side. See docs/multisite.md.
 */

import type { SystemDockItem } from '../dock';
import type { MultisiteConfig } from '../types';
import { __ } from '../i18n';
import { hopToAdmin } from './hop';

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
		// does what its first row does: hop to the network dashboard.
		onOpen: ( event? ) => hopToAdmin( network.url, event ),
		get submenu() {
			// `url` stays on the row so surfaces that describe rows can
			// keep doing so; the click routes through `onSelect`, which
			// is what makes the row a hop rather than the generic
			// bare-url link-out.
			return network.rows.map( ( { title, url } ) => ( {
				title,
				url,
				onSelect: ( event?: MouseEvent ) => hopToAdmin( url, event ),
			} ) );
		},
	};
}
