/**
 * Tests for `src/mobile/layer.ts` — the phone layer over a fake
 * window manager.
 *
 * Pins the state derivation (home ⇔ nothing un-minimized), the
 * surfaces' visibility per state, the switcher's cards (open windows
 * most-recent-first, then recents), Back as minimize, the ⋯ menu,
 * and a clean unmount.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HOOKS, doAction } from '../../src/hooks';
import { mountMobileLayer } from '../../src/mobile/layer';
import type { MobileLayerDeps } from '../../src/mobile/types';
import type { OsModeApi } from '../../src/mode';
import type { NavItem, NavResult } from '../../src/nav/types';
import type { SessionWindow } from '../../src/types';
import type { WindowManager } from '../../src/window-manager';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const ADMIN = 'https://example.test/wp-admin/';

interface FakeWin {
	id: string;
	config: { baseId?: string; title: string; icon: string; native?: boolean; desktopId?: string };
	element: HTMLElement;
	minimized: boolean;
	isMinimized: () => boolean;
	minimize: ReturnType< typeof vi.fn >;
	restore: ReturnType< typeof vi.fn >;
	close: ReturnType< typeof vi.fn >;
	reload: ReturnType< typeof vi.fn >;
	getCurrentUrl: () => string;
}

function fakeWin( id: string, title = id, native = false ): FakeWin {
	const element = document.createElement( 'div' );
	element.className = 'os-window';
	const t = document.createElement( 'span' );
	t.className = 'os-window__title';
	t.textContent = title;
	element.appendChild( t );
	const w: FakeWin = {
		id,
		config: { baseId: id, title, icon: 'dashicons-admin-post', native },
		element,
		minimized: false,
		isMinimized: () => w.minimized,
		minimize: vi.fn( () => {
			w.minimized = true;
		} ),
		restore: vi.fn( () => {
			w.minimized = false;
		} ),
		close: vi.fn(),
		reload: vi.fn(),
		getCurrentUrl: () => `${ ADMIN }${ id }?page=x`,
	};
	return w;
}

function fakeManager( wins: FakeWin[] ) {
	const focus = vi.fn( ( target: FakeWin ) => {
		const i = wins.indexOf( target );
		if ( i >= 0 ) {
			wins.splice( i, 1 );
			wins.push( target );
		}
	} );
	const closeAll = vi.fn( () => {
		wins.splice( 0, wins.length );
		return 0;
	} );
	const manager = {
		getAll: () => wins.slice(),
		getById: ( id: string ) => wins.find( ( w ) => w.id === id ),
		getActiveDesktopId: () => 'desktop-1',
		focus,
		minimizeAll: () => {
			for ( const w of wins ) {
				w.minimize();
			}
			return wins.slice();
		},
		closeAll,
	} as unknown as WindowManager;
	return { manager, focus, closeAll };
}

const modeApi: OsModeApi = {
	get: () => 'mobile',
	getPreference: () => 'auto',
	getBreakpoints: () => ( { mobile: 767, tablet: 1024 } ),
	isMobile: () => true,
	subscribe: () => () => undefined,
};

function navItem( id: string, title = id ): NavItem {
	return {
		id,
		kind: 'core',
		title,
		icon: 'dashicons-admin-generic',
		menu: { id, title, icon: 'dashicons-admin-generic', url: `${ ADMIN }${ id }`, badge: 0, submenu: [] },
	} as NavItem;
}

function shellDom() {
	const shell = document.createElement( 'div' );
	shell.id = 'os-shell';
	const body = document.createElement( 'div' );
	body.className = 'os-shell__body';
	const area = document.createElement( 'div' );
	area.id = 'os-area';
	body.appendChild( area );
	shell.appendChild( body );
	document.body.appendChild( shell );
	return { shell, area };
}

function deps( wins: FakeWin[], over: Partial< MobileLayerDeps > = {} ) {
	const { shell, area } = shellDom();
	const { manager, focus, closeAll } = fakeManager( wins );
	const recents: SessionWindow[] = [];
	const nav: NavResult = {
		dock: { core: [ navItem( 'edit.php', 'Posts' ), navItem( 'upload.php', 'Media' ) ], apps: [], controls: [] },
		sidebar: [],
		desktop: [],
		ephemeral: new Set(),
	};
	const openNavItem = vi.fn( () => true );
	const openExternal = vi.fn();
	const wallpaper = { suspend: vi.fn(), resume: vi.fn() };
	const recentsApi = {
		list: () => recents.slice(),
		open: vi.fn(),
		forget: vi.fn(),
		subscribe: () => () => undefined,
	};
	const d: MobileLayerDeps = {
		manager,
		shell,
		area,
		mode: modeApi,
		getNav: () => nav,
		openNavItem,
		getBadge: () => 0,
		getPinnedTabIds: () => [ 'edit.php' ],
		subscribeNav: () => () => undefined,
		wallpaper,
		recents: recentsApi,
		openExternal,
		adminUrl: ADMIN,
		renderIcon: ( _i, o ) => {
			const s = document.createElement( 'span' );
			s.className = o.className ?? '';
			return s;
		},
		...over,
	};
	return { d, shell, area, focus, closeAll, recents, openNavItem, openExternal, wallpaper, recentsApi };
}

const flush = async (): Promise< void > => {
	await new Promise( ( r ) => setTimeout( r, 0 ) );
	await new Promise( ( r ) => requestAnimationFrame( () => r( undefined ) ) );
};

describe( 'mountMobileLayer', () => {
	beforeEach( () => {
		installHooksStub();
		document.body.innerHTML = '';
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'boots to home with no windows, paints the four surfaces, suspends the wallpaper', () => {
		const wins: FakeWin[] = [];
		const { d, shell, wallpaper } = deps( wins );
		const layer = mountMobileLayer( d );

		expect( shell.classList.contains( 'os-mobile' ) ).toBe( true );
		expect( shell.dataset.osMobileState ).toBe( 'home' );
		expect( layer.getState() ).toBe( 'home' );
		expect( shell.querySelector( '.os-mobile-top' ) ).not.toBeNull();
		expect( ( shell.querySelector( '.os-mobile-top' ) as HTMLElement ).hidden ).toBe( true );
		expect( ( shell.querySelector( '.os-mobile-home' ) as HTMLElement ).hidden ).toBe( false );
		// Home, the one pinned item, the switcher — a pin is never padded.
		expect(
			Array.from( shell.querySelectorAll< HTMLElement >( '.os-mobile-tabs__item' ) ).map( ( b ) => b.dataset.tab ),
		).toEqual( [ 'home', 'edit.php', 'switcher' ] );
		expect( shell.querySelector( '.os-mobile-switcher' )?.getAttribute( 'role' ) ).toBe( 'dialog' );
		expect( wallpaper.suspend ).toHaveBeenCalledWith( 'openstation/mobile' );

		layer.unmount();
		expect( shell.classList.contains( 'os-mobile' ) ).toBe( false );
		expect( shell.querySelector( '.os-mobile-top' ) ).toBeNull();
		expect( wallpaper.resume ).toHaveBeenCalledWith( 'openstation/mobile' );
	} );

	test( 'an un-minimized window is the app; Back minimizes it; the tab bar follows', async () => {
		const posts = fakeWin( 'wp-window-edit-php', 'Posts' );
		const wins = [ posts ];
		const { d, shell } = deps( wins );
		const layer = mountMobileLayer( d );

		expect( layer.getState() ).toBe( 'app' );
		const top = shell.querySelector( '.os-mobile-top' ) as HTMLElement;
		expect( top.hidden ).toBe( false );
		expect( top.querySelector( '.os-mobile-top__title' )?.textContent ).toBe( 'Posts' );
		expect( posts.element.classList.contains( 'os-mobile-enter' ) ).toBe( true );

		// No back button on the bar: Home is the tab bar, the edge
		// swipe and the hardware Back, all of which land on goHome().
		expect( top.querySelector( '.os-mobile-top__back' ) ).toBeNull();
		layer.goHome();
		await flush();
		expect( posts.minimize ).toHaveBeenCalledTimes( 1 );
		expect( layer.getState() ).toBe( 'home' );
		expect( shell.dataset.osMobileState ).toBe( 'home' );
		const homeTab = shell.querySelector( '.os-mobile-tabs__item[data-tab="home"]' );
		expect( homeTab?.getAttribute( 'aria-current' ) ).toBe( 'page' );
		layer.unmount();
	} );

	test( 'a title change reaches the top bar', async () => {
		const posts = fakeWin( 'w', 'Posts' );
		const { d, shell } = deps( [ posts ] );
		const layer = mountMobileLayer( d );
		( posts.element.querySelector( '.os-window__title' ) as HTMLElement ).textContent = 'Edit Post';
		doAction( HOOKS.WINDOW_TITLE_CHANGED, { windowId: 'w' } );
		await flush();
		expect( shell.querySelector( '.os-mobile-top__title' )?.textContent ).toBe( 'Edit Post' );
		layer.unmount();
	} );

	test( 'the switcher lists open windows most-recent-first, then recents; picks and closes', async () => {
		const a = fakeWin( 'a', 'Alpha' );
		const b = fakeWin( 'b', 'Beta' );
		const wins = [ a, b ];
		const { d, shell, focus, recents, recentsApi } = deps( wins );
		recents.push( {
			id: 'r',
			url: `${ ADMIN }r`,
			title: 'Recent one',
			icon: 'dashicons-admin-generic',
			state: 'normal',
			x: 0,
			y: 0,
			width: 1,
			height: 1,
		} );
		const layer = mountMobileLayer( d );

		layer.openSwitcher();
		expect( layer.getState() ).toBe( 'switcher' );
		const cards = Array.from( shell.querySelectorAll< HTMLElement >( '.os-mobile-card' ) );
		expect( cards.map( ( c ) => c.dataset.cardId ) ).toEqual( [ 'b', 'a', 'r' ] );
		expect( cards[ 2 ].dataset.cardKind ).toBe( 'recent' );
		expect( document.activeElement ).toBe( cards[ 0 ].querySelector( '.os-mobile-card__body' ) );

		// The app on screen is marked, and tapping it only dismisses.
		expect( cards[ 0 ].classList.contains( 'os-mobile-card--active' ) ).toBe( true );
		expect( cards[ 0 ].querySelector( '.os-mobile-card__status' )?.textContent ).toBe( 'Active' );
		expect( cards[ 0 ].querySelector( '.os-mobile-card__body' )?.getAttribute( 'aria-current' ) ).toBe( 'true' );
		expect( cards[ 1 ].classList.contains( 'os-mobile-card--active' ) ).toBe( false );
		( cards[ 0 ].querySelector( '.os-mobile-card__body' ) as HTMLButtonElement ).click();
		expect( focus ).not.toHaveBeenCalled();
		await flush();
		expect( layer.getState() ).toBe( 'app' );

		layer.openSwitcher();
		const again = Array.from( shell.querySelectorAll< HTMLElement >( '.os-mobile-card' ) );
		( again[ 1 ].querySelector( '.os-mobile-card__body' ) as HTMLButtonElement ).click();
		expect( focus ).toHaveBeenCalledWith( a );
		expect( layer.getState() ).toBe( 'app' );

		layer.openSwitcher();
		const recentCard = shell.querySelector< HTMLElement >( '.os-mobile-card[data-card-id="r"]' );
		( recentCard?.querySelector( '.os-mobile-card__body' ) as HTMLButtonElement ).click();
		expect( recentsApi.open ).toHaveBeenCalledWith( expect.objectContaining( { id: 'r' } ) );

		layer.openSwitcher();
		const closeB = shell.querySelector< HTMLButtonElement >( '.os-mobile-card[data-card-id="b"] .os-mobile-card__close' );
		closeB?.click();
		await new Promise( ( r ) => setTimeout( r, 260 ) );
		expect( b.close ).toHaveBeenCalledTimes( 1 );

		// Escape dismisses and returns to the app state.
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape' } ) );
		await flush();
		expect( layer.getState() ).toBe( 'app' );
		layer.unmount();
	} );

	test( 'the top bar has two controls: minimize keeps the window, × leaves the screen at once and closes', async () => {
		const w = fakeWin( 'w', 'Posts' );
		const { d, shell } = deps( [ w ] );
		const layer = mountMobileLayer( d );
		const top = shell.querySelector( '.os-mobile-top' ) as HTMLElement;
		expect( top.querySelectorAll( 'button' ).length ).toBe( 2 );

		const minimize = top.querySelector( '.os-mobile-top__minimize' ) as HTMLButtonElement;
		expect( minimize.getAttribute( 'aria-label' ) ).toBe( 'Minimize app' );
		minimize.click();
		await flush();
		expect( w.minimize ).toHaveBeenCalledTimes( 1 );
		expect( w.close ).not.toHaveBeenCalled();
		expect( layer.getState() ).toBe( 'home' );

		w.restore();
		await flush();
		const close = top.querySelector( '.os-mobile-top__close' ) as HTMLButtonElement;
		expect( close.getAttribute( 'aria-label' ) ).toBe( 'Close app' );
		close.click();
		// Minimized in the same tick — the screen does not wait for the
		// close handshake — and the close is asked for right behind it.
		expect( w.minimize ).toHaveBeenCalledTimes( 2 );
		expect( w.close ).toHaveBeenCalledTimes( 1 );
		layer.unmount();
	} );

	test( 'Overview on a phone is the switcher: no tile for it, and the manager lands there', () => {
		const { d, shell } = deps( [ fakeWin( 'w' ) ] );
		const overview = navItem( 'os-overview', 'Overview' );
		overview.kind = 'control';
		const nav = d.getNav() as NavResult;
		nav.dock.controls.push( overview );
		const layer = mountMobileLayer( d );
		layer.refresh();

		expect( shell.querySelector( '.os-mobile-tile[data-nav-id="os-overview"]' ) ).toBeNull();
		document.dispatchEvent( new CustomEvent( 'os-mobile-open-switcher' ) );
		expect( layer.getState() ).toBe( 'switcher' );
		layer.unmount();
	} );

	test( 'a home tile opens through the opener and the switcher closes', () => {
		const { d, shell, openNavItem } = deps( [] );
		const layer = mountMobileLayer( d );
		layer.openSwitcher();
		( shell.querySelector( '.os-mobile-tile[data-nav-id="upload.php"]' ) as HTMLButtonElement ).click();
		expect( openNavItem ).toHaveBeenCalledWith( expect.objectContaining( { id: 'upload.php' } ) );
		expect( layer.getState() ).toBe( 'home' );
		layer.unmount();
	} );
} );
