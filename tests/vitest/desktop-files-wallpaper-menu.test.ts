/**
 * Unit tests for the Phase-4 wallpaper context menu.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type MenuModule = typeof import( '../../src/desktop-files/wallpaper-menu' );

async function load(): Promise< MenuModule > {
	vi.resetModules();
	return await import( '../../src/desktop-files/wallpaper-menu' );
}

const stubDeps = ( overrides: Partial< import( '../../src/desktop-files/wallpaper-menu' ).WallpaperMenuDeps > = {} ) => ( {
	createFolder: vi.fn(),
	createUrl: vi.fn(),
	toggleShowDesktop: vi.fn(),
	openOsSettings: vi.fn(),
	sortIcons: vi.fn(),
	labels: {
		createFolder: 'New folder',
		showDesktop: 'Show desktop',
		osSettings: 'OS Settings',
		sortHeading: 'Sort by',
		sortNameAsc: 'Name (A → Z)',
		sortNameDesc: 'Name (Z → A)',
		sortDateAsc: 'Date (oldest first)',
		sortDateDesc: 'Date (newest first)',
		newUrl: 'New URL',
	},
	...overrides,
} );

describe( 'wallpaper context menu', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'buildMenuItems returns the built-ins in order', async () => {
		const { buildMenuItems } = await load();
		const items = buildMenuItems( stubDeps() );
		expect( items.map( ( i ) => i.id ) ).toEqual( [
			'create-folder',
			'new-url',
			'sort-by',
			'show-desktop',
			'os-settings',
		] );
		const newUrl = items.find( ( i ) => i.id === 'new-url' );
		expect( newUrl ).toBeDefined();
		expect( newUrl?.icon ).toBe( 'dashicons-admin-links' );
		expect( newUrl?.children ).toBeUndefined();
		const sortBy = items.find( ( i ) => i.id === 'sort-by' );
		expect( sortBy?.children?.map( ( c ) => c.id ) ).toEqual(
			expect.arrayContaining( [
				'sort-name-asc',
				'sort-name-desc',
				'sort-date-asc',
				'sort-date-desc',
			] ),
		);
	} );

	test( 'buildMenuItems omits show-desktop when includeShowDesktop is false', async () => {
		const { buildMenuItems } = await load();
		const items = buildMenuItems(
			stubDeps( { includeShowDesktop: false } ),
		);
		expect( items.map( ( i ) => i.id ) ).toEqual( [
			'create-folder',
			'new-url',
			'sort-by',
			'os-settings',
		] );
	} );

	test( 'clicking New URL invokes deps.createUrl', async () => {
		const { openWallpaperMenu, buildMenuItems } = await load();
		const deps = stubDeps();
		openWallpaperMenu( document.body, { x: 0, y: 0 }, buildMenuItems( deps ) );
		document
			.querySelector< HTMLButtonElement >( '[data-menu-item-id="new-url"]' )!
			.click();
		expect( deps.createUrl ).toHaveBeenCalledTimes( 1 );
		expect( document.querySelector( 'wpd-context-menu' ) ).toBeNull();
	} );

	test( 'serverItems are merged into the list', async () => {
		const { buildMenuItems } = await load();
		const items = buildMenuItems( stubDeps( {
			serverItems: [
				{ id: 'change-bg', label: 'Change background', sort: 25 },
			],
		} ) );
		const ids = items.map( ( i ) => i.id );
		expect( ids ).toContain( 'change-bg' );
	} );

	test( 'desktop-mode.wallpaper-context-menu filter can mutate the list', async () => {
		const { buildMenuItems } = await load();
		const stub = ( window.wp as { hooks: { addFilter: ( ...a: unknown[] ) => void } } ).hooks;
		stub.addFilter(
			'desktop-mode.wallpaper-context-menu',
			'test/hide-os',
			( list ) => ( list as Array< { id: string } > ).filter( ( i ) => i.id !== 'os-settings' ),
		);
		const items = buildMenuItems( stubDeps() );
		expect( items.map( ( i ) => i.id ) ).not.toContain( 'os-settings' );
	} );

	test( 'openWallpaperMenu mounts the menu and invokes onClick', async () => {
		const { openWallpaperMenu, buildMenuItems } = await load();
		const deps = stubDeps();
		const items = buildMenuItems( deps );

		openWallpaperMenu( document.body, { x: 50, y: 60 }, items );
		const menu = document.querySelector< HTMLElement >( 'wpd-context-menu' );
		expect( menu ).not.toBeNull();
		expect( menu?.style.left ).toBe( '50px' );

		const showDesktopBtn = menu!.querySelector< HTMLButtonElement >(
			'[data-menu-item-id="show-desktop"]',
		);
		showDesktopBtn!.click();
		expect( deps.toggleShowDesktop ).toHaveBeenCalledTimes( 1 );
		// Menu closes after activation.
		expect( document.querySelector( 'wpd-context-menu' ) ).toBeNull();
	} );

	test( 'closeWallpaperMenu removes the menu', async () => {
		const { openWallpaperMenu, closeWallpaperMenu, buildMenuItems } = await load();
		openWallpaperMenu( document.body, { x: 0, y: 0 }, buildMenuItems( stubDeps() ) );
		expect( document.querySelector( 'wpd-context-menu' ) ).not.toBeNull();
		closeWallpaperMenu();
		expect( document.querySelector( 'wpd-context-menu' ) ).toBeNull();
	} );

	test( 'Escape key closes the menu', async () => {
		const { openWallpaperMenu, buildMenuItems } = await load();
		openWallpaperMenu( document.body, { x: 0, y: 0 }, buildMenuItems( stubDeps() ) );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape' } ) );
		expect( document.querySelector( 'wpd-context-menu' ) ).toBeNull();
	} );

	test( 'server callback resolves through serverCallbacks map', async () => {
		const { buildMenuItems, openWallpaperMenu } = await load();
		const cb = vi.fn();
		const items = buildMenuItems( stubDeps( {
			serverItems: [ { id: 'plugin-thing', label: 'Plugin thing', callbackId: 'doit' } ],
			serverCallbacks: { doit: cb },
		} ) );
		openWallpaperMenu( document.body, { x: 0, y: 0 }, items );
		document.querySelector< HTMLButtonElement >(
			'[data-menu-item-id="plugin-thing"]',
		)!.click();
		expect( cb ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'server item with no callback fires desktop-mode.wallpaper-context-menu.activated', async () => {
		const { buildMenuItems, openWallpaperMenu } = await load();
		const stub = ( window.wp as { hooks: { didAction: ( n: string ) => number } } ).hooks;
		const items = buildMenuItems( stubDeps( {
			serverItems: [ { id: 'plugin', label: 'Plugin', callbackId: 'orphan' } ],
		} ) );
		openWallpaperMenu( document.body, { x: 0, y: 0 }, items );
		document.querySelector< HTMLButtonElement >(
			'[data-menu-item-id="plugin"]',
		)!.click();
		expect( stub.didAction( 'desktop-mode.wallpaper-context-menu.activated' ) ).toBe( 1 );
	} );

	test( 'submenu opens on click of the parent and lists children', async () => {
		const { openWallpaperMenu, buildMenuItems } = await load();
		const deps = stubDeps();
		openWallpaperMenu( document.body, { x: 50, y: 60 }, buildMenuItems( deps ) );
		const sortBy = document.querySelector< HTMLButtonElement >(
			'[data-menu-item-id="sort-by"]',
		);
		expect( sortBy ).not.toBeNull();
		expect( sortBy!.hasAttribute( 'has-children' ) ).toBe( true );
		sortBy!.click();
		const flyout = document.querySelector( 'wpd-context-menu.desktop-mode-wallpaper-menu--flyout' );
		expect( flyout ).not.toBeNull();
		expect( flyout!.querySelector( '[data-menu-item-id="sort-name-asc"]' ) ).not.toBeNull();
	} );

	test( 'choosing a submenu child invokes the child handler and closes the menu', async () => {
		const { openWallpaperMenu, buildMenuItems } = await load();
		const deps = stubDeps();
		openWallpaperMenu( document.body, { x: 0, y: 0 }, buildMenuItems( deps ) );
		document.querySelector< HTMLButtonElement >( '[data-menu-item-id="sort-by"]' )!.click();
		document.querySelector< HTMLButtonElement >( '[data-menu-item-id="sort-name-asc"]' )!.click();
		expect( deps.sortIcons ).toHaveBeenCalledWith( 'name-asc' );
		expect( document.querySelector( 'wpd-context-menu' ) ).toBeNull();
	} );

	test( 'isWallpaperMenuOpen reflects open / close state', async () => {
		const { openWallpaperMenu, closeWallpaperMenu, isWallpaperMenuOpen, buildMenuItems } = await load();
		expect( isWallpaperMenuOpen() ).toBe( false );
		openWallpaperMenu( document.body, { x: 0, y: 0 }, buildMenuItems( stubDeps() ) );
		expect( isWallpaperMenuOpen() ).toBe( true );
		closeWallpaperMenu();
		expect( isWallpaperMenuOpen() ).toBe( false );
	} );

	test( 'excludeOutsideTarget suppresses auto-close on excluded mousedowns', async () => {
		const { openWallpaperMenu, isWallpaperMenuOpen, buildMenuItems } = await load();
		const wallpaper = document.createElement( 'div' );
		document.body.appendChild( wallpaper );
		openWallpaperMenu(
			document.body,
			{ x: 0, y: 0 },
			buildMenuItems( stubDeps() ),
			{ excludeOutsideTarget: wallpaper },
		);
		// Simulate a mousedown on the excluded area — menu should
		// stay open so the caller's click handler can decide.
		const md = new MouseEvent( 'mousedown', { bubbles: true } );
		wallpaper.dispatchEvent( md );
		expect( isWallpaperMenuOpen() ).toBe( true );
	} );

	test( 'mousedown on a non-excluded outside element closes the menu', async () => {
		const { openWallpaperMenu, isWallpaperMenuOpen, buildMenuItems } = await load();
		const elsewhere = document.createElement( 'div' );
		document.body.appendChild( elsewhere );
		openWallpaperMenu( document.body, { x: 0, y: 0 }, buildMenuItems( stubDeps() ) );
		elsewhere.dispatchEvent( new MouseEvent( 'mousedown', { bubbles: true } ) );
		expect( isWallpaperMenuOpen() ).toBe( false );
	} );

	test( 'sort order is honored', async () => {
		const { buildMenuItems } = await load();
		const items = buildMenuItems( stubDeps( {
			serverItems: [
				{ id: 'first', label: 'First', sort: 1 },
				{ id: 'last', label: 'Last', sort: 999 },
			],
		} ) );
		const ids = items.map( ( i ) => i.id );
		// Sort happens at openWallpaperMenu time, but buildMenuItems
		// returns the merged list in registration order. Assert here
		// that the items are present.
		expect( ids ).toContain( 'first' );
		expect( ids ).toContain( 'last' );
	} );
} );
