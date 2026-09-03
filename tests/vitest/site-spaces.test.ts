/**
 * Site Spaces: the opener that puts another admin on its own desktop,
 * and the payload guard that keeps that admin's menu off this dock.
 */

import { describe, expect, test, vi, afterEach } from 'vitest';
import { createSpaceOpener, labelForScope } from '../../src/multisite/spaces';
import type { SpacesManager } from '../../src/multisite/spaces';
import {
	bindMenuRefresh,
	frameSourceIsOtherAdmin,
} from '../../src/boot/menu-refresh';
import { INITIAL_ORIGIN } from '../../src/boot/origin';
import type { DesktopConfig } from '../../src/types';

const ADMIN = 'http://example.test/wp-admin/network/';

/** A minimal manager with one unscoped desktop active. */
function fakeManager(): SpacesManager & {
	desktops: Array< { id: string; label: string; scope?: string } >;
	active: string;
	switched: Array< [ string, { direction?: string } | undefined ] >;
	opened: Array< Record< string, unknown > >;
} {
	const state = {
		desktops: [ { id: 'desktop-1', label: 'Desktop 1' } ] as Array< {
			id: string;
			label: string;
			scope?: string;
		} >,
		active: 'desktop-1',
		switched: [] as Array< [ string, { direction?: string } | undefined ] >,
		opened: [] as Array< Record< string, unknown > >,
		getDesktops: () => state.desktops,
		getActiveDesktopId: () => state.active,
		getPrimaryDesktopId: () => 'desktop-1',
		switchDesktop: (
			id: string,
			opts?: { direction?: 'next' | 'prev' },
		) => {
			state.switched.push( [ id, opts ] );
			state.active = id;
		},
		createDesktop: ( init?: { label?: string; scope?: string } ) => {
			const desktop = {
				id: `desktop-${ state.desktops.length + 1 }`,
				label: init?.label ?? 'Desktop',
				...( init?.scope ? { scope: init.scope } : {} ),
			};
			state.desktops.push( desktop );
			return desktop;
		},
		open: ( config: Record< string, unknown > ) => {
			state.opened.push( config );
		},
	};
	return state;
}

afterEach( () => {
	vi.restoreAllMocks();
} );

describe( 'createSpaceOpener', () => {
	test( 'creates the Space, slides to it, and opens the window there', () => {
		const manager = fakeManager();
		const open = createSpaceOpener( { manager, adminUrl: ADMIN } );

		open( 'http://example.test/site2/wp-admin/index.php' );

		expect( manager.desktops[ 1 ] ).toMatchObject( {
			label: 'site2',
			scope: '/site2/wp-admin/',
		} );
		expect( manager.switched ).toEqual( [
			[ manager.desktops[ 1 ].id, { direction: 'next' } ],
		] );
		expect( manager.opened ).toHaveLength( 1 );
		expect( manager.opened[ 0 ] ).toMatchObject( {
			url: 'http://example.test/site2/wp-admin/index.php',
		} );
	} );

	test( 'one Space per admin — a second click reuses it', () => {
		const manager = fakeManager();
		const open = createSpaceOpener( { manager, adminUrl: ADMIN } );

		open( 'http://example.test/site2/wp-admin/index.php' );
		manager.active = 'desktop-1';
		open( 'http://example.test/site2/wp-admin/edit.php' );

		expect( manager.desktops ).toHaveLength( 2 );
		expect( manager.switched ).toHaveLength( 2 );
		expect( manager.opened ).toHaveLength( 2 );
	} );

	test( 'a target in the shell\'s own admin opens on the spot', () => {
		const manager = fakeManager();
		const open = createSpaceOpener( { manager, adminUrl: ADMIN } );

		open( 'http://example.test/wp-admin/network/sites.php' );

		expect( manager.desktops ).toHaveLength( 1 );
		expect( manager.switched ).toHaveLength( 0 );
		expect( manager.opened ).toHaveLength( 1 );
	} );

	test( 'from inside a Space, a target in the shell\'s own admin goes home first', () => {
		// The home admin's desktop is the primary one, never a Space:
		// the main site's Dashboard row clicked from the network Sites
		// window, seen from the main site's own shell, must not land
		// the home admin's window on the Network Admin Space.
		const manager = fakeManager();
		const open = createSpaceOpener( { manager, adminUrl: ADMIN } );

		open( 'http://example.test/site2/wp-admin/index.php' ); // into a Space
		manager.switched.length = 0;
		open( 'http://example.test/wp-admin/network/index.php' ); // home admin

		expect( manager.desktops ).toHaveLength( 2 );
		expect( manager.switched ).toEqual( [ [ 'desktop-1', { direction: 'prev' } ] ] );
		expect( manager.active ).toBe( 'desktop-1' );
		expect( manager.opened ).toHaveLength( 2 );
	} );

	test( 'cross-origin admins and modifier clicks get a browser tab', () => {
		const tab = vi.spyOn( window, 'open' ).mockReturnValue( null );
		const manager = fakeManager();
		const open = createSpaceOpener( { manager, adminUrl: ADMIN } );

		// The network admin seen from a subdomain site: another origin,
		// cannot be framed, cannot be a Space.
		open( 'https://network.example.test/wp-admin/network/' );
		// The side-by-side gesture, on an otherwise Space-able target.
		open(
			'http://example.test/site2/wp-admin/',
			new MouseEvent( 'click', { metaKey: true } ),
		);

		expect( tab ).toHaveBeenCalledTimes( 2 );
		expect( manager.desktops ).toHaveLength( 1 );
		expect( manager.opened ).toHaveLength( 0 );
	} );
} );

describe( 'labelForScope', () => {
	test.each( [
		[ '/wp-admin/network/', 'Network Admin' ],
		[ '/wp-admin/user/', 'User Admin' ],
		[ '/site2/wp-admin/', 'site2' ],
		[ '/blogs/marketing/wp-admin/', 'marketing' ],
		[ '/wp-admin/', 'Main site' ],
	] )( '%s → %s', ( scope, label ) => {
		expect( labelForScope( scope ) ).toBe( label );
	} );
} );

describe( 'bindMenuRefresh', () => {
	test( 'routes a payload\'s dock items through the injected applier', () => {
		// The shell hands in the per-Space dock controller here, so a
		// home payload cannot overwrite a Space's menu — see
		// `applyHomeDockItems()` in `src/multisite/space-dock.ts`.
		const applyDockItems = vi.fn();
		const noop = vi.fn( async () => {} );
		bindMenuRefresh( {
			layoutDispatcher: null,
			applyDockItems,
			desktopArea: document.createElement( 'div' ),
			config: {
				adminUrl: 'http://example.test/wp-admin/',
			} as unknown as DesktopConfig,
			syncNativeWindows: noop,
			syncServerWidgets: noop,
			syncServerWallpapers: noop,
			syncServerCommands: noop,
			syncServerSettingsTabs: noop,
			syncServerTitleBarButtons: noop,
			syncServerWindowActions: noop,
			syncServerUnfocusEffects: noop,
			syncServerWindowLinkRenderers: noop,
			syncServerDockRailRenderers: noop,
			syncServerGames: noop,
			renderIcons: vi.fn(),
		} );

		const dockItems = [
			{
				id: 'menu-posts',
				title: 'Posts',
				url: 'http://example.test/wp-admin/edit.php',
				icon: '',
			},
		];
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: INITIAL_ORIGIN,
				data: { type: 'os-plugins-changed', payload: { dockItems } },
			} ),
		);

		expect( applyDockItems ).toHaveBeenCalledWith( dockItems );
	} );
} );

describe( 'frameSourceIsOtherAdmin', () => {
	const ORIGIN = 'http://example.test';

	test( 'flags a frame mounted on another admin, and only that', () => {
		document.body.innerHTML =
			'<iframe src="/site2/wp-admin/index.php?openstation_chromeless=1"></iframe>' +
			'<iframe src="/wp-admin/network/plugins.php?openstation_chromeless=1"></iframe>';
		const [ foreign, own ] = Array.from(
			document.querySelectorAll( 'iframe' ),
		);

		expect(
			frameSourceIsOtherAdmin(
				foreign.contentWindow,
				'/wp-admin/network/',
				ORIGIN,
			),
		).toBe( true );
		expect(
			frameSourceIsOtherAdmin(
				own.contentWindow,
				'/wp-admin/network/',
				ORIGIN,
			),
		).toBe( false );
		// Not one of our iframes at all — keeps its pre-Spaces
		// treatment.
		expect(
			frameSourceIsOtherAdmin( window, '/wp-admin/network/', ORIGIN ),
		).toBe( false );
		document.body.innerHTML = '';
	} );
} );
