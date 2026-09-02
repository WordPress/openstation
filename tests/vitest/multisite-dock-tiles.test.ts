/**
 * The Network Admin dock tile. Two decisions worth pinning: the rows
 * link OUT (a `SubmenuItem` with a bare `url` and no `onSelect` is what
 * the flyout opens in a browser tab), and the tile is not offered where
 * it would be a lie.
 */

import { describe, expect, test, vi } from 'vitest';
import { getNetworkAdminTileDef, NETWORK_ADMIN_TILE_ID } from '../../src/multisite/dock-tiles';
import { zoneForSystemTile } from '../../src/dock';
import type { MultisiteConfig } from '../../src/types';

const NETWORK = 'http://example.test/wp-admin/network/';

const config = ( over: Partial< MultisiteConfig > = {} ): MultisiteConfig => ( {
	isNetworkAdmin: false,
	networkAdmin: {
		url: NETWORK,
		rows: [ { title: 'Dashboard', url: NETWORK }, { title: 'Sites', url: NETWORK } ],
	},
	...over,
} );

describe( 'the Network Admin tile', () => {
	test( 'is absent without the capability, and inside the network admin', () => {
		// The server sends `networkAdmin: null`, not an empty row list.
		expect( getNetworkAdminTileDef( config( { networkAdmin: null } ) ) ).toBeNull();
		expect( getNetworkAdminTileDef( config( { isNetworkAdmin: true } ) ) ).toBeNull();
	} );

	test( 'sits with the admin menus, and leaves its position to computeNav', () => {
		// A tile that says nothing lands in the apps zone, on the
		// wallpaper — where this one first shipped.
		const tile = getNetworkAdminTileDef( config() );
		expect( tile?.id ).toBe( NETWORK_ADMIN_TILE_ID );
		expect( [ tile?.navKind, tile?.order, zoneForSystemTile( tile! ) ] ).toEqual( [
			'core',
			undefined,
			'core',
		] );
	} );

	test( 'mirrors the server rows, and everything links out', () => {
		const open = vi.spyOn( window, 'open' ).mockReturnValue( null );
		const tile = getNetworkAdminTileDef( config() );
		const rows = tile?.submenu ?? [];

		expect( rows.map( ( r ) => r.title ) ).toEqual( [ 'Dashboard', 'Sites' ] );
		// An `onSelect` here would take the tab the desktop is in.
		expect( rows.every( ( r ) => r.url && ! r.onSelect ) ).toBe( true );

		// The tile's own click is the keyboard and touch path.
		tile?.onOpen();
		expect( open ).toHaveBeenCalledWith( NETWORK, '_blank', 'noopener,noreferrer' );
		open.mockRestore();
	} );
} );
