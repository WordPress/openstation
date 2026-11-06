/**
 * Resume-time menu refresh checks.
 *
 * An installed app on a phone rarely navigates, and iOS keeps the page
 * in memory across days. `bindResumeMenuRefresh` must ask for a menu
 * payload update whenever the page returns to the foreground — throttled,
 * and never while hidden — so tile badges (e.g. pending plugin updates)
 * ripen on their own.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	_resetResumeMenuCheck,
	bindResumeMenuRefresh,
	MENU_RESUME_CHECK_MIN_INTERVAL_MS,
	noteMenuRefreshed,
} from '../../src/boot/menu-refresh';
import { createLayoutDispatcher, NAV_CHANGED_EVENT } from '../../src/desktop-layout';
import { mountMobileLayer } from '../../src/mobile/layer';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import type { WindowManager } from '../../src/window-manager';
import type { MobileLayerDeps } from '../../src/mobile/types';
import type { DockItem } from '../../src/dock';

function setVisibility( state: 'visible' | 'hidden' ): void {
	Object.defineProperty( document, 'visibilityState', { value: state, configurable: true } );
	document.dispatchEvent( new Event( 'visibilitychange' ) );
}

describe( 'bindResumeMenuRefresh', () => {
	beforeEach( () => {
		installHooksStub();
		_resetResumeMenuCheck();
		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2026-06-01T10:00:00Z' ) );
	} );

	afterEach( () => {
		_resetResumeMenuCheck();
		clearHooksStub();
		Object.defineProperty( document, 'visibilityState', { value: 'visible', configurable: true } );
		vi.useRealTimers();
		vi.restoreAllMocks();
	} );

	test( 'triggers refresh when returning to foreground after interval has passed', async () => {
		const refresh = vi.fn( async () => undefined );
		bindResumeMenuRefresh( refresh );

		// Immediate return after registration is throttled.
		setVisibility( 'visible' );
		expect( refresh ).not.toHaveBeenCalled();

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		expect( refresh ).toHaveBeenCalledTimes( 1 );

		// Another return a minute later is inside the window.
		vi.advanceTimersByTime( 60_000 );
		setVisibility( 'visible' );
		expect( refresh ).toHaveBeenCalledTimes( 1 );

		// pageshow (back-forward cache resume) triggers refresh once interval passes.
		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS );
		window.dispatchEvent( new Event( 'pageshow' ) );
		expect( refresh ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'never checks while the page is hidden', async () => {
		const refresh = vi.fn( async () => undefined );
		bindResumeMenuRefresh( refresh );

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'hidden' );
		expect( refresh ).not.toHaveBeenCalled();
	} );

	test( 'a failing/rejected refresh is swallowed and asked again next time', async () => {
		const refresh = vi.fn( async () => undefined );
		refresh.mockRejectedValueOnce( new Error( 'network error' ) );
		bindResumeMenuRefresh( refresh );

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		await Promise.resolve();
		expect( refresh ).toHaveBeenCalledTimes( 1 );

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		expect( refresh ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'noteMenuRefreshed pushes the next resume check forward', async () => {
		const refresh = vi.fn( async () => undefined );
		bindResumeMenuRefresh( refresh );

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		// A manual or in-session refresh happens.
		noteMenuRefreshed();

		// Returning immediately is now within the new throttle window.
		setVisibility( 'visible' );
		expect( refresh ).not.toHaveBeenCalled();

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		expect( refresh ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'unbind cleans up all listeners', async () => {
		const refresh = vi.fn( async () => undefined );
		const unbind = bindResumeMenuRefresh( refresh );
		unbind();

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		window.dispatchEvent( new Event( 'pageshow' ) );
		expect( refresh ).not.toHaveBeenCalled();
	} );

	test( 'end-to-end: resume after backgrounding triggers refresh probe and updates mobile home badges', async () => {
		const pluginsItem = ( badge: number ): DockItem => ( {
			id: 'plugins.php',
			title: 'Plugins',
			icon: 'dashicons-admin-plugins',
			url: 'https://example.test/wp-admin/plugins.php',
			badge,
			submenu: [],
			multi: false,
			isCore: false,
		} );

		const bottomDockEl = document.createElement( 'div' );
		const shellBody = document.createElement( 'div' );
		const shellRoot = document.createElement( 'div' );
		const shell = document.createElement( 'div' );
		shell.id = 'os-shell';
		const area = document.createElement( 'div' );
		area.id = 'os-area';
		shell.appendChild( area );
		document.body.appendChild( shell );

		const windowManager = {
			getFocused: () => null,
			getAllByBaseId: () => [],
			getAllByBaseIdOnActiveDesktop: () => [],
			getAll: () => [],
			getById: () => undefined,
			getActiveDesktopId: () => 'default-1',
			minimizeAll: () => {},
		} as unknown as WindowManager;

		const dispatcher = createLayoutDispatcher(
			{
				bottomDockEl,
				shellBody,
				shellRoot,
				windowManager,
				adminUrl: 'https://example.test/wp-admin/',
				renderIcons: () => {},
				readSettings: () => ( {
					desktopLayout: 'unified' as const,
					dockPlacement: 'bottom' as const,
					navPlacement: {},
					navOrder: {},
				} ),
			},
			'unified',
			[ pluginsItem( 0 ) ],
			[],
		);

		const mobileDeps: MobileLayerDeps = {
			manager: windowManager,
			shell,
			area,
			mode: { isMobile: () => true, getMode: () => 'mobile' } as unknown as MobileLayerDeps[ 'mode' ],
			getNav: () => dispatcher.getNav(),
			openNavItem: () => true,
			getBadge: ( item ) => item.menu?.badge ?? 0,
			getPinnedTabIds: () => [],
			subscribeNav: ( cb ) => {
				document.addEventListener( NAV_CHANGED_EVENT, cb );
				return () => document.removeEventListener( NAV_CHANGED_EVENT, cb );
			},
			wallpaper: { suspend: () => {}, resume: () => {} },
			openExternal: () => {},
			adminUrl: 'https://example.test/wp-admin/',
			renderIcon: () => document.createElement( 'span' ),
		};

		const layer = mountMobileLayer( mobileDeps );

		// Initial state: 0 badges, so no badge element in DOM
		expect(
			shell.querySelector( '.os-mobile-tile[data-nav-id="plugins.php"] .os-mobile-tile__badge' ),
		).toBeNull();

		// App goes to background on mobile/iOS
		setVisibility( 'hidden' );

		// Mock the server probe that runs on resume: when refresh is called,
		// it updates dockItems with the fresh badge count from the server.
		const refresh = vi.fn( async () => {
			dispatcher.applyDockItems( [ pluginsItem( 3 ) ] );
		} );
		bindResumeMenuRefresh( refresh );

		// 6 minutes pass while user switches to other apps
		vi.advanceTimersByTime( 6 * 60_000 );

		// User brings the app back to foreground (iOS resume)
		setVisibility( 'visible' );

		expect( refresh ).toHaveBeenCalledTimes( 1 );

		// The mobile home tile now reflects the updated badge count!
		const badgeEl = shell.querySelector(
			'.os-mobile-tile[data-nav-id="plugins.php"] .os-mobile-tile__badge',
		);
		expect( badgeEl ).not.toBeNull();
		expect( badgeEl?.textContent ).toBe( '3' );

		layer.unmount();
		shell.remove();
	} );
} );

