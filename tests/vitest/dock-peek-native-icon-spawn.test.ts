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

		( window as unknown as { wp: { hooks: unknown; os?: { openNewWindow: typeof openNewWindow } } } )
			.wp.os = { openNewWindow };

		const manager = makeManagerStub();
		const item = synthIconDockItem();
		const container = document.createElement( 'nav' );
		document.body.appendChild( container );
		const dock = new Dock( container, manager, [ item ], 'http://localhost/wp-admin/', 'left' );

		( dock as unknown as { openNewInstance: ( i: DockItem ) => void } )
			.openNewInstance( item );

		expect( openNewWindow ).toHaveBeenCalledWith(
			'desktop-mode-my-wordpress',
			{ source: 'dock-peek' },
		);

		expect( manager.openNew ).not.toHaveBeenCalled();
	} );

	test( '"+" still falls through to iframe openNew for regular menu items', () => {
		const manager = makeManagerStub();

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
