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

		expect( focus ).not.toHaveBeenCalled();
		expect( openWindow ).not.toHaveBeenCalled();
		expect( managerOpen ).toHaveBeenCalledWith(
			expect.objectContaining( { url: '/wp-admin/edit.php' } ),
		);
	} );
} );
