/**
 * Tests for dock decks — the bottom rail folding its three clusters
 * (WordPress core menus, plugin apps, OpenStation system tiles) into
 * one-at-a-time groups with a tab strip at its leading edge.
 *
 * The behaviours pinned here are the ones that would silently lose
 * tiles if they broke:
 *
 *   - only the active deck's tiles are on screen, and every other one
 *     is reachable from the strip;
 *   - a rail with fewer than two non-empty decks paints exactly as it
 *     did before decks existed (no strip, nothing hidden);
 *   - vertical rails are never decked;
 *   - the state a hidden deck carries — an open window, a badge count
 *     — surfaces on its tab rather than disappearing with it;
 *   - `destroy()` puts every tile back, because a layout flip reuses
 *     the tiles it was holding.
 *
 * @group dock
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Dock, type DockItem, type SystemDockItem } from '../../src/dock';
import { DOCK_DECK_STORAGE_KEY, type DockDeck } from '../../src/dock-decks';
import { HOOKS } from '../../src/hooks';
import type { WindowManager } from '../../src/window-manager';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

interface WinStub {
	id: string;
	state: 'normal' | 'minimized' | 'maximized';
	config: { title?: string; baseId: string; desktopId?: string; url?: string };
}

function makeManager( windows: WinStub[] = [], focused: WinStub | null = null ) {
	return {
		getFocused: () => focused,
		getAll: () => windows,
		getAllByBaseId: ( baseId: string ) =>
			windows.filter( ( w ) => w.config.baseId === baseId ),
		getAllByBaseIdOnActiveDesktop: ( baseId: string ) =>
			windows.filter( ( w ) => w.config.baseId === baseId ),
		getById: ( id: string ) => windows.find( ( w ) => w.id === id ),
		getActiveDesktopId: () => 'default-1',
	} as unknown as WindowManager;
}

function coreItem( id: string, title = id ): DockItem {
	return {
		id,
		title,
		icon: 'dashicons-admin-post',
		url: `http://localhost/wp-admin/${ id }.php`,
		badge: 0,
		submenu: [],
		isCore: true,
	};
}

function pluginItem( id: string, badge = 0 ): DockItem {
	return {
		id,
		title: id,
		icon: 'dashicons-admin-generic',
		url: `http://localhost/wp-admin/admin.php?page=${ id }`,
		badge,
		submenu: [],
		isCore: false,
	};
}

function systemTile( id: string ): SystemDockItem {
	return {
		id,
		title: id,
		icon: 'dashicons-admin-settings',
		onOpen: () => undefined,
	};
}

interface Mounted {
	container: HTMLElement;
	dock: Dock;
}

function mount(
	items: DockItem[],
	system: SystemDockItem[] = [],
	orientation: 'bottom' | 'left' = 'bottom',
	manager: WindowManager = makeManager(),
): Mounted {
	const container = document.createElement( 'nav' );
	container.id = 'os-dock';
	document.body.appendChild( container );
	const dock = new Dock(
		container,
		manager,
		items,
		'http://localhost/wp-admin/',
		orientation,
	);
	for ( const tile of system ) {
		dock.appendSystemItem( tile );
	}
	return { container, dock };
}

/** Tabs currently on the strip, in DOM order. */
function tabIds( container: HTMLElement ): string[] {
	return [
		...container.querySelectorAll< HTMLElement >( '.os-dock__deck' ),
	].map( ( t ) => t.dataset.deck ?? '' );
}

function tab( container: HTMLElement, deckId: string ): HTMLElement {
	const el = container.querySelector< HTMLElement >(
		`.os-dock__deck[data-deck="${ deckId }"]`,
	);
	if ( ! el ) {
		throw new Error( `No deck tab for "${ deckId }"` );
	}
	return el;
}

/** Tile ids that are actually on screen (not folded away by a deck). */
function visibleTileIds( container: HTMLElement ): string[] {
	return [
		...container.querySelectorAll< HTMLElement >(
			'.os-dock__item:not(.os-dock__item--deck-off)',
		),
	].map( ( el ) => el.dataset.menuSlug ?? el.dataset.systemId ?? '' );
}

let hooks: FakeWpHooks;
let mounted: Mounted | null = null;
let shell: HTMLElement;

/**
 * Stand in for `wp.os.getOsSettings()`. The Favorites deck reads the
 * starred list off the live snapshot rather than being handed one, so
 * a test that wants favourites publishes them here.
 */
function stubOsSettings( snapshot: { dockFavorites?: string[] } ): void {
	const w = window as unknown as {
		wp: { os?: { getOsSettings?: () => unknown } };
	};
	w.wp.os = { getOsSettings: () => snapshot };
}

beforeEach( () => {
	hooks = installHooksStub();
	window.localStorage.clear();
	// Decks are opt-in. `OsSettings.apply()` writes this attribute;
	// every test below is about a rail the user HAS opted in, so the
	// harness sets it and the "opted out" describe clears it.
	shell = document.createElement( 'div' );
	shell.id = 'os-shell';
	shell.setAttribute( 'data-os-decks', '1' );
	document.body.appendChild( shell );
} );

afterEach( () => {
	mounted?.dock.destroy();
	mounted?.container.remove();
	mounted = null;
	document.body.innerHTML = '';
	clearHooksStub();
	window.localStorage.clear();
} );

describe( 'partitioning', () => {
	test( 'a bottom rail with all three clusters gets all three tabs', () => {
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woocommerce' ) ],
			[ systemTile( 'os-settings' ) ],
		);
		expect( tabIds( mounted.container ) ).toEqual( [
			'wordpress',
			'apps',
			'station',
		] );
	} );

	test( 'only the active deck is on screen', () => {
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woocommerce' ) ],
			[ systemTile( 'os-settings' ) ],
		);
		expect( visibleTileIds( mounted.container ) ).toEqual( [ 'edit-php' ] );
		expect( mounted.container.dataset.osDeckActive ).toBe( 'wordpress' );
	} );

	test( 'every hidden tile is one tab click away', () => {
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woocommerce' ) ],
			[ systemTile( 'os-settings' ) ],
		);
		tab( mounted.container, 'apps' ).click();
		expect( visibleTileIds( mounted.container ) ).toEqual( [ 'woocommerce' ] );

		tab( mounted.container, 'station' ).click();
		expect( visibleTileIds( mounted.container ) ).toEqual( [ 'os-settings' ] );

		tab( mounted.container, 'wordpress' ).click();
		expect( visibleTileIds( mounted.container ) ).toEqual( [ 'edit-php' ] );
	} );

	test( 'a collapsed tile is inert, not merely invisible', () => {
		// A folded tile is zero pixels wide and fully transparent, but
		// its button is still a button. Without `inert`, tabbing
		// through the shell walks every tile on every deck — the tiles
		// are gone from the screen and still in the tab order, which
		// is the worst of both.
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woo' ) ] );
		const core = mounted.container.querySelector< HTMLElement >(
			'[data-menu-slug="edit-php"]',
		);
		const plugin = mounted.container.querySelector< HTMLElement >(
			'[data-menu-slug="woo"]',
		);
		expect( core?.inert ).toBe( false );
		expect( plugin?.inert ).toBe( true );

		tab( mounted.container, 'apps' ).click();
		expect( core?.inert ).toBe( true );
		expect( plugin?.inert ).toBe( false );

		// And a rail that stops being decked hands every tile back —
		// a leftover `inert` is the half no stylesheet could undo.
		mounted.dock.destroy();
		expect( core?.inert ).toBe( false );
		expect( plugin?.inert ).toBe( false );
	} );

	test( 'an unclassified item counts as core, matching the old separator', () => {
		const loose: DockItem = { ...coreItem( 'mystery' ) };
		delete loose.isCore;
		mounted = mount( [ loose ], [ systemTile( 'os-settings' ) ] );
		expect( tabIds( mounted.container ) ).toEqual( [ 'wordpress', 'station' ] );
		expect( visibleTileIds( mounted.container ) ).toEqual( [ 'mystery' ] );
	} );
} );

describe( 'the opt-in', () => {
	test( 'no attribute at all means no decks', () => {
		shell.removeAttribute( 'data-os-decks' );
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woocommerce' ) ],
			[ systemTile( 'os-settings' ) ],
		);
		expect( tabIds( mounted.container ) ).toEqual( [] );
		expect( mounted.container.dataset.osDeckActive ).toBeUndefined();
		expect( visibleTileIds( mounted.container ) ).toEqual( [
			'edit-php',
			'woocommerce',
			'os-settings',
		] );
	} );

	test( 'opting out mid-session puts every tile back and clears the stamps', () => {
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woocommerce' ) ],
			[ systemTile( 'os-settings' ) ],
		);
		expect( tabIds( mounted.container ) ).toHaveLength( 3 );

		// What `OsSettings.apply()` writes, followed by what the
		// dispatcher's refresh does.
		shell.setAttribute( 'data-os-decks', '0' );
		mounted.dock.replaceItems( [
			coreItem( 'edit-php' ),
			pluginItem( 'woocommerce' ),
		] );

		expect( tabIds( mounted.container ) ).toEqual( [] );
		expect( visibleTileIds( mounted.container ) ).toEqual( [
			'edit-php',
			'woocommerce',
			'os-settings',
		] );
		const tile = mounted.container.querySelector< HTMLElement >(
			'[data-menu-slug="woocommerce"]',
		);
		expect( tile?.dataset.osDeck ).toBeUndefined();
	} );

	test( 'opting back in restores the decks', () => {
		shell.setAttribute( 'data-os-decks', '0' );
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woo' ) ] );
		expect( tabIds( mounted.container ) ).toEqual( [] );

		shell.setAttribute( 'data-os-decks', '1' );
		mounted.dock.replaceItems( [
			coreItem( 'edit-php' ),
			pluginItem( 'woo' ),
		] );
		expect( tabIds( mounted.container ) ).toEqual( [ 'wordpress', 'apps' ] );
	} );
} );

describe( 'favorites', () => {
	test( 'no stars means no Favorites tab', () => {
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woo' ) ] );
		expect( tabIds( mounted.container ) ).toEqual( [ 'wordpress', 'apps' ] );
	} );

	test( 'a starred tile leads the strip and leaves its old deck', () => {
		stubOsSettings( { dockFavorites: [ 'woo' ] } );
		mounted = mount( [
			coreItem( 'edit-php' ),
			pluginItem( 'woo' ),
			pluginItem( 'jetpack' ),
		] );
		expect( tabIds( mounted.container ) ).toEqual( [
			'favorites',
			'wordpress',
			'apps',
		] );
		// Favorites is first in `order`, so it is also the deck the
		// rail opens on — and `woo` is no longer under Apps.
		expect( visibleTileIds( mounted.container ) ).toEqual( [ 'woo' ] );
		tab( mounted.container, 'apps' ).click();
		expect( visibleTileIds( mounted.container ) ).toEqual( [ 'jetpack' ] );
	} );

	test( 'a starred system tile joins them', () => {
		stubOsSettings( { dockFavorites: [ 'os-settings' ] } );
		mounted = mount(
			[ coreItem( 'edit-php' ) ],
			[ systemTile( 'os-settings' ), systemTile( 'bin' ) ],
		);
		expect( tabIds( mounted.container ) ).toEqual( [
			'favorites',
			'wordpress',
			'station',
		] );
		expect( visibleTileIds( mounted.container ) ).toEqual( [ 'os-settings' ] );
	} );

	test( 'every icon in the dock opens the menu that carries the star', () => {
		// The lazy loader forwards to this global once the bundle has
		// landed; stubbing it is how we see what a right-click asked
		// for without pulling the whole overlay bundle in.
		const calls: Array< Record< string, unknown > > = [];
		( window as unknown as {
			openStationItemVisibilityMenu?: unknown;
		} ).openStationItemVisibilityMenu = {
			openItemVisibilityMenu: ( o: Record< string, unknown > ) =>
				calls.push( o ),
		};

		mounted = mount(
			[ coreItem( 'edit-php' ) ],
			[
				systemTile( 'os-settings' ),
				{ ...systemTile( 'mio' ), placeable: true },
			],
		);

		for ( const selector of [
			'[data-menu-slug="edit-php"]',
			'[data-system-id="os-settings"]',
			'[data-system-id="mio"]',
		] ) {
			mounted.container
				.querySelector( selector )
				?.dispatchEvent(
					new MouseEvent( 'contextmenu', { bubbles: true } ),
				);
		}

		expect( calls.map( ( c ) => c.id ) ).toEqual( [
			'edit-php',
			'os-settings',
			'mio',
		] );
		// A menu tile never passes the flag — undefined reads as
		// placeable. A system tile passes its own, and most of them
		// are false: Preferences is how you reach the screen that
		// would put it back.
		expect( calls.map( ( c ) => c.placeable ) ).toEqual( [
			undefined,
			false,
			true,
		] );

		delete ( window as unknown as {
			openStationItemVisibilityMenu?: unknown;
		} ).openStationItemVisibilityMenu;
	} );

	test( 'starring the only plugin menu collapses the Apps tab', () => {
		stubOsSettings( { dockFavorites: [ 'woo' ] } );
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woo' ) ] );
		expect( tabIds( mounted.container ) ).toEqual( [
			'favorites',
			'wordpress',
		] );
	} );
} );

describe( 'degrading to the undecked rail', () => {
	test( 'one non-empty deck means no strip and nothing hidden', () => {
		mounted = mount( [ coreItem( 'edit-php' ), coreItem( 'upload-php' ) ] );
		expect( tabIds( mounted.container ) ).toEqual( [] );
		expect( mounted.container.dataset.osDeckActive ).toBeUndefined();
		expect( visibleTileIds( mounted.container ) ).toEqual( [
			'edit-php',
			'upload-php',
		] );
	} );

	test( 'vertical rails are never decked', () => {
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woocommerce' ) ],
			[ systemTile( 'os-settings' ) ],
			'left',
		);
		expect( tabIds( mounted.container ) ).toEqual( [] );
		expect( visibleTileIds( mounted.container ) ).toEqual( [
			'edit-php',
			'woocommerce',
			'os-settings',
		] );
	} );

	test( 'losing a deck to a live refresh moves the rail off it', () => {
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woocommerce' ) ] );
		tab( mounted.container, 'apps' ).click();
		expect( mounted.container.dataset.osDeckActive ).toBe( 'apps' );

		// The plugin is deactivated: its menu vanishes from the payload.
		mounted.dock.replaceItems( [ coreItem( 'edit-php' ) ] );
		expect( tabIds( mounted.container ) ).toEqual( [] );
		expect( visibleTileIds( mounted.container ) ).toEqual( [ 'edit-php' ] );
	} );

	test( 'destroy puts every tile back', () => {
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woocommerce' ) ],
			[ systemTile( 'os-settings' ) ],
		);
		const tile = mounted.container.querySelector< HTMLElement >(
			'[data-menu-slug="woocommerce"]',
		);
		expect( tile?.classList.contains( 'os-dock__item--deck-off' ) ).toBe( true );
		mounted.dock.destroy();
		expect( tile?.classList.contains( 'os-dock__item--deck-off' ) ).toBe(
			false,
		);
	} );
} );

describe( 'what a hidden deck can still say', () => {
	test( 'a deck holding an open window marks its tab', () => {
		const win: WinStub = {
			id: 'w1',
			state: 'normal',
			config: { baseId: 'woocommerce' },
		};
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woocommerce' ) ],
			[],
			'bottom',
			makeManager( [ win ] ),
		);
		hooks.doAction( HOOKS.DOCK_REFRESH_ACTIVE );
		expect(
			tab( mounted.container, 'apps' ).classList.contains(
				'os-dock__deck--has-open',
			),
		).toBe( true );
		expect(
			tab( mounted.container, 'wordpress' ).classList.contains(
				'os-dock__deck--has-open',
			),
		).toBe( false );
	} );

	test( 'badges behind a hidden deck are summed onto its tab', () => {
		mounted = mount( [
			coreItem( 'edit-php' ),
			pluginItem( 'woo', 3 ),
			pluginItem( 'jetpack', 4 ),
		] );
		hooks.doAction( HOOKS.DOCK_REFRESH_ACTIVE );
		const badge = tab( mounted.container, 'apps' ).querySelector(
			'.os-dock__deck-badge',
		);
		expect( badge?.textContent ).toBe( '7' );
	} );

	test( 'the active deck does not repeat its own tiles counts', () => {
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woo', 3 ) ] );
		tab( mounted.container, 'apps' ).click();
		hooks.doAction( HOOKS.DOCK_REFRESH_ACTIVE );
		expect(
			tab( mounted.container, 'apps' ).querySelector(
				'.os-dock__deck-badge',
			),
		).toBeNull();
	} );
} );

describe( 'switching', () => {
	test( 'the tab strip is a real tablist with a roving tabindex', () => {
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woo' ) ] );
		const strip = mounted.container.querySelector( '.os-dock__decks' );
		expect( strip?.getAttribute( 'role' ) ).toBe( 'tablist' );

		const wordpress = tab( mounted.container, 'wordpress' );
		const apps = tab( mounted.container, 'apps' );
		expect( wordpress.getAttribute( 'aria-selected' ) ).toBe( 'true' );
		expect( wordpress.tabIndex ).toBe( 0 );
		expect( apps.getAttribute( 'aria-selected' ) ).toBe( 'false' );
		expect( apps.tabIndex ).toBe( -1 );

		apps.click();
		expect( apps.getAttribute( 'aria-selected' ) ).toBe( 'true' );
		expect( apps.tabIndex ).toBe( 0 );
		expect( wordpress.tabIndex ).toBe( -1 );
	} );

	test( 'arrow keys move along the strip and activate as they go', () => {
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woo' ) ],
			[ systemTile( 'os-settings' ) ],
		);
		const strip = mounted.container.querySelector( '.os-dock__decks' );
		strip?.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'ArrowRight', bubbles: true } ),
		);
		expect( mounted.container.dataset.osDeckActive ).toBe( 'apps' );

		strip?.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'End', bubbles: true } ),
		);
		expect( mounted.container.dataset.osDeckActive ).toBe( 'station' );

		// No wrap at the ends — three decks is too short a strip for a
		// keypress to fling the rail back to the other side.
		strip?.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'ArrowRight', bubbles: true } ),
		);
		expect( mounted.container.dataset.osDeckActive ).toBe( 'station' );
	} );

	test( 'a collapsed tab borrows the rail tooltip; the named one stays quiet', () => {
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woo' ) ] );
		const tooltip = document.querySelector< HTMLElement >(
			'.os-dock__tooltip',
		);
		const visible = (): boolean =>
			!! tooltip?.classList.contains( 'os-dock__tooltip--visible' );

		tab( mounted.container, 'apps' ).dispatchEvent(
			new Event( 'pointerenter' ),
		);
		expect( visible() ).toBe( true );
		expect( tooltip?.textContent ).toBe( 'Plugins' );

		tab( mounted.container, 'apps' ).dispatchEvent(
			new Event( 'pointerleave' ),
		);
		expect( visible() ).toBe( false );

		// The active tab already carries its label — a tooltip
		// repeating it is the same word twice.
		tab( mounted.container, 'wordpress' ).dispatchEvent(
			new Event( 'pointerenter' ),
		);
		expect( visible() ).toBe( false );
	} );

	test( 'the pick survives a rebuild', () => {
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woo' ) ] );
		tab( mounted.container, 'apps' ).click();
		expect(
			JSON.parse( window.localStorage.getItem( DOCK_DECK_STORAGE_KEY ) ?? '{}' ),
		).toEqual( { taskbar: 'apps' } );

		mounted.dock.destroy();
		mounted.container.remove();
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woo' ) ] );
		expect( mounted.container.dataset.osDeckActive ).toBe( 'apps' );
	} );

	test( 'a restore never overwrites the remembered pick', () => {
		window.localStorage.setItem(
			DOCK_DECK_STORAGE_KEY,
			JSON.stringify( { taskbar: 'apps' } ),
		);
		// Apps isn't on this rail, so the restore falls back — and must
		// not persist the fallback over the user's actual choice.
		mounted = mount( [ coreItem( 'edit-php' ) ], [ systemTile( 'bin' ) ] );
		expect( mounted.container.dataset.osDeckActive ).toBe( 'wordpress' );
		expect(
			JSON.parse( window.localStorage.getItem( DOCK_DECK_STORAGE_KEY ) ?? '{}' ),
		).toEqual( { taskbar: 'apps' } );
	} );

	test( 'a switch fires os.dock.deck-changed with its reason', () => {
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woo' ) ] );
		const log = recordActions( hooks, [ HOOKS.DOCK_DECK_CHANGED ] );
		tab( mounted.container, 'apps' ).click();
		expect( log ).toHaveLength( 1 );
		expect( log[ 0 ].args[ 0 ] ).toMatchObject( {
			deckId: 'apps',
			previousDeckId: 'wordpress',
			reason: 'click',
			rail: 'taskbar',
		} );
	} );
} );

describe( 'follow-focus', () => {
	const focusedWin: WinStub = {
		id: 'w1',
		state: 'normal',
		config: { baseId: 'woo' },
	};

	test( 'off by default: the rail stays where the user left it', () => {
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woo' ) ],
			[],
			'bottom',
			makeManager( [ focusedWin ], focusedWin ),
		);
		hooks.doAction( HOOKS.DOCK_REFRESH_ACTIVE );
		expect( mounted.container.dataset.osDeckActive ).toBe( 'wordpress' );
	} );

	test( 'on: the rail moves to the deck holding the focused window', () => {
		shell.setAttribute( 'data-os-deck-follow-focus', '1' );
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woo' ) ],
			[],
			'bottom',
			makeManager( [ focusedWin ], focusedWin ),
		);
		hooks.doAction( HOOKS.DOCK_REFRESH_ACTIVE );
		expect( mounted.container.dataset.osDeckActive ).toBe( 'apps' );
	} );
} );

describe( 'the os.dock.decks filter', () => {
	test( 'a plugin can rename a deck', () => {
		hooks.addFilter(
			HOOKS.DOCK_DECKS,
			'test/rename',
			( decks ) =>
				( decks as DockDeck[] ).map( ( d ) =>
					d.id === 'apps' ? { ...d, label: 'Add-ons' } : d,
				),
		);
		mounted = mount( [ coreItem( 'edit-php' ), pluginItem( 'woo' ) ] );
		expect( tab( mounted.container, 'apps' ).getAttribute( 'aria-label' ) ).toBe(
			'Add-ons',
		);
	} );

	test( 'a narrower deck registered first claims its tiles', () => {
		hooks.addFilter(
			HOOKS.DOCK_DECKS,
			'test/favourites',
			( decks ) => [
				...( decks as DockDeck[] ),
				{
					id: 'favourites',
					label: 'Favourites',
					icon: 'dashicons-star-filled',
					order: 5,
					matchItem: ( item: DockItem ) => item.id === 'edit-php',
				},
			],
		);
		mounted = mount( [ coreItem( 'edit-php' ), coreItem( 'upload-php' ) ] );
		expect( tabIds( mounted.container ) ).toEqual( [
			'favourites',
			'wordpress',
		] );
		expect( visibleTileIds( mounted.container ) ).toEqual( [ 'edit-php' ] );
	} );

	test( 'filtering every deck out turns decks off', () => {
		hooks.addFilter( HOOKS.DOCK_DECKS, 'test/none', () => [] );
		mounted = mount(
			[ coreItem( 'edit-php' ), pluginItem( 'woo' ) ],
			[ systemTile( 'os-settings' ) ],
		);
		expect( tabIds( mounted.container ) ).toEqual( [] );
		expect( visibleTileIds( mounted.container ) ).toEqual( [
			'edit-php',
			'woo',
			'os-settings',
		] );
	} );
} );

/**
 * A cascade guard, not a behaviour test.
 *
 * A collapsed tile has to give back its margin as well as its width.
 * The rule that zeroes it and the rule that sets it both live under
 * `.os-dock[data-os-deck-active]`, so at equal specificity source
 * order alone decides the winner — and when the base rule won, every
 * folded tile kept 6px it had no width to justify. With fifteen of
 * them scattered through a deck the visible icons came out unevenly
 * spaced, the phantom gap between any two being however many
 * collapsed tiles sat between them in DOM order.
 *
 * jsdom doesn't load the stylesheet, so this asserts the shape of the
 * selector rather than a computed style: the collapsed rule must
 * carry the placement attribute that lifts it to (0,4,0) and lets it
 * win wherever it is written.
 */
describe( 'the collapsed-tile rule out-specifies the base tile rule', () => {
	test( 'os-dock__item--deck-off is qualified by the placement attribute', () => {
		const css = readFileSync(
			resolve( __dirname, '../../assets/css/dock.css' ),
			'utf8',
		);
		// Every rule whose selector list mentions the collapsed class
		// and declares `margin-inline`.
		const blocks = css
			.split( '}' )
			.filter(
				( block ) =>
					block.includes( '.os-dock__item--deck-off' ) &&
					block.includes( 'margin-inline' ),
			);
		expect( blocks.length ).toBeGreaterThan( 0 );
		for ( const block of blocks ) {
			const selector = block.slice( 0, block.indexOf( '{' ) );
			expect( selector ).toContain( 'data-os-dock-placement' );
			expect( selector ).toContain( 'data-os-deck-active' );
		}
	} );
} );
