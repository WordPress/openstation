/**
 * Tests for `src/dock-constellation` — the hover-submenu flyout that
 * gives the OpenStation desktop layout its reason to exist.
 *
 * What is pinned here is the CONTRACT, not the choreography:
 *
 * - It only fans out while `data-os-layout="openstation"`. Every
 *   other layout keeps the hover-peek, and the peek's stand-down
 *   check reads the same predicate, so a regression in either
 *   direction shows up as two popovers on one tile or none.
 * - It surfaces the submenu — the whole point. A menu with children
 *   gets one row per child, wired to the same window ids a dock click
 *   would address.
 * - It is delegated, so a tile rebuilt by a live menu refresh still
 *   works without re-mounting anything.
 * - Keyboard reaches it: ArrowUp from a tile fans it open and lands
 *   focus on the first row; Escape collapses it and hands focus back.
 *
 * Timers are faked because the flyout deliberately dwells before it
 * opens — a hover that fired instantly would fan a panel out every
 * time the pointer crossed the rail on its way somewhere else.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { mountDockConstellation } from '../../src/dock-constellation';
import { isConstellationLayoutActive } from '../../src/dock-constellation/active';
import type { DockItem } from '../../src/dock';
import type { WindowManager } from '../../src/window-manager';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

const appearance: DockItem = {
	id: 'themes.php',
	title: 'Appearance',
	icon: 'dashicons-admin-appearance',
	url: '/wp-admin/themes.php',
	badge: 0,
	isCore: true,
	multi: false,
	submenu: [
		{ title: 'Themes', url: '/wp-admin/themes.php' },
		{ title: 'Editor', url: '/wp-admin/site-editor.php' },
	],
};

const settings: DockItem = {
	id: 'options-general.php',
	title: 'Settings',
	icon: 'dashicons-admin-settings',
	url: '/wp-admin/options-general.php',
	badge: 0,
	isCore: true,
	multi: false,
	submenu: [ { title: 'Writing', url: '/wp-admin/options-writing.php' } ],
};

const opened: Array< Record< string, unknown > > = [];

function makeManagerStub(): WindowManager {
	return {
		getAllByBaseIdOnActiveDesktop: () => [],
		getActiveDesktopId: () => 'default-1',
		getFocused: () => null,
		getById: () => undefined,
		focus: () => {},
		open: ( cfg: Record< string, unknown > ) => {
			opened.push( cfg );
		},
		openNew: ( cfg: Record< string, unknown > ) => {
			opened.push( cfg );
			return Promise.resolve( null );
		},
	} as unknown as WindowManager;
}

/** Build a shell with one menu tile on the bottom rail. */
function setupShell( layout: string ): HTMLElement {
	document.body.innerHTML = '';
	const shell = document.createElement( 'div' );
	shell.className = 'os-shell';
	shell.setAttribute( 'data-os-layout', layout );

	const dock = document.createElement( 'nav' );
	dock.className = 'os-dock';
	dock.setAttribute( 'data-os-dock-placement', 'bottom' );

	const tile = document.createElement( 'div' );
	tile.className = 'os-dock__item';
	tile.dataset.menuSlug = 'themes.php';
	const primary = document.createElement( 'button' );
	primary.className = 'os-dock__item-primary';
	tile.appendChild( primary );

	dock.appendChild( tile );
	shell.appendChild( dock );
	document.body.appendChild( shell );
	return tile;
}

/**
 * jsdom ships no `PointerEvent`, so synthesize one: a bubbling
 * `Event` with `pointerType` bolted on, which is the only
 * pointer-specific field the constellation reads.
 */
function pointerOver(): Event {
	const ev = new Event( 'pointerover', { bubbles: true } );
	Object.defineProperty( ev, 'pointerType', { value: 'mouse' } );
	return ev;
}

function hover( tile: HTMLElement ): void {
	tile.dispatchEvent( pointerOver() );
	vi.runOnlyPendingTimers();
	// The open transition is applied on the next frame; jsdom's rAF is
	// a timer, so flushing again lands the `--open` class too.
	vi.runOnlyPendingTimers();
}

/**
 * The LIVE panel. A dismissed panel stays in the document for the
 * length of its exit, so "is a flyout open?" has to exclude anything
 * already on its way out.
 */
function panel(): HTMLElement | null {
	return document.querySelector< HTMLElement >(
		'.os-constellation:not( .os-constellation--closing )',
	);
}

/** A panel mid-exit — present, marked, and no longer interactive. */
function ghost(): HTMLElement | null {
	return document.querySelector< HTMLElement >(
		'.os-constellation--closing',
	);
}

/** Let any in-flight exit finish and its node leave the document. */
function flushExit(): void {
	vi.runOnlyPendingTimers();
}

function rowLabels(): string[] {
	return Array.from(
		document.querySelectorAll< HTMLElement >(
			'.os-constellation__row--sub .os-constellation__row-label',
		),
	).map( ( el ) => el.textContent ?? '' );
}

describe( 'dock constellation', () => {
	let teardown: () => void;

	beforeEach( () => {
		opened.length = 0;
		installHooksStub();
		vi.useFakeTimers();
		// jsdom has no rAF by default under fake timers; route it
		// through a timer so `runOnlyPendingTimers` flushes the frame
		// the open transition waits for.
		vi.stubGlobal( 'requestAnimationFrame', ( cb: FrameRequestCallback ) =>
			setTimeout( () => cb( 0 ), 0 ) as unknown as number,
		);
	} );

	afterEach( () => {
		teardown?.();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		clearHooksStub();
		document.body.innerHTML = '';
		document.body.className = '';
	} );

	function mount(): void {
		teardown = mountDockConstellation( {
			windowManager: makeManagerStub(),
			adminUrl: '/wp-admin/',
			getMenuItems: () => [ appearance ],
		} );
	}

	test( 'is inert outside the OpenStation layout', () => {
		const tile = setupShell( 'classic' );
		mount();
		hover( tile );
		expect( panel() ).toBeNull();
		expect( isConstellationLayoutActive() ).toBe( false );
	} );

	test( 'fans out on hover and lists the submenu', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );
		expect( panel() ).not.toBeNull();
		expect( rowLabels() ).toEqual( [ 'Themes', 'Editor' ] );
		expect( panel()?.getAttribute( 'role' ) ).toBe( 'menu' );
		expect( panel()?.getAttribute( 'aria-label' ) ).toContain(
			'Appearance',
		);
		// The tile is marked so CSS can keep it lifted, and the body
		// flag mutes the dock tooltip underneath.
		expect( tile.hasAttribute( 'data-constellation-open' ) ).toBe( true );
		expect(
			document.body.classList.contains( 'os-constellation-open' ),
		).toBe( true );
	} );

	test( 'head opens the menu; a submenu row opens its child page', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );

		document
			.querySelector< HTMLElement >( '.os-constellation__head' )!
			.click();
		expect( opened.at( -1 )?.url ).toBe( '/wp-admin/themes.php' );
		expect( panel() ).toBeNull();

		hover( tile );
		const rows = document.querySelectorAll< HTMLElement >(
			'.os-constellation__row--sub',
		);
		rows[ 1 ].click();
		// `parentUrl` pins to the MENU's landing page, not the child —
		// otherwise the window's tab strip has no way back to Themes.
		expect( opened.at( -1 )?.url ).toBe( '/wp-admin/site-editor.php' );
		expect( opened.at( -1 )?.parentUrl ).toBe( '/wp-admin/themes.php' );
	} );

	test( 'offers a trailing new-window row', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );
		const newRow = document.querySelector< HTMLElement >(
			'.os-constellation__row--new',
		);
		expect( newRow?.textContent ).toContain( 'Appearance' );
		newRow!.click();
		expect( opened.at( -1 )?.multi ).toBe( true );
	} );

	test( 'ArrowUp from a tile opens it and lands focus on the first row', () => {
		const tile = setupShell( 'openstation' );
		mount();
		const primary = tile.querySelector< HTMLElement >(
			'.os-dock__item-primary',
		)!;
		primary.focus();
		primary.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'ArrowUp', bubbles: true } ),
		);
		vi.runOnlyPendingTimers();
		expect( panel() ).not.toBeNull();
		expect( document.activeElement ).toBe(
			document.querySelector( '.os-constellation__row' ),
		);
	} );

	test( 'Escape collapses the flyout and hands focus back to the tile', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );
		const row = document.querySelector< HTMLElement >(
			'.os-constellation__row',
		)!;
		row.focus();
		row.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
		);
		expect( panel() ).toBeNull();
		expect( document.activeElement ).toBe(
			tile.querySelector( '.os-dock__item-primary' ),
		);
		flushExit();
		expect(
			document.body.classList.contains( 'os-constellation-open' ),
		).toBe( false );
	} );

	describe( 'exit', () => {
		test( 'plays an exit before the node leaves the document', () => {
			const tile = setupShell( 'openstation' );
			mount();
			hover( tile );
			document
				.querySelector< HTMLElement >( '.os-constellation__head' )!
				.click();

			// No longer the live panel, but still painted — marked
			// `--closing` so CSS can run the exit, and no longer the
			// anchor's business.
			expect( panel() ).toBeNull();
			expect( ghost() ).not.toBeNull();
			expect( tile.hasAttribute( 'data-constellation-open' ) ).toBe(
				false,
			);
			// The tooltip stays muted while a panel is still visible,
			// or it pops back underneath one that is fading over it.
			expect(
				document.body.classList.contains( 'os-constellation-open' ),
			).toBe( true );

			flushExit();
			expect( ghost() ).toBeNull();
			expect(
				document.body.classList.contains( 'os-constellation-open' ),
			).toBe( false );
		} );

		test( 'rows do not animate independently while the panel leaves', () => {
			const tile = setupShell( 'openstation' );
			mount();
			hover( tile );
			document
				.querySelector< HTMLElement >( '.os-constellation__head' )!
				.click();
			// The `--open` class is what drives the per-row staggered
			// entrance; dropping it without `--closing` taking over
			// would send every row back through its own exit inside a
			// panel that is itself shrinking.
			const dying = ghost()!;
			expect( dying.classList.contains( 'os-constellation--open' ) ).toBe(
				false,
			);
			expect(
				dying.classList.contains( 'os-constellation--closing' ),
			).toBe( true );
		} );

		test( 'a hand-off to another tile cuts instead of fading', () => {
			const tile = setupShell( 'openstation' );
			const dock = document.querySelector( '.os-dock' )!;
			const other = document.createElement( 'div' );
			other.className = 'os-dock__item';
			other.dataset.menuSlug = 'options-general.php';
			other.appendChild( document.createElement( 'button' ) );
			dock.appendChild( other );

			teardown = mountDockConstellation( {
				windowManager: makeManagerStub(),
				adminUrl: '/wp-admin/',
				getMenuItems: () => [ appearance, settings ],
			} );

			hover( tile );
			expect( panel()?.getAttribute( 'aria-label' ) ).toContain(
				'Appearance',
			);
			hover( other );
			// One panel on screen, not two at two different anchors.
			expect( ghost() ).toBeNull();
			expect(
				document.querySelectorAll( '.os-constellation' ),
			).toHaveLength( 1 );
			expect( panel()?.getAttribute( 'aria-label' ) ).toContain(
				'Settings',
			);
		} );

		test( 'a stale anchor cuts too — scroll invalidates the position', () => {
			const tile = setupShell( 'openstation' );
			mount();
			hover( tile );
			document.dispatchEvent( new Event( 'scroll', { bubbles: true } ) );
			// Animating away from a tile that has already moved points
			// at nothing, so this path removes the node outright.
			expect( ghost() ).toBeNull();
			expect( panel() ).toBeNull();
		} );

		test( 'teardown takes an in-flight exit with it', () => {
			const tile = setupShell( 'openstation' );
			mount();
			hover( tile );
			document
				.querySelector< HTMLElement >( '.os-constellation__head' )!
				.click();
			expect( ghost() ).not.toBeNull();
			teardown();
			expect( document.querySelector( '.os-constellation' ) ).toBeNull();
			expect(
				document.body.classList.contains( 'os-constellation-open' ),
			).toBe( false );
		} );
	} );

	test( 'survives a tile rebuilt under it — the listener is delegated', () => {
		setupShell( 'openstation' );
		mount();
		// Simulate a live menu refresh: throw the rail's tiles away and
		// build a fresh one. A per-tile listener would be gone by now.
		const dock = document.querySelector( '.os-dock' )!;
		dock.innerHTML = '';
		const rebuilt = document.createElement( 'div' );
		rebuilt.className = 'os-dock__item';
		rebuilt.dataset.menuSlug = 'themes.php';
		rebuilt.appendChild( document.createElement( 'button' ) );
		dock.appendChild( rebuilt );

		hover( rebuilt );
		expect( rowLabels() ).toEqual( [ 'Themes', 'Editor' ] );
	} );

	test( 'teardown removes the flyout and stops responding', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );
		expect( panel() ).not.toBeNull();
		teardown();
		expect( panel() ).toBeNull();
		hover( tile );
		expect( panel() ).toBeNull();
	} );
} );
