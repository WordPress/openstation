import type { SystemDockItem } from '../dock';
import type { MultisiteConfig } from '../types';
import { __ } from '../i18n';

export const NETWORK_ADMIN_TILE_ID = 'os-network-admin';

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

		navKind: 'core',

		onOpen: ( event? ) => openOtherAdmin( network.url, event ),
		get submenu() {
			return network.rows.map( ( { title, url } ) => ( {
				title,
				url,
				onSelect: ( event?: MouseEvent ) =>
					openOtherAdmin( url, event ),
			} ) );
		},
	};
}
