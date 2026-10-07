import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { WindowManager } from '../../src/window-manager';
import { syncOpenWindowSubmenus } from '../../src/window/submenu-sync';
import type { DesktopConfig } from '../../src/types';

describe( 'WindowManager — opening a window with a submenu', async () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		Object.defineProperty( desktop, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		Object.defineProperty( desktop, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( desktop, 'clientHeight', { value: 900, configurable: true } );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( async () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'opens a singleton page with a submenu + renders submenu tabs', async () => {
		const win = await manager.open( {
			id: 'plugins.php',
			url: 'http://example.test/wp-admin/plugins.php',
			title: 'Plugins',
			icon: 'dashicons-admin-plugins',
			multi: false,
			submenu: [
				{ title: 'Installed Plugins', url: 'http://example.test/wp-admin/plugins.php' },
				{ title: 'Add New', url: 'http://example.test/wp-admin/plugin-install.php' },
				{ title: 'Plugin File Editor', url: 'http://example.test/wp-admin/plugin-editor.php' },
			],
		} );

		expect( win ).toBeDefined();
		expect( win.element.isConnected ).toBe( true );

		expect( win.element.querySelector( '.os-window__titlebar' ) ).not.toBeNull();
		expect( win.element.querySelector( '.os-window__iframe' ) ).not.toBeNull();

		const tabs = win.element.querySelectorAll( '.os-window__tab' );
		expect( tabs.length ).toBe( 3 );
		expect( tabs[ 0 ].classList.contains( 'os-window__tab--active' ) ).toBe( true );

		const menuBtn = win.element.querySelector( '.os-window__menu-btn' );
		const menuPanel = win.element.querySelector( '.os-window__menu-panel' );
		expect( menuBtn ).not.toBeNull();
		expect( menuPanel ).not.toBeNull();
		const startup = menuPanel!.querySelector( '.os-window__menu-item--startup' );
		expect( startup ).not.toBeNull();

		expect(
			menuPanel!.querySelector( '.os-window__menu-item--open-another' ),
		).toBeNull();
	} );

	test( 'prepends a synthetic parent tab when submenu omits the self-link', async () => {

		const win = await manager.open( {
			id: 'edit.php',
			url: 'http://example.test/wp-admin/edit.php',
			title: 'Posts',
			icon: 'dashicons-admin-post',
			multi: false,
			submenu: [
				{ title: 'Add New Post', url: 'http://example.test/wp-admin/post-new.php' },
				{ title: 'Categories', url: 'http://example.test/wp-admin/edit-tags.php?taxonomy=category' },
				{ title: 'Tags', url: 'http://example.test/wp-admin/edit-tags.php?taxonomy=post_tag' },
			],
		} );

		const tabs = win.element.querySelectorAll< HTMLElement >( '.os-window__tab' );
		expect( tabs.length ).toBe( 4 );
		expect( tabs[ 0 ].textContent ).toBe( 'Posts' );
		expect( tabs[ 0 ].dataset.url ).toBe( 'http://example.test/wp-admin/edit.php' );
		expect( tabs[ 0 ].dataset.kind ).toBe( 'submenu' );

		expect( tabs[ 0 ].classList.contains( 'os-window__tab--active' ) ).toBe( true );
	} );

	test( 'synthetic parent tab prefers selfLabel over the menu title', async () => {
		const win = await manager.open( {
			id: 'edit.php',
			url: 'http://example.test/wp-admin/edit.php',
			title: 'Posts',
			selfLabel: 'All Posts',
			icon: 'dashicons-admin-post',
			multi: false,
			submenu: [
				{ title: 'Categories', url: 'http://example.test/wp-admin/edit-tags.php?taxonomy=category' },
			],
		} );

		const tabs = win.element.querySelectorAll< HTMLElement >( '.os-window__tab' );
		expect( tabs[ 0 ].textContent ).toBe( 'All Posts' );
		expect( tabs[ 0 ].dataset.url ).toBe( 'http://example.test/wp-admin/edit.php' );
	} );

	test( 'synthetic parent tab falls back to the title without a selfLabel', async () => {
		const win = await manager.open( {
			id: 'tools.php',
			url: 'http://example.test/wp-admin/tools.php',
			title: 'Tools',
			icon: 'dashicons-admin-tools',
			multi: false,
			submenu: [
				{ title: 'Import', url: 'http://example.test/wp-admin/import.php' },
			],
		} );

		const tabs = win.element.querySelectorAll< HTMLElement >( '.os-window__tab' );
		expect( tabs[ 0 ].textContent ).toBe( 'Tools' );
	} );

	test( 'synthetic parent tab uses parentUrl when iframe is on a sub-page', async () => {

		const win = await manager.open( {
			id: 'themes-php',
			url: 'http://example.test/wp-admin/theme-install.php?browse=popular',
			parentUrl: 'http://example.test/wp-admin/themes.php',
			title: 'Appearance',
			icon: 'dashicons-admin-appearance',
			multi: false,
			submenu: [
				{ title: 'Add Theme', url: 'http://example.test/wp-admin/theme-install.php?browse=popular' },
				{ title: 'Editor', url: 'http://example.test/wp-admin/site-editor.php' },
			],
		} );

		const tabs = win.element.querySelectorAll< HTMLElement >( '.os-window__tab' );

		expect( tabs.length ).toBe( 3 );
		expect( tabs[ 0 ].textContent ).toBe( 'Appearance' );
		expect( tabs[ 0 ].dataset.url ).toBe( 'http://example.test/wp-admin/themes.php' );

		expect( tabs[ 1 ].textContent ).toBe( 'Add Theme' );
		expect( tabs[ 1 ].classList.contains( 'os-window__tab--active' ) ).toBe( true );

		expect( tabs[ 0 ].classList.contains( 'os-window__tab--active' ) ).toBe( false );
	} );

	test( 'synthetic parent tab is suppressed when parentUrl already in submenu (WC shape)', async () => {

		const win = await manager.open( {
			id: 'wc-admin',
			url: 'http://example.test/wp-admin/admin.php?page=wc-orders',
			parentUrl: 'http://example.test/wp-admin/admin.php?page=wc-admin',
			title: 'WooCommerce',
			icon: 'dashicons-cart',
			multi: false,
			submenu: [
				{ title: 'Home', url: 'http://example.test/wp-admin/admin.php?page=wc-admin' },
				{ title: 'Orders', url: 'http://example.test/wp-admin/admin.php?page=wc-orders' },
				{ title: 'Products', url: 'http://example.test/wp-admin/edit.php?post_type=product' },
			],
		} );

		const tabs = win.element.querySelectorAll< HTMLElement >( '.os-window__tab' );

		expect( tabs.length ).toBe( 3 );
		expect( tabs[ 0 ].textContent ).toBe( 'Home' );

		expect( tabs[ 1 ].textContent ).toBe( 'Orders' );
		expect( tabs[ 1 ].classList.contains( 'os-window__tab--active' ) ).toBe( true );
	} );

	test( 'parentUrl absent — synthetic logic falls back to url (legacy behaviour)', async () => {

		const win = await manager.open( {
			id: 'edit.php',
			url: 'http://example.test/wp-admin/edit.php',
			title: 'Posts',
			icon: 'dashicons-admin-post',
			multi: false,
			submenu: [
				{ title: 'All Posts', url: 'http://example.test/wp-admin/edit.php' },
				{ title: 'Add New', url: 'http://example.test/wp-admin/post-new.php' },
			],
		} );

		const tabs = win.element.querySelectorAll< HTMLElement >( '.os-window__tab' );

		expect( tabs.length ).toBe( 2 );
		expect( tabs[ 0 ].textContent ).toBe( 'All Posts' );
	} );

	test( 'opens + closes a singleton + re-opens without error', async () => {
		const first = await manager.open( {
			id: 'plugins.php',
			url: 'http://example.test/wp-admin/plugins.php',
			title: 'Plugins',
			icon: 'dashicons-admin-plugins',
			multi: false,
			submenu: [
				{ title: 'Installed Plugins', url: 'http://example.test/wp-admin/plugins.php' },
			],
		} );
		first.close();

		const second = await manager.open( {
			id: 'plugins.php',
			url: 'http://example.test/wp-admin/plugins.php',
			title: 'Plugins',
			icon: 'dashicons-admin-plugins',
			multi: false,
			submenu: [
				{ title: 'Installed Plugins', url: 'http://example.test/wp-admin/plugins.php' },
			],
		} );
		expect( second ).toBeDefined();
		expect( second.element.querySelector( '.os-window__iframe' ) ).not.toBeNull();
	} );

	test( 'opens a fresh singleton instance on each virtual desktop', async () => {

		const baseCfg = {
			id: 'plugins-php',
			baseId: 'plugins-php',
			url: 'http://example.test/wp-admin/plugins.php',
			title: 'Plugins',
			icon: 'dashicons-admin-plugins',
			multi: false,
			submenu: [
				{ title: 'Installed Plugins', url: 'http://example.test/wp-admin/plugins.php' },
			],
		};

		const first = await manager.open( baseCfg );
		expect( first.config.desktopId ).toBe( 'desktop-1' );

		const second = manager.createDesktop();
		manager.switchDesktop( second.id );

		const secondInstance = await manager.open( baseCfg );

		expect( secondInstance ).not.toBe( first );
		expect( secondInstance.config.desktopId ).toBe( second.id );

		expect( manager.getAll().length ).toBe( 2 );
		expect( secondInstance.id ).not.toBe( first.id );

		manager.switchDesktop( 'desktop-1' );
		const thirdClick = await manager.open( baseCfg );
		expect( thirdClick ).toBe( first );
		expect( manager.getAll().length ).toBe( 2 );
	} );

	test( 'opens a multi-capable page + renders Open another', async () => {
		const win = await manager.open( {
			id: 'edit.php',
			url: 'http://example.test/wp-admin/edit.php',
			title: 'Posts',
			icon: 'dashicons-admin-post',
			multi: true,
			submenu: [
				{ title: 'All Posts', url: 'http://example.test/wp-admin/edit.php' },
				{ title: 'Add New', url: 'http://example.test/wp-admin/post-new.php' },
			],
		} );
		const menuPanel = win.element.querySelector( '.os-window__menu-panel' )!;
		expect(
			menuPanel.querySelector( '.os-window__menu-item--open-another' ),
		).not.toBeNull();
	} );

	test( '"Open in new window" item renders for every iframe window', async () => {

		const win = await manager.open( {
			id: 'edit-comments.php',
			url: 'http://example.test/wp-admin/edit-comments.php',
			title: 'Comments',
			icon: 'dashicons-admin-comments',
			multi: false,
		} );
		const menuPanel = win.element.querySelector( '.os-window__menu-panel' )!;
		const item = menuPanel.querySelector(
			'.os-window__menu-item--open-in-new-window',
		);
		expect( item ).not.toBeNull();
		expect( item!.getAttribute( 'role' ) ).toBe( 'menuitem' );
	} );

	test( '"Open in new window" opens a sibling at the current iframe URL', async () => {
		const win = await manager.open( {
			id: 'edit.php',
			url: 'http://example.test/wp-admin/edit.php',
			title: 'Posts',
			icon: 'dashicons-admin-post',
			multi: true,
		} );

		const navigatedUrl = 'http://example.test/wp-admin/post.php?post=42&action=edit';
		win.getCurrentUrl = () => navigatedUrl;

		expect( manager.getAll().length ).toBe( 1 );
		win.onOpenInNewWindow!( win );

		await Promise.resolve();
		await Promise.resolve();

		const all = manager.getAll();
		expect( all.length ).toBe( 2 );
		const sibling = all.find( ( w ) => w !== win )!;
		expect( sibling ).toBeDefined();

		expect( sibling.config.baseId ).toBe( 'edit.php' );
		expect( sibling.config.url ).toBe( navigatedUrl );
		expect( sibling.id ).not.toBe( win.id );
	} );

	test( 'a menu refresh re-seeds an open window whose dock entry lost rows', async () => {

		const admin = 'http://example.test/wp-admin/';
		const themes = { title: 'Themes', url: `${ admin }themes.php` };
		const editor = { title: 'Editor', url: `${ admin }site-editor.php` };
		const menus = { title: 'Menus', url: `${ admin }nav-menus.php` };
		const win = await manager.open( {
			id: 'themes-php',
			baseId: 'themes-php',
			url: themes.url,
			parentUrl: themes.url,
			title: 'Appearance',
			selfLabel: 'Themes',
			icon: 'dashicons-admin-appearance',
			submenu: [ editor, menus ],
		} );
		const labels = (): string[] =>
			Array.from(
				win.element.querySelectorAll( '.os-window__tab[data-kind="submenu"]' ),
				( t ) => t.textContent ?? '',
			);
		const config = ( submenu: { title: string; url: string }[] ) =>
			( {
				adminUrl: admin,
				dockItems: [ { id: 'menu-appearance', title: 'Appearance', url: themes.url, selfLabel: 'Themes', submenu } ],
			} ) as unknown as DesktopConfig;

		const before = win.element.querySelector( '.os-window__tab[data-kind="submenu"]' );
		syncOpenWindowSubmenus( manager.getAll(), config( [ editor, menus ] ) );
		expect( win.element.querySelector( '.os-window__tab[data-kind="submenu"]' ) ).toBe( before );

		syncOpenWindowSubmenus( manager.getAll(), config( [ editor ] ) );
		expect( labels() ).toEqual( [ 'Themes', 'Editor' ] );
		expect( win.config.submenu ).toEqual( [ editor ] );
		const active = win.element.querySelector( '.os-window__tab--active' ) as HTMLElement;
		expect( active.dataset.url ).toBe( themes.url );
	} );
} );
