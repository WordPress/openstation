/**
 * Clicking a tile whose target is a window rather than an admin page.
 *
 * Two of these on the rail: an app launcher the user pinned, and a
 * window with no launcher at all that is on the rail only because it
 * is open. Both carry `windowId` and an empty `url`, so deriving an id
 * from the url would find nothing and the click would silently no-op.
 *
 * Focus comes first. The native-window registry can only open windows
 * it registered, and a window that arrived some other way — the
 * Preferences panel, a plugin's own `windowManager.open()` — is
 * exactly the kind whose tile exists because it is already open.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dock, type DockItem } from '../../src/dock';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import type { WindowManager } from '../../src/window-manager';

function makeItem( overrides: Partial< DockItem > = {} ): DockItem {
	return {
		id: 'desktop-mode-os-settings',
		title: 'OpenStation Preferences',
		icon: 'dashicons-admin-generic',
		url: '',
		windowId: 'desktop-mode-os-settings',
		badge: 0,
		submenu: [],
		...overrides,
	};
}

describe( 'a tile whose target is a window', () => {
	let container: HTMLElement;
	let focus: ReturnType< typeof vi.fn >;
	let openWindow: ReturnType< typeof vi.fn >;
	let managerOpen: ReturnType< typeof vi.fn >;
	let open: string[];

	function mount( item: DockItem ): void {
		const manager = {
			getFocused: () => null,
			getAllByBaseId: () => [],
			getAllByBaseIdOnActiveDesktop: () => [],
			getAll: () => [],
			getById: ( id: string ) =>
				open.includes( id ) ? { id } : undefined,
			getActiveDesktopId: () => 'default-1',
			focus,
			open: managerOpen,
		} as unknown as WindowManager;
		new Dock( container, manager, [ item ], '/wp-admin/', 'bottom' );
	}

	function click(): void {
		container
			.querySelector< HTMLElement >( '.os-dock__item-primary' )!
			.click();
	}

	beforeEach( () => {
		installHooksStub();
		open = [];
		focus = vi.fn();
		openWindow = vi.fn();
		managerOpen = vi.fn();
		( window as unknown as { wp: { os: unknown } } ).wp = {
			...( window as unknown as { wp?: object } ).wp,
			os: { openWindow },
		};
		container = document.createElement( 'nav' );
		document.body.appendChild( container );
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'focuses the window when it is already open', () => {
		open.push( 'desktop-mode-os-settings' );
		mount( makeItem() );
		click();
		expect( focus ).toHaveBeenCalledWith( {
			id: 'desktop-mode-os-settings',
		} );
		expect( openWindow ).not.toHaveBeenCalled();
	} );

	test( 'opens it by id when it is not', () => {
		mount( makeItem( { id: 'my-app', windowId: 'my-app' } ) );
		click();
		expect( openWindow ).toHaveBeenCalledWith( 'my-app' );
		expect( focus ).not.toHaveBeenCalled();
	} );

	test( 'a tile with a url still takes the admin-page path', () => {
		open.push( 'edit-php' );
		mount(
			makeItem( {
				id: 'menu-posts',
				url: '/wp-admin/edit.php',
				windowId: 'edit-php',
			} ),
		);
		click();
		// Not a focus call: an admin page opens through the window
		// manager's own open path, which handles reuse itself.
		expect( focus ).not.toHaveBeenCalled();
		expect( openWindow ).not.toHaveBeenCalled();
		expect( managerOpen ).toHaveBeenCalledWith(
			expect.objectContaining( { url: '/wp-admin/edit.php' } ),
		);
	} );
} );
