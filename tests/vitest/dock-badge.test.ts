import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dock, type DockItem } from '../../src/dock';
import { activity } from '../../src/activity';
import { HOOKS } from '../../src/hooks';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

function makeManagerStub() {
	return {
		getFocused: () => null,
		getAllByBaseId: () => [],
		getAllByBaseIdOnActiveDesktop: () => [],
		getAll: () => [],
		getById: () => undefined,
		getActiveDesktopId: () => 'default-1',
	} as unknown as ConstructorParameters< typeof Dock >[ 1 ];
}

function makeItem( overrides: Partial< DockItem > = {} ): DockItem {
	return {
		id: 'plugin-x',
		title: 'Plugin X',
		icon: 'dashicons-admin-plugins',
		url: 'http://localhost/wp-admin/admin.php?page=plugin-x',
		badge: 0,
		submenu: [],
		multi: false,
		...overrides,
	};
}

function mount( items: DockItem[], orientation: 'left' | 'bottom' = 'left' ) {
	const container = document.createElement( 'nav' );
	document.body.appendChild( container );
	const dock = new Dock( container, makeManagerStub(), items, 'http://localhost/wp-admin/', orientation );
	return { container, dock };
}

function badgeText( container: HTMLElement, slug: string ): string | null {
	return container
		.querySelector( `[data-menu-slug="${ slug }"] .os-dock__badge` )
		?.textContent ?? null;
}

describe( 'Dock.setBadge — rail discriminator', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'left orientation publishes rail: "dock"', () => {
		const { dock } = mount( [ makeItem() ], 'left' );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/badge-changed', cb );
		dock.setBadge( 'plugin-x', 4 );
		expect( cb ).toHaveBeenCalledWith( {
			itemId: 'plugin-x',
			count: 4,
			rail: 'dock',
		} );
		off();
	} );

	test( 'bottom orientation publishes rail: "taskbar"', () => {
		const { dock } = mount( [ makeItem() ], 'bottom' );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/badge-changed', cb );
		dock.setBadge( 'plugin-x', 2 );
		expect( cb ).toHaveBeenCalledWith( {
			itemId: 'plugin-x',
			count: 2,
			rail: 'taskbar',
		} );
		off();
	} );

	test( 'silently no-ops for an id not on this rail', () => {
		const { dock } = mount( [ makeItem() ], 'left' );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/badge-changed', cb );
		dock.setBadge( 'never-on-this-rail', 5 );
		expect( cb ).not.toHaveBeenCalled();
		off();
	} );

	test( 'replaceItems re-applies a client-set badge', () => {
		const { container, dock } = mount( [ makeItem() ], 'left' );
		dock.setBadge( 'plugin-x', 6 );
		expect( badgeText( container, 'plugin-x' ) ).toBe( '6' );

		dock.replaceItems( [ makeItem() ] );
		expect( badgeText( container, 'plugin-x' ) ).toBe( '6' );
	} );

	test( 'setBadge(0) drops the override so server-declared badge wins on refresh', () => {
		const { container, dock } = mount( [ makeItem() ], 'left' );
		dock.setBadge( 'plugin-x', 6 );
		dock.setBadge( 'plugin-x', 0 );
		dock.replaceItems( [ makeItem( { badge: 3 } ) ] );

		expect( badgeText( container, 'plugin-x' ) ).toBe( '3' );
	} );
} );

describe( 'Dock.replaceItems tears down peek attachments', () => {
	beforeEach( () => {
		installHooksStub();
		vi.useFakeTimers();
	} );
	afterEach( () => {
		vi.useRealTimers();
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	function pointerEnter( el: HTMLElement ): void {
		const evt = new Event( 'pointerenter' );
		Object.defineProperty( evt, 'pointerType', { value: 'mouse' } );
		el.dispatchEvent( evt );
	}

	test( 'visible peek popover is removed when replaceItems fires', () => {
		const win = {
			id: 'themes-php',
			config: {
				title: 'Appearance',
				icon: 'dashicons-admin-appearance',
				baseId: 'themes-php',
			},
		};
		const manager = {
			getFocused: () => null,
			getAllByBaseId: ( baseId: string ) =>
				baseId === 'themes-php' ? [ win ] : [],
			getAllByBaseIdOnActiveDesktop: ( baseId: string ) =>
				baseId === 'themes-php' ? [ win ] : [],
			getAll: () => [ win ],
			getById: ( id: string ) => ( id === 'themes-php' ? win : undefined ),
			getActiveDesktopId: () => 'default-1',
		} as unknown as ConstructorParameters< typeof Dock >[ 1 ];

		const container = document.createElement( 'nav' );
		document.body.appendChild( container );
		const item: DockItem = {
			id: 'menu-appearance',
			title: 'Appearance',
			icon: 'dashicons-admin-appearance',
			url: 'http://localhost/wp-admin/themes.php',
			badge: 0,
			submenu: [],
			multi: false,
		};
		const dock = new Dock(
			container,
			manager,
			[ item ],
			'http://localhost/wp-admin/',
			'left',
		);

		const tile = container.querySelector< HTMLElement >(
			'[data-menu-slug="menu-appearance"]',
		);
		expect( tile ).not.toBeNull();

		pointerEnter( tile! );
		vi.advanceTimersByTime( 500 );
		expect( document.querySelectorAll( '.os-dock-peek' ).length ).toBe( 1 );

		dock.replaceItems( [ item ] );

		expect( document.querySelectorAll( '.os-dock-peek' ).length ).toBe( 0 );
	} );

	test( 'after replaceItems, the rebuilt tile shows a fresh peek', () => {
		const win = {
			id: 'themes-php',
			config: {
				title: 'Appearance',
				icon: 'dashicons-admin-appearance',
				baseId: 'themes-php',
			},
		};
		const manager = {
			getFocused: () => null,
			getAllByBaseId: ( baseId: string ) =>
				baseId === 'themes-php' ? [ win ] : [],
			getAllByBaseIdOnActiveDesktop: ( baseId: string ) =>
				baseId === 'themes-php' ? [ win ] : [],
			getAll: () => [ win ],
			getById: ( id: string ) => ( id === 'themes-php' ? win : undefined ),
			getActiveDesktopId: () => 'default-1',
		} as unknown as ConstructorParameters< typeof Dock >[ 1 ];

		const container = document.createElement( 'nav' );
		document.body.appendChild( container );
		const item: DockItem = {
			id: 'menu-appearance',
			title: 'Appearance',
			icon: 'dashicons-admin-appearance',
			url: 'http://localhost/wp-admin/themes.php',
			badge: 0,
			submenu: [],
			multi: false,
		};
		const dock = new Dock(
			container,
			manager,
			[ item ],
			'http://localhost/wp-admin/',
			'left',
		);

		dock.replaceItems( [ item ] );

		const tile = container.querySelector< HTMLElement >(
			'[data-menu-slug="menu-appearance"]',
		);
		pointerEnter( tile! );
		vi.advanceTimersByTime( 500 );

		expect( document.querySelectorAll( '.os-dock-peek' ).length ).toBe( 1 );
	} );
} );

describe( 'Dock.removeSystemItem fires HOOKS.DOCK_ITEM_REMOVED', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'removeSystemItem publishes the symmetric remove hook', () => {
		const { dock } = mount( [], 'bottom' );
		dock.appendSystemItem( {
			id: 'jorvy',
			title: 'Jorvy',
			icon: 'dashicons-star-filled',
			onOpen: () => {},
		} );

		const cb = vi.fn();
		const ns = 'os-tests/remove-system-item';
		window.wp?.hooks?.addAction?.( HOOKS.DOCK_ITEM_REMOVED, ns, cb );
		dock.removeSystemItem( 'jorvy' );
		expect( cb ).toHaveBeenCalledWith( { id: 'jorvy', placement: 'taskbar' } );
		window.wp?.hooks?.removeAction?.( HOOKS.DOCK_ITEM_REMOVED, ns );
	} );

	test( 'removeSystemItem on an unknown id is a silent no-op', () => {
		const { dock } = mount( [], 'left' );
		const cb = vi.fn();
		const ns = 'os-tests/remove-noop';
		window.wp?.hooks?.addAction?.( HOOKS.DOCK_ITEM_REMOVED, ns, cb );
		dock.removeSystemItem( 'never-registered' );
		expect( cb ).not.toHaveBeenCalled();
		window.wp?.hooks?.removeAction?.( HOOKS.DOCK_ITEM_REMOVED, ns );
	} );
} );
