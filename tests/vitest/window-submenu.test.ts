/**
 * Regression test: opening a window with a submenu shouldn't throw,
 * and the tab strip should be populated. Originated from a user report
 * that the Plugins admin page — which ships a submenu (Installed,
 * Add New, Editor) — failed to open after a refactor.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { WindowManager } from '../../src/window-manager';

describe( 'WindowManager — opening a window with a submenu', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
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

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'opens a singleton page with a submenu + renders submenu tabs', () => {
		const win = manager.open( {
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

		// Title bar + iframe body must exist.
		expect( win.element.querySelector( '.desktop-mode-window__titlebar' ) ).not.toBeNull();
		expect( win.element.querySelector( '.desktop-mode-window__iframe' ) ).not.toBeNull();

		// Submenu renders one tab per entry; first is active because
		// it matches the window's initial URL.
		const tabs = win.element.querySelectorAll( '.desktop-mode-window__tab' );
		expect( tabs.length ).toBe( 3 );
		expect( tabs[ 0 ].classList.contains( 'desktop-mode-window__tab--active' ) ).toBe( true );

		// Title-bar menu panel is present for iframe windows (holds
		// "Open on startup"); its button only mounts if the panel has
		// at least one item.
		const menuBtn = win.element.querySelector( '.desktop-mode-window__menu-btn' );
		const menuPanel = win.element.querySelector( '.desktop-mode-window__menu-panel' );
		expect( menuBtn ).not.toBeNull();
		expect( menuPanel ).not.toBeNull();
		const startup = menuPanel!.querySelector( '.desktop-mode-window__menu-item--startup' );
		expect( startup ).not.toBeNull();

		// For non-multi pages, "Open another" is absent.
		expect(
			menuPanel!.querySelector( '.desktop-mode-window__menu-item--open-another' ),
		).toBeNull();
	} );

	test( 'prepends a synthetic parent tab when submenu omits the self-link', () => {
		// `helpers.php` strips WP's auto-prepended self-link (the entry
		// whose URL matches the parent's). Without an explicit "back to
		// parent" tab, a user navigating from Posts → Categories has no
		// way back to the listing short of closing + reopening the
		// window. The synthetic tab fills that gap.
		const win = manager.open( {
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

		const tabs = win.element.querySelectorAll< HTMLElement >( '.desktop-mode-window__tab' );
		expect( tabs.length ).toBe( 4 );
		expect( tabs[ 0 ].textContent ).toBe( 'Posts' );
		expect( tabs[ 0 ].dataset.url ).toBe( 'http://example.test/wp-admin/edit.php' );
		expect( tabs[ 0 ].dataset.kind ).toBe( 'submenu' );
		// First tab is active because its URL matches the iframe's
		// initial URL.
		expect( tabs[ 0 ].classList.contains( 'desktop-mode-window__tab--active' ) ).toBe( true );
	} );

	test( 'opens + closes a singleton + re-opens without error', () => {
		const first = manager.open( {
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
		// Animation triggers a 300 ms setTimeout; in jsdom the element
		// stays briefly. Forcing a second open should focus the same
		// baseId or create a fresh instance — either is fine.
		const second = manager.open( {
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
		expect( second.element.querySelector( '.desktop-mode-window__iframe' ) ).not.toBeNull();
	} );

	test( 'opens a fresh singleton instance on each virtual desktop', () => {
		// Regression: opening Plugins on Desktop 1 and then clicking
		// Plugins on Desktop 2 used to silently do nothing — `open()`
		// found the Desktop 1 instance by baseId, focused it (on
		// Desktop 1), and returned without making anything visible
		// on Desktop 2. Per-desktop "Spaces" semantics: each desktop
		// is independent; a fresh instance lives on each space.
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

		// Open on Desktop 1.
		const first = manager.open( baseCfg );
		expect( first.config.desktopId ).toBe( 'desktop-1' );

		// Create + switch to Desktop 2.
		const second = manager.createDesktop();
		manager.switchDesktop( second.id );

		// Click Plugins again on Desktop 2.
		const secondInstance = manager.open( baseCfg );

		// A *distinct* Window object — the Desktop 1 instance isn't
		// quietly focused behind the scenes.
		expect( secondInstance ).not.toBe( first );
		expect( secondInstance.config.desktopId ).toBe( second.id );

		// Both instances coexist; their DOM ids don't collide.
		expect( manager.getAll().length ).toBe( 2 );
		expect( secondInstance.id ).not.toBe( first.id );

		// Switching back to Desktop 1 and re-clicking focuses the
		// *original* (not the Desktop 2 copy).
		manager.switchDesktop( 'desktop-1' );
		const thirdClick = manager.open( baseCfg );
		expect( thirdClick ).toBe( first );
		expect( manager.getAll().length ).toBe( 2 );
	} );

	test( 'opens a multi-capable page + renders Open another', () => {
		const win = manager.open( {
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
		const menuPanel = win.element.querySelector( '.desktop-mode-window__menu-panel' )!;
		expect(
			menuPanel.querySelector( '.desktop-mode-window__menu-item--open-another' ),
		).not.toBeNull();
	} );

	test( '"Open in new window" item renders for every iframe window', () => {
		// Singleton (non-multi) windows still get this item — the
		// distinction from "Open another" is that this seeds the new
		// window with the *current* URL, so it makes sense even for
		// pages that aren't formally multi-instance.
		const win = manager.open( {
			id: 'edit-comments.php',
			url: 'http://example.test/wp-admin/edit-comments.php',
			title: 'Comments',
			icon: 'dashicons-admin-comments',
			multi: false,
		} );
		const menuPanel = win.element.querySelector( '.desktop-mode-window__menu-panel' )!;
		const item = menuPanel.querySelector(
			'.desktop-mode-window__menu-item--open-in-new-window',
		);
		expect( item ).not.toBeNull();
		expect( item!.getAttribute( 'role' ) ).toBe( 'menuitem' );
	} );

	test( '"Open in new window" opens a sibling at the current iframe URL', () => {
		const win = manager.open( {
			id: 'edit.php',
			url: 'http://example.test/wp-admin/edit.php',
			title: 'Posts',
			icon: 'dashicons-admin-post',
			multi: true,
		} );

		// Stub `getCurrentUrl()` to simulate the user having navigated
		// in-window from the listing into editing a specific post.
		const navigatedUrl = 'http://example.test/wp-admin/post.php?post=42&action=edit';
		win.getCurrentUrl = () => navigatedUrl;

		expect( manager.getAll().length ).toBe( 1 );
		win.onOpenInNewWindow!( win );

		const all = manager.getAll();
		expect( all.length ).toBe( 2 );
		const sibling = all.find( ( w ) => w !== win )!;
		expect( sibling ).toBeDefined();
		// New window inherits the source's baseId so the dock still
		// groups instances under one icon, but its url is the *current*
		// (post-navigation) URL — not the original landing URL.
		expect( sibling.config.baseId ).toBe( 'edit.php' );
		expect( sibling.config.url ).toBe( navigatedUrl );
		expect( sibling.id ).not.toBe( win.id );
	} );
} );
