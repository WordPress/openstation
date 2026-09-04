/**
 * Tests for the phone layer's navigation rules —
 * `src/mobile/home.ts` and `src/mobile/tab-bar.ts`.
 *
 * Pins:
 * - the home grid folds every desktop surface in, deduplicated,
 *   without the ephemeral entries and without anything a tap cannot
 *   open;
 * - the search filter is a case-insensitive title match;
 * - the tab bar honours the pins in order, skips the locked exit and
 *   the missing, and fills from the navigation's own order;
 * - the rendered surfaces carry the roles and the `aria-current`.
 */
import { describe, expect, test, vi } from 'vitest';
import type { NavItem, NavResult } from '../../src/nav/types';
import { createHome, filterByQuery, homeGridItems, isOpenable } from '../../src/mobile/home';
import { createTabBar, navItemWindowId, resolveTabBarItems } from '../../src/mobile/tab-bar';

const ADMIN = 'https://example.test/wp-admin/';

function item( id: string, extra: Partial< NavItem > = {} ): NavItem {
	return {
		id,
		kind: 'core',
		title: id,
		icon: 'dashicons-admin-generic',
		menu: { id, title: id, icon: 'dashicons-admin-generic', url: `${ ADMIN }${ id }`, badge: 0, submenu: [] },
		...extra,
	} as NavItem;
}

function nav( over: Partial< NavResult > = {} ): NavResult {
	return {
		dock: { core: [], apps: [], controls: [] },
		sidebar: [],
		desktop: [],
		ephemeral: new Set(),
		...over,
	};
}

const renderIcon = ( _icon: string, opts: { title: string; className?: string } ): HTMLElement => {
	const s = document.createElement( 'span' );
	s.className = opts.className ?? '';
	s.textContent = '•';
	return s;
};

describe( 'homeGridItems', () => {
	test( 'folds core, sidebar, apps and desktop in order, deduplicated', () => {
		const posts = item( 'edit.php' );
		const media = item( 'upload.php' );
		const woo = item( 'woocommerce', { kind: 'plugin' } );
		const exit = item( 'os-exit', { kind: 'control', locked: true, menu: undefined, tile: { onOpen: () => undefined } as never } );
		const { apps, system } = homeGridItems(
			nav( {
				dock: { core: [ posts ], apps: [ woo, posts ], controls: [ exit ] },
				sidebar: [ media ],
				desktop: [ woo ],
			} ),
		);
		expect( apps.map( ( i ) => i.id ) ).toEqual( [ 'edit.php', 'upload.php', 'woocommerce' ] );
		expect( system.map( ( i ) => i.id ) ).toEqual( [ 'os-exit' ] );
	} );

	test( 'leaves out ephemeral entries and dead tiles', () => {
		const running = item( 'wp-window-x', { menu: undefined, windowId: 'wp-window-x' } );
		const dead = item( 'dead', { menu: undefined } );
		const { apps } = homeGridItems(
			nav( { dock: { core: [ dead ], apps: [ running ], controls: [] }, ephemeral: new Set( [ 'wp-window-x' ] ) } ),
		);
		expect( apps ).toEqual( [] );
		expect( isOpenable( dead ) ).toBe( false );
		expect( isOpenable( item( 'tile', { menu: undefined, tile: { onOpen: () => undefined } as never } ) ) ).toBe( true );
	} );

	test( 'a null nav is an empty grid', () => {
		expect( homeGridItems( null ) ).toEqual( { apps: [], system: [] } );
	} );
} );

describe( 'filterByQuery', () => {
	test( 'matches titles case-insensitively; empty query keeps all', () => {
		const items = [ item( 'a', { title: 'Posts' } ), item( 'b', { title: 'Comments' } ) ];
		expect( filterByQuery( items, '' ).length ).toBe( 2 );
		expect( filterByQuery( items, 'POST' ).map( ( i ) => i.id ) ).toEqual( [ 'a' ] );
		expect( filterByQuery( items, 'zzz' ) ).toEqual( [] );
	} );
} );

describe( 'resolveTabBarItems', () => {
	const posts = item( 'edit.php' );
	const media = item( 'upload.php' );
	const comments = item( 'edit-comments.php' );
	const pages = item( 'edit.php?post_type=page' );
	const exit = item( 'os-exit', { locked: true } );

	test( 'a resolved pin is the whole answer — no filling around it', () => {
		const out = resolveTabBarItems(
			nav( { dock: { core: [ posts, media, comments, pages ], apps: [], controls: [ exit ] } } ),
			[ 'edit-comments.php', 'missing', 'os-exit' ],
		);
		expect( out.map( ( i ) => i.id ) ).toEqual( [ 'edit-comments.php' ] );
		expect(
			resolveTabBarItems(
				nav( { dock: { core: [ posts, media, comments, pages ], apps: [], controls: [] } } ),
				[ 'upload.php', 'edit.php', 'edit-comments.php', 'edit.php?post_type=page' ],
			).map( ( i ) => i.id ),
		).toEqual( [ 'upload.php', 'edit.php', 'edit-comments.php' ] );
	} );

	test( 'with no pin at all, the navigation order fills the bar, capped, skipping ephemeral ids', () => {
		const out = resolveTabBarItems(
			nav( { dock: { core: [ posts, media, comments, pages ], apps: [], controls: [] }, ephemeral: new Set( [ 'edit.php' ] ) } ),
			[],
			2,
		);
		expect( out.map( ( i ) => i.id ) ).toEqual( [ 'upload.php', 'edit-comments.php' ] );
		expect( resolveTabBarItems( null, [ 'edit.php' ] ) ).toEqual( [] );
	} );

	test( 'navItemWindowId derives the same id a dock click would', () => {
		expect( navItemWindowId( item( 'x', { windowId: 'native-x' } ), ADMIN ) ).toBe( 'native-x' );
		expect( navItemWindowId( posts, ADMIN ) ).toMatch( /edit/ );
		expect( navItemWindowId( item( 'tile', { menu: undefined } ), ADMIN ) ).toBeNull();
	} );
} );

describe( 'createHome (DOM)', () => {
	test( 'renders sections as lists and opens on tap', () => {
		const host = document.createElement( 'div' );
		const onOpen = vi.fn();
		const home = createHome( host, { renderIcon, getBadge: ( i ) => ( i.id === 'edit.php' ? 3 : 0 ), onOpen } );
		home.render( nav( { dock: { core: [ item( 'edit.php', { title: 'Posts' } ) ], apps: [], controls: [ item( 'os-exit', { title: 'Exit' } ) ] } } ) );

		expect( home.el.getAttribute( 'role' ) ).toBe( 'region' );
		const lists = host.querySelectorAll( '[role="list"]' );
		expect( lists.length ).toBe( 2 );
		const tile = host.querySelector< HTMLButtonElement >( '.os-mobile-tile[data-nav-id="edit.php"]' );
		expect( tile ).not.toBeNull();
		expect( tile?.querySelector( '.os-mobile-tile__badge' )?.textContent ).toBe( '3' );
		expect( tile?.getAttribute( 'aria-label' ) ).toBe( 'Posts, 3' );
		tile?.click();
		expect( onOpen ).toHaveBeenCalledWith( expect.objectContaining( { id: 'edit.php' } ) );

		home.setHidden( true );
		expect( home.el.hidden ).toBe( true );
	} );

	test( "paints a tile's rail art in place of its icon, and the icon when there is none", () => {
		const host = document.createElement( 'div' );
		const painted: string[] = [];
		const home = createHome( host, {
			renderIcon: ( icon, opts ) => {
				painted.push( icon );
				return renderIcon( icon, opts );
			},
			getBadge: () => 0,
			getArt: ( i ) => ( i.id === 'desktop-mode-recycle-bin' ? 'data:image/svg+xml;base64,FULL' : '' ),
			onOpen: () => undefined,
		} );
		home.render( nav( {
			dock: {
				core: [ item( 'edit.php', { icon: 'dashicons-admin-post' } ) ],
				apps: [ item( 'desktop-mode-recycle-bin', { icon: 'data:image/svg+xml;base64,EMPTY' } ) ],
				controls: [],
			},
		} ) );
		expect( painted ).toEqual( [ 'dashicons-admin-post', 'data:image/svg+xml;base64,FULL' ] );
	} );
} );

describe( 'createTabBar (DOM)', () => {
	test( 'Home, pins, switcher — with aria-current following the state', () => {
		const host = document.createElement( 'div' );
		const onHome = vi.fn();
		const onSwitcher = vi.fn();
		const onOpen = vi.fn();
		const bar = createTabBar( host, { renderIcon, getBadge: () => 0, onHome, onSwitcher, onOpen } );
		bar.render( [ item( 'edit.php', { title: 'Posts' } ) ], { active: 'home', openCount: 0 } );

		const buttons = Array.from( host.querySelectorAll< HTMLButtonElement >( '.os-mobile-tabs__item' ) );
		expect( buttons.map( ( b ) => b.dataset.tab ) ).toEqual( [ 'home', 'edit.php', 'switcher' ] );
		expect( buttons[ 0 ].getAttribute( 'aria-current' ) ).toBe( 'page' );
		expect( host.querySelector( 'nav' )?.getAttribute( 'aria-label' ) ).toBe( 'Primary' );

		bar.setState( { active: 'edit.php', openCount: 2 } );
		expect( buttons[ 0 ].hasAttribute( 'aria-current' ) ).toBe( false );
		expect( buttons[ 1 ].getAttribute( 'aria-current' ) ).toBe( 'page' );
		expect( host.querySelector( '.os-mobile-tabs__count' )?.textContent ).toBe( '2' );
		expect( buttons[ 2 ].getAttribute( 'aria-label' ) ).toBe( 'Open apps (2)' );

		buttons[ 1 ].click();
		expect( onOpen ).toHaveBeenCalledWith( expect.objectContaining( { id: 'edit.php' } ) );
		buttons[ 0 ].click();
		expect( onHome ).toHaveBeenCalledTimes( 1 );
		buttons[ 2 ].click();
		expect( onSwitcher ).toHaveBeenCalledTimes( 1 );
	} );
} );
