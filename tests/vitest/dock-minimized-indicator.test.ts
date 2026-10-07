import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Dock, type DockItem } from '../../src/dock';
import { HOOKS } from '../../src/hooks';
import type { WindowManager } from '../../src/window-manager';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

interface WinStub {
	id: string;
	state: 'normal' | 'minimized' | 'maximized';
	config: { title?: string; icon?: string; baseId: string; desktopId?: string };
}

function makeWin( id: string, baseId: string, state: WinStub[ 'state' ] = 'normal' ): WinStub {
	return {
		id,
		state,
		config: { title: id, icon: 'dashicons-admin-post', baseId },
	};
}

function makeManager( windows: WinStub[], focused: WinStub | null = null ) {
	return {
		getFocused: () => focused,
		getAll: () => windows,
		getAllByBaseId: ( baseId: string ) =>
			windows.filter( ( w ) => w.config.baseId === baseId ),
		getById: ( id: string ) => windows.find( ( w ) => w.id === id ),
		getActiveDesktopId: () => 'default-1',
	} as unknown as WindowManager;
}

function makeItem( overrides: Partial< DockItem > = {} ): DockItem {
	return {
		id: 'menu-posts',
		title: 'Posts',
		icon: 'dashicons-admin-post',
		url: 'http://localhost/wp-admin/edit.php',
		badge: 0,
		submenu: [],
		multi: true,
		windowId: 'edit-php',
		...overrides,
	};
}

function mount( manager: WindowManager, items: DockItem[] = [ makeItem() ] ) {
	const container = document.createElement( 'nav' );
	document.body.appendChild( container );
	const dock = new Dock(
		container,
		manager,
		items,
		'http://localhost/wp-admin/',
		'bottom',
	);
	return { container, dock };
}

function tileFor( container: HTMLElement, id: string ): HTMLElement {
	const el = container.querySelector< HTMLElement >( `[data-menu-slug="${ id }"]` );
	if ( ! el ) {
		throw new Error( `tile not found for ${ id }` );
	}
	return el;
}

describe( 'Dock — minimized window indicator', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
		document.body.className = '';
	} );

	test( '--active applies when a tile has a non-minimized window; no --all-minimized', () => {
		const win = makeWin( 'edit-php', 'edit-php', 'normal' );
		const manager = makeManager( [ win ] );
		const { container } = mount( manager );

		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect( tile.classList.contains( 'os-dock__item--active' ) ).toBe( true );
		expect(
			tile.classList.contains( 'os-dock__item--all-minimized' ),
		).toBe( false );
	} );

	test( '--all-minimized applies when every instance of the tile is minimized', () => {
		const wins = [
			makeWin( 'edit-php', 'edit-php', 'minimized' ),
			makeWin( 'edit-php-2', 'edit-php', 'minimized' ),
		];
		const manager = makeManager( wins );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect( tile.classList.contains( 'os-dock__item--active' ) ).toBe( true );
		expect(
			tile.classList.contains( 'os-dock__item--all-minimized' ),
		).toBe( true );
	} );

	test( 'partial minimize keeps the solid dot — one normal + one minimized → NOT --all-minimized', () => {
		const wins = [
			makeWin( 'edit-php', 'edit-php', 'normal' ),
			makeWin( 'edit-php-2', 'edit-php', 'minimized' ),
		];
		const manager = makeManager( wins );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect( tile.classList.contains( 'os-dock__item--active' ) ).toBe( true );
		expect(
			tile.classList.contains( 'os-dock__item--all-minimized' ),
		).toBe( false );
	} );

	test( 'partial minimize sets --stacked when ≥2 instances exist', () => {
		const normal = makeWin( 'edit-php', 'edit-php', 'normal' );
		const minimized = makeWin( 'edit-php-2', 'edit-php', 'minimized' );
		const minimized2 = makeWin( 'edit-php-3', 'edit-php', 'minimized' );
		const manager = makeManager( [ normal, minimized, minimized2 ], normal );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect( tile.classList.contains( 'os-dock__item--focused' ) ).toBe( true );
		expect( tile.classList.contains( 'os-dock__item--stacked' ) ).toBe( true );
		expect(
			tile.classList.contains( 'os-dock__item--all-minimized' ),
		).toBe( false );
	} );

	test( 'single minimized window with one normal does set --stacked (2 instances)', () => {
		const normal = makeWin( 'edit-php', 'edit-php', 'normal' );
		const minimized = makeWin( 'edit-php-2', 'edit-php', 'minimized' );
		const manager = makeManager( [ normal, minimized ], normal );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect( tile.classList.contains( 'os-dock__item--stacked' ) ).toBe( true );
	} );

	test( '--stacked stays after restore when multiple instances remain', () => {
		const win1 = makeWin( 'edit-php', 'edit-php', 'minimized' );
		const win2 = makeWin( 'edit-php-2', 'edit-php', 'minimized' );
		const manager = makeManager( [ win1, win2 ] );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect( tile.classList.contains( 'os-dock__item--stacked' ) ).toBe( true );

		win1.state = 'normal';
		win2.state = 'normal';
		window.wp?.hooks?.doAction?.( HOOKS.WINDOW_RESTORED );
		document.dispatchEvent( new CustomEvent( 'os-window-restored' ) );

		expect( tile.classList.contains( 'os-dock__item--stacked' ) ).toBe( true );
	} );

	test( '--stacked shows for multiple open (non-minimized) instances', () => {
		const win1 = makeWin( 'edit-php', 'edit-php', 'normal' );
		const win2 = makeWin( 'edit-php-2', 'edit-php', 'normal' );
		const manager = makeManager( [ win1, win2 ] );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect( tile.classList.contains( 'os-dock__item--stacked' ) ).toBe( true );
	} );

	test( 'focused tile loses --focused when its window is minimized', () => {
		const win = makeWin( 'edit-php', 'edit-php', 'minimized' );
		const manager = makeManager( [ win ], win );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );

		expect( tile.classList.contains( 'os-dock__item--focused' ) ).toBe( false );
	} );

	test( 'body gets os-show-desktop-active when every live window is minimized', () => {
		const wins = [
			makeWin( 'edit-php', 'edit-php', 'minimized' ),
			makeWin( 'options-general', 'options-general', 'minimized' ),
		];
		const manager = makeManager( wins );
		mount( manager, [
			makeItem(),
			makeItem( {
				id: 'menu-settings',
				title: 'Settings',
				url: 'http://localhost/wp-admin/options-general.php',
				windowId: 'options-general',
				multi: false,
			} ),
		] );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		expect(
			document.body.classList.contains( 'os-show-desktop-active' ),
		).toBe( true );
	} );

	test( 'body class clears when any window is no longer minimized', () => {
		const wins = [
			makeWin( 'edit-php', 'edit-php', 'minimized' ),
			makeWin( 'options-general', 'options-general', 'minimized' ),
		];
		const manager = makeManager( wins );
		mount( manager, [
			makeItem(),
			makeItem( {
				id: 'menu-settings',
				title: 'Settings',
				url: 'http://localhost/wp-admin/options-general.php',
				windowId: 'options-general',
				multi: false,
			} ),
		] );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );
		expect(
			document.body.classList.contains( 'os-show-desktop-active' ),
		).toBe( true );

		wins[ 0 ].state = 'normal';
		window.wp?.hooks?.doAction?.( HOOKS.WINDOW_RESTORED, { windowId: 'edit-php' } );
		expect(
			document.body.classList.contains( 'os-show-desktop-active' ),
		).toBe( false );
	} );

	test( 'no body class when there are zero live windows (fresh desktop)', () => {
		const manager = makeManager( [] );
		mount( manager );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		expect(
			document.body.classList.contains( 'os-show-desktop-active' ),
		).toBe( false );
	} );

	test( 'dock listens to WINDOW_MINIMIZED via the hook bus, not just DOM events', () => {

		const win = makeWin( 'edit-php', 'edit-php', 'normal' );
		const manager = makeManager( [ win ] );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect(
			tile.classList.contains( 'os-dock__item--all-minimized' ),
		).toBe( false );

		win.state = 'minimized';
		window.wp?.hooks?.doAction?.( HOOKS.WINDOW_MINIMIZED, { windowId: 'edit-php' } );

		expect(
			tile.classList.contains( 'os-dock__item--all-minimized' ),
		).toBe( true );
	} );

	test( 'a tile whose target is a window lights up from windowId, not from its url', () => {

		const win = makeWin( 'os-settings', 'os-settings', 'normal' );
		const manager = makeManager( [ win ] );
		const item: DockItem = {
			id: 'os-settings',
			title: 'OS Settings',
			icon: 'dashicons-admin-generic',
			url: '',
			windowId: 'os-settings',
			badge: 0,
			submenu: [],
			multi: false,
		};
		const { container } = mount( manager, [ item ] );
		document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );

		const tile = tileFor( container, 'os-settings' );
		expect( tile.classList.contains( 'os-dock__item--active' ) ).toBe( true );
	} );
} );
