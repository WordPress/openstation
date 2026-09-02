/**
 * The Network Admin dock tile. Two decisions worth pinning: every
 * activation HOPS — navigates this tab to the network admin's shell,
 * with a modifier click keeping the browser-tab behavior — and the
 * tile is not offered where it would be a lie.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getNetworkAdminTileDef, NETWORK_ADMIN_TILE_ID } from '../../src/multisite/dock-tiles';
import { zoneForSystemTile } from '../../src/dock';
import type { MultisiteConfig } from '../../src/types';

const NETWORK = 'http://example.test/wp-admin/network/';
const SITES = 'http://example.test/wp-admin/network/sites.php';

const config = ( over: Partial< MultisiteConfig > = {} ): MultisiteConfig => ( {
	isNetworkAdmin: false,
	networkAdmin: {
		url: NETWORK,
		rows: [ { title: 'Dashboard', url: NETWORK }, { title: 'Sites', url: SITES } ],
	},
	...over,
} );

const realLocation = window.location;
let assign: ReturnType< typeof vi.fn >;

beforeEach( () => {
	assign = vi.fn();
	Object.defineProperty( window, 'location', {
		value: { ...realLocation, assign },
		configurable: true,
	} );
} );

afterEach( () => {
	Object.defineProperty( window, 'location', {
		value: realLocation,
		configurable: true,
	} );
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

	test( 'the tile and every row hop this tab to the network admin', () => {
		const tile = getNetworkAdminTileDef( config() );
		const rows = tile?.submenu ?? [];

		expect( rows.map( ( r ) => r.title ) ).toEqual( [ 'Dashboard', 'Sites' ] );
		// `url` stays for surfaces that describe the row; the click
		// routes through `onSelect`, which is the hop.
		expect( rows.every( ( r ) => r.url && r.onSelect ) ).toBe( true );

		// The tile's own click is the keyboard and touch path.
		tile?.onOpen();
		rows[ 1 ].onSelect?.();
		expect( assign.mock.calls ).toEqual( [ [ NETWORK ], [ SITES ] ] );
	} );

	test( 'a modifier click keeps the browser-tab behavior', () => {
		const open = vi.spyOn( window, 'open' ).mockReturnValue( null );
		const tile = getNetworkAdminTileDef( config() );

		try {
			tile?.onOpen( new MouseEvent( 'click', { metaKey: true } ) );
			tile?.submenu?.[ 1 ].onSelect?.(
				new MouseEvent( 'click', { ctrlKey: true } ),
			);
			expect( open.mock.calls ).toEqual( [
				[ NETWORK, '_blank', 'noopener,noreferrer' ],
				[ SITES, '_blank', 'noopener,noreferrer' ],
			] );
			expect( assign ).not.toHaveBeenCalled();
		} finally {
			open.mockRestore();
		}
	} );
} );
