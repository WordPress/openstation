/**
 * Tests for the dock's minimized-window visual indicators:
 *
 *   - per-tile `--all-minimized` class when every open instance of a
 *     dock item is in the `minimized` state.
 *   - global `body.desktop-mode-show-desktop-active` body class when
 *     every live window on the active desktop is minimized.
 *
 * The dock previously surfaced "active" (≥1 window open) and "focused"
 * (the focused window belongs to this tile) but had no cue for the
 * canonical Show Desktop / minimized-all state — every window vanished
 * from the desktop and the dock told the user nothing.
 *
 * @group dock
 */
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

/**
 * Hand-rolled manager stub. Real WindowManager carries far more
 * surface than the dock touches, so a fixture-driven stub keeps the
 * test focused — the dock reads `getAll`, `getAllByBaseId`,
 * `getById`, `getFocused`, `getActiveDesktopId`. Anything else means
 * the dock grew a dependency we should re-read here.
 */
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
		// Trigger a refresh — boot doesn't auto-paint active classes,
		// the first window-opened event does. Synthesize one.
		document.dispatchEvent( new CustomEvent( 'desktop-mode-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect( tile.classList.contains( 'desktop-mode-dock__item--active' ) ).toBe( true );
		expect(
			tile.classList.contains( 'desktop-mode-dock__item--all-minimized' ),
		).toBe( false );
	} );

	test( '--all-minimized applies when every instance of the tile is minimized', () => {
		const wins = [
			makeWin( 'edit-php', 'edit-php', 'minimized' ),
			makeWin( 'edit-php-2', 'edit-php', 'minimized' ),
		];
		const manager = makeManager( wins );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'desktop-mode-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect( tile.classList.contains( 'desktop-mode-dock__item--active' ) ).toBe( true );
		expect(
			tile.classList.contains( 'desktop-mode-dock__item--all-minimized' ),
		).toBe( true );
	} );

	test( 'partial minimize keeps the solid dot — one normal + one minimized → NOT --all-minimized', () => {
		const wins = [
			makeWin( 'edit-php', 'edit-php', 'normal' ),
			makeWin( 'edit-php-2', 'edit-php', 'minimized' ),
		];
		const manager = makeManager( wins );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'desktop-mode-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect( tile.classList.contains( 'desktop-mode-dock__item--active' ) ).toBe( true );
		expect(
			tile.classList.contains( 'desktop-mode-dock__item--all-minimized' ),
		).toBe( false );
	} );

	test( 'focused tile loses --focused when its window is minimized', () => {
		const win = makeWin( 'edit-php', 'edit-php', 'minimized' );
		const manager = makeManager( [ win ], win );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'desktop-mode-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		// `--focused` would otherwise paint a pill that says "this is
		// the visible window" — misleading while the window is hidden.
		expect( tile.classList.contains( 'desktop-mode-dock__item--focused' ) ).toBe( false );
	} );

	test( 'body gets desktop-mode-show-desktop-active when every live window is minimized', () => {
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
		document.dispatchEvent( new CustomEvent( 'desktop-mode-window-opened' ) );

		expect(
			document.body.classList.contains( 'desktop-mode-show-desktop-active' ),
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
		document.dispatchEvent( new CustomEvent( 'desktop-mode-window-opened' ) );
		expect(
			document.body.classList.contains( 'desktop-mode-show-desktop-active' ),
		).toBe( true );

		// Simulate the user restoring one of the two minimized windows.
		wins[ 0 ].state = 'normal';
		window.wp?.hooks?.doAction?.( HOOKS.WINDOW_RESTORED, { windowId: 'edit-php' } );
		expect(
			document.body.classList.contains( 'desktop-mode-show-desktop-active' ),
		).toBe( false );
	} );

	test( 'no body class when there are zero live windows (fresh desktop)', () => {
		const manager = makeManager( [] );
		mount( manager );
		document.dispatchEvent( new CustomEvent( 'desktop-mode-window-opened' ) );

		// Show Desktop is meaningless with nothing to hide — the body
		// class would be a lie on an empty desktop.
		expect(
			document.body.classList.contains( 'desktop-mode-show-desktop-active' ),
		).toBe( false );
	} );

	test( 'dock listens to WINDOW_MINIMIZED via the hook bus, not just DOM events', () => {
		// Reproduces the original bug: the dock only subscribed to
		// `desktop-mode-window-opened/closed/focused` DOM events.
		// `WINDOW_MINIMIZED` rides the hook bus exclusively, so a
		// minimize without an accompanying focus change left the dock
		// stale. This assertion fails if a regression drops that hook
		// subscription.
		const win = makeWin( 'edit-php', 'edit-php', 'normal' );
		const manager = makeManager( [ win ] );
		const { container } = mount( manager );
		document.dispatchEvent( new CustomEvent( 'desktop-mode-window-opened' ) );

		const tile = tileFor( container, 'menu-posts' );
		expect(
			tile.classList.contains( 'desktop-mode-dock__item--all-minimized' ),
		).toBe( false );

		// Minimize via the hook bus (the only channel the framework
		// publishes minimize on).
		win.state = 'minimized';
		window.wp?.hooks?.doAction?.( HOOKS.WINDOW_MINIMIZED, { windowId: 'edit-php' } );

		expect(
			tile.classList.contains( 'desktop-mode-dock__item--all-minimized' ),
		).toBe( true );
	} );

	test( 'dock: prefixed items resolve target window baseId from desktop icon config', () => {
		( window as unknown as { desktopModeConfig?: { desktopIcons?: Array<{ id: string; window?: string }> } } ).desktopModeConfig = {
			desktopIcons: [ { id: 'os-settings', window: 'desktop-mode-settings' } ],
		};

		const win = makeWin( 'desktop-mode-settings', 'desktop-mode-settings', 'normal' );
		const manager = makeManager( [ win ] );
		const item: DockItem = {
			id: 'dock:os-settings',
			title: 'OS Settings',
			icon: 'dashicons-admin-generic',
			url: '',
			badge: 0,
			submenu: [],
			multi: false,
		};
		const { container } = mount( manager, [ item ] );
		document.dispatchEvent( new CustomEvent( 'desktop-mode-window-opened' ) );

		const tile = tileFor( container, 'dock:os-settings' );
		expect( tile.classList.contains( 'desktop-mode-dock__item--active' ) ).toBe( true );
	} );
} );
