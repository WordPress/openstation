import { describe, expect, test, vi } from 'vitest';
import { getNetworkAdminTileDef, NETWORK_ADMIN_TILE_ID } from '../../src/multisite/dock-tiles';
import { zoneForSystemTile } from '../../src/dock';
import type { MultisiteConfig } from '../../src/types';

const NETWORK = 'http://example.test/wp-admin/network/';
const SITES = 'http://example.test/wp-admin/network/sites.php';

const config = ( over: Partial< MultisiteConfig > = {} ): MultisiteConfig => ( {
	isNetworkAdmin: false,
	networkAdmin: {
		url: NETWORK,
		shellUrl: NETWORK + 'admin.php?page=openstation',
		rows: [ { title: 'Dashboard', url: NETWORK }, { title: 'Sites', url: SITES } ],
	},
	current: '1',
	sites: [],
	...over,
} );

describe( 'the Network Admin tile', () => {
	test( 'is absent without the capability, and inside the network admin', () => {
		const opener = vi.fn();

		expect(
			getNetworkAdminTileDef( config( { networkAdmin: null } ), opener ),
		).toBeNull();
		expect(
			getNetworkAdminTileDef( config( { isNetworkAdmin: true } ), opener ),
		).toBeNull();
	} );

	test( 'sits with the admin menus, and leaves its position to computeNav', () => {

		const tile = getNetworkAdminTileDef( config(), vi.fn() );
		expect( tile?.id ).toBe( NETWORK_ADMIN_TILE_ID );
		expect( [ tile?.navKind, tile?.order, zoneForSystemTile( tile! ) ] ).toEqual( [
			'core',
			undefined,
			'core',
		] );
	} );

	test( 'the tile and every row route through the opener, event and all', () => {
		const opener = vi.fn();
		const tile = getNetworkAdminTileDef( config(), opener );
		const rows = tile?.submenu ?? [];

		expect( rows.map( ( r ) => r.title ) ).toEqual( [ 'Dashboard', 'Sites' ] );

		expect( rows.every( ( r ) => r.url && r.onSelect ) ).toBe( true );

		tile?.onOpen();
		const modified = new MouseEvent( 'click', { metaKey: true } );
		rows[ 1 ].onSelect?.( modified );

		expect( opener.mock.calls ).toEqual( [
			[ NETWORK, undefined ],
			[ SITES, modified ],
		] );
	} );
} );
