/**
 * The Network Admin dock tile: the admin bar's Network Admin node, on
 * the dock. Every activation switches to the network admin's **own
 * shell** — on a network every site is its own OpenStation — through
 * the injected opener, the same hop every cross-admin link takes
 * (`src/multisite/hop.ts`), which also honours the side-by-side
 * gesture: a modifier or middle click opens it in a browser tab. See
 * docs/multisite.md.
 */

import type { SystemDockItem } from '../dock';
import type { MultisiteConfig } from '../types';
import { __ } from '../i18n';

export const NETWORK_ADMIN_TILE_ID = 'os-network-admin';

/** Null inside the network admin, where the dock already IS this menu. */
export function getNetworkAdminTileDef(
	multisite: MultisiteConfig,
	openOtherAdmin: ( url: string, event?: MouseEvent ) => void,
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
		// does what its first row does: the network dashboard, in the
		// network's Space.
		onOpen: ( event? ) => openOtherAdmin( network.url, event ),
		get submenu() {
			// `url` stays on the row so surfaces that describe rows can
			// keep doing so; the click routes through `onSelect`, which
			// is what sends the row into the Space rather than the
			// generic bare-url link-out.
			return network.rows.map( ( { title, url } ) => ( {
				title,
				url,
				onSelect: ( event?: MouseEvent ) =>
					openOtherAdmin( url, event ),
			} ) );
		},
	};
}
