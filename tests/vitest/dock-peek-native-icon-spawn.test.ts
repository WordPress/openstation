/**
 * Regression: clicking the dock-peek "+" (Ghost Card) on a synthesized
 * dock tile for a wallpaper-icon-promoted-to-dock that targets a
 * native window (e.g. My WordPress when the user moves its icon to
 * the dock via OS Settings) used to call `manager.openNew()` with an
 * empty `url` and no `native`/`render` config — opening a chrome-
 * only iframe whose `src=''` never loaded. The fix routes that case
 * through the native opener so the duplicate spawns as a real
 * native instance.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dock, type DockItem } from '../../src/dock';
import type { WindowManager } from '../../src/window-manager';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

function makeManagerStub() {
	return {
		getFocused: () => null,
		getAllByBaseId: () => [],
		getAll: () => [],
		getById: () => undefined,
		getActiveDesktopId: () => 'default-1',
		openNew: vi.fn(),
	} as unknown as WindowManager & { openNew: ReturnType< typeof vi.fn > };
}

function synthIconDockItem( overrides: Partial< DockItem > = {} ): DockItem {
	// Same shape `applyDockPlacement` produces for a wallpaper icon
	// promoted to the dock that targets a native window (My WordPress,
	// Jorvy, plugin-registered launchers).
	return {
		id: 'desktop:desktop-mode-my-wordpress',
		title: 'My WordPress',
		icon: 'dashicons-wordpress',
		url: '',
		windowId: 'desktop-mode-my-wordpress',
		badge: 0,
		submenu: [],
		multi: false,
		isCore: false,
		...overrides,
	};
}

describe( 'Dock — dock-peek "+" on native-window-targeted icon', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( '"+" routes through wp.os.openNewWindow when item has windowId + empty url', () => {
		const openNewWindow = vi.fn().mockReturnValue( true );
		// `installHooksStub` populated `window.wp.hooks` — extend it
		// with the public-API `desktop` namespace instead of replacing
		// `window.wp` (which would clobber the hooks stub).
		( window as unknown as { wp: { hooks: unknown; os?: { openNewWindow: typeof openNewWindow } } } )
			.wp.os = { openNewWindow };

		const manager = makeManagerStub();
		const item = synthIconDockItem();
		const container = document.createElement( 'nav' );
		document.body.appendChild( container );
		const dock = new Dock( container, manager, [ item ], 'http://localhost/wp-admin/', 'left' );

		// Reach the private spawner — same call the dock-peek "+" makes.
		( dock as unknown as { openNewInstance: ( i: DockItem ) => void } )
			.openNewInstance( item );

		expect( openNewWindow ).toHaveBeenCalledWith(
			'desktop-mode-my-wordpress',
			{ source: 'dock-peek' },
		);
		// And — critically — `manager.openNew` MUST NOT have been
		// called. Pre-fix it WAS called with `url: ''` / no render
		// callback, which is what produced the chrome-only second
		// window the user reported.
		expect( manager.openNew ).not.toHaveBeenCalled();
	} );

	test( '"+" still falls through to iframe openNew for regular menu items', () => {
		const manager = makeManagerStub();
		// Same-origin URL so the off-site short-circuit doesn't try to
		// `window.open()` (not implemented in jsdom).
		const item: DockItem = {
			id: 'plugin-x',
			title: 'Plugin X',
			icon: 'dashicons-admin-plugins',
			url: '/wp-admin/admin.php?page=plugin-x',
			badge: 0,
			submenu: [],
			multi: false,
		};
		const container = document.createElement( 'nav' );
		document.body.appendChild( container );
		const dock = new Dock( container, manager, [ item ], '/wp-admin/', 'left' );

		( dock as unknown as { openNewInstance: ( i: DockItem ) => void } )
			.openNewInstance( item );

		expect( manager.openNew ).toHaveBeenCalledTimes( 1 );
		const call = manager.openNew.mock.calls[ 0 ][ 0 ] as {
			url: string;
			multi: boolean;
		};
		expect( call.url ).toBe( '/wp-admin/admin.php?page=plugin-x' );
		expect( call.multi ).toBe( true );
	} );
} );
