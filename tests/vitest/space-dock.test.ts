/**
 * The per-Space dock: the dock's admin menu follows the active
 * desktop's admin, harvested lazily on first entry and cached.
 */

import { describe, expect, test, vi } from 'vitest';
import { createSpaceDockController } from '../../src/multisite/space-dock';
import type { DockItem } from '../../src/dock';

const HOME = '/wp-admin/network/';
const SITE = '/site2/wp-admin/';

const item = ( title: string ): DockItem =>
	( { id: title.toLowerCase(), title, url: '', icon: '' } ) as unknown as DockItem;

/** Let a harvest's whole .then/.finally chain settle. */
const settle = () => new Promise( ( r ) => setTimeout( r, 0 ) );

const homeItems = [ item( 'Dashboard' ), item( 'Sites' ) ];
const siteItems = [ item( 'Dashboard' ), item( 'Posts' ) ];

/** A controllable harvest: resolve it by hand, per probe URL. */
function deferredHarvest() {
	const pending = new Map< string, ( items: DockItem[] | null ) => void >();
	const harvest = vi.fn(
		( url: string ) =>
			new Promise< DockItem[] | null >( ( resolve ) => {
				pending.set( url, resolve );
			} ),
	);
	const land = ( urlPart: string, items: DockItem[] | null ) => {
		for ( const [ url, resolve ] of pending ) {
			if ( url.includes( urlPart ) ) {
				resolve( items );
				pending.delete( url );
				return;
			}
		}
		throw new Error( `no pending harvest for ${ urlPart }` );
	};
	return { harvest, land };
}

function build( harvest: ( url: string ) => Promise< DockItem[] | null > ) {
	const applyDockItems = vi.fn();
	const controller = createSpaceDockController( {
		applyDockItems,
		getHomeDockItems: () => homeItems,
		homeScope: HOME,
		origin: 'http://example.test',
		harvest,
	} );
	return { controller, applyDockItems };
}

describe( 'the per-Space dock', () => {
	test( 'entering a Space harvests its menu once and paints it', async () => {
		const { harvest, land } = deferredHarvest();
		const { controller, applyDockItems } = build( harvest );

		controller.onSwitch( SITE );
		// Nothing cached yet: the previous dock stays until the probe
		// lands — never an empty dock.
		expect( applyDockItems ).not.toHaveBeenCalled();
		expect( harvest ).toHaveBeenCalledTimes( 1 );
		expect( harvest.mock.calls[ 0 ][ 0 ] ).toBe(
			'http://example.test/site2/wp-admin/admin.php?openstation_chromeless=1&openstation_menu_refresh=1',
		);

		land( '/site2/', siteItems );
		await settle();
		expect( applyDockItems ).toHaveBeenLastCalledWith( siteItems );

		// Back home restores the shell's own menu; back into the Space
		// is instant from cache — no second probe.
		controller.onSwitch( undefined );
		expect( applyDockItems ).toHaveBeenLastCalledWith( homeItems );
		controller.onSwitch( SITE );
		expect( applyDockItems ).toHaveBeenLastCalledWith( siteItems );
		expect( harvest ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a harvest that lands after the user left does not repaint', async () => {
		const { harvest, land } = deferredHarvest();
		const { controller, applyDockItems } = build( harvest );

		controller.onSwitch( SITE );
		controller.onSwitch( undefined ); // left before it landed
		applyDockItems.mockClear();

		land( '/site2/', siteItems );
		await settle();
		// Cached for next time, but the home dock is what is showing.
		expect( applyDockItems ).not.toHaveBeenCalled();
		controller.onSwitch( SITE );
		expect( applyDockItems ).toHaveBeenLastCalledWith( siteItems );
	} );

	test( 'a failed harvest leaves the dock alone and can retry', async () => {
		const { harvest, land } = deferredHarvest();
		const { controller, applyDockItems } = build( harvest );

		controller.onSwitch( SITE );
		land( '/site2/', null );
		await settle();
		expect( applyDockItems ).not.toHaveBeenCalled();

		// Not cached, so the next entry probes again.
		controller.onSwitch( undefined );
		controller.onSwitch( SITE );
		expect( harvest ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'a home refresh that lands inside a Space waits for the next switch home', async () => {
		const { harvest, land } = deferredHarvest();
		let home = homeItems;
		const applyDockItems = vi.fn();
		const controller = createSpaceDockController( {
			applyDockItems,
			getHomeDockItems: () => home,
			homeScope: HOME,
			origin: 'http://example.test',
			harvest,
		} );

		// At home, the shell's own live refresh paints straight away.
		controller.applyHomeDockItems( homeItems );
		expect( applyDockItems ).toHaveBeenLastCalledWith( homeItems );

		controller.onSwitch( SITE );
		land( '/site2/', siteItems );
		await settle();
		expect( applyDockItems ).toHaveBeenLastCalledWith( siteItems );

		// A home-admin window living on the Space (a plugins.php opened
		// there, or one restored with the session) emits its full
		// payload: the Space's menu must stay.
		const fresher = [ item( 'Dashboard' ), item( 'Sites' ), item( 'Shiny' ) ];
		home = fresher;
		applyDockItems.mockClear();
		controller.applyHomeDockItems( fresher );
		expect( applyDockItems ).not.toHaveBeenCalled();

		// Back home, the dock shows the fresh items, not the boot-time ones.
		controller.onSwitch( undefined );
		expect( applyDockItems ).toHaveBeenLastCalledWith( fresher );
	} );

	test( 'switching within the same admin is a no-op', () => {
		const { harvest } = deferredHarvest();
		const { controller, applyDockItems } = build( harvest );

		controller.onSwitch( undefined ); // home → home
		controller.onSwitch( HOME ); // an explicitly home-scoped desktop
		expect( applyDockItems ).not.toHaveBeenCalled();
		expect( harvest ).not.toHaveBeenCalled();
	} );
} );
