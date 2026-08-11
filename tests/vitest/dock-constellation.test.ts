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

/**
 * Hover a tile and let the flyout come up — but NOT long enough for
 * any exit or hand-off already in flight to finish. Time is advanced
 * rather than flushed precisely so a test can observe both panels
 * during a hand-off; `flushExit()` is how you get to "and then it's
 * gone".
 */
function hover( tile: HTMLElement ): void {
	tile.dispatchEvent( pointerOver() );
	// Past the show dwell (130ms), short of the exit (160) and the
	// hand-off (200).
	vi.advanceTimersByTime( 140 );
	// The open class + the slide land on the next frame; jsdom's rAF
	// is a timer here, so step once more to paint them.
	vi.advanceTimersByTime( 5 );
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

/** Let any in-flight exit or hand-off finish and its node leave. */
function flushExit(): void {
	vi.advanceTimersByTime( 400 );
}

/**
 * Query inside the LIVE panel. Every row query has to be scoped: a
 * retiring panel is still in the document with a full set of rows,
 * and an unscoped `querySelectorAll` would collect both.
 */
function rows( selector: string ): HTMLElement[] {
	const live = panel();
	if ( ! live ) {
		return [];
	}
	return Array.from( live.querySelectorAll< HTMLElement >( selector ) );
}

function rowLabels(): string[] {
	return rows(
		'.os-constellation__row--sub .os-constellation__row-label',
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

	function mountWith( items: DockItem[] ): void {
		teardown = mountDockConstellation( {
			windowManager: makeManagerStub(),
			adminUrl: '/wp-admin/',
			getMenuItems: () => items,
		} );
	}

	function mount(): void {
		mountWith( [ appearance ] );
	}

	/** Append a second menu tile to the rail. */
	function addTile( slug: string ): HTMLElement {
		const tile = document.createElement( 'div' );
		tile.className = 'os-dock__item';
		tile.dataset.menuSlug = slug;
		tile.appendChild( document.createElement( 'button' ) );
		document.querySelector( '.os-dock' )!.appendChild( tile );
		return tile;
	}

	/**
	 * jsdom reports a zero rect for every element, which would put two
	 * adjacent tiles at the same x and make "did the panel travel?"
	 * unanswerable. Give a tile a real box.
	 */
	function placeTile( tile: HTMLElement, left: number ): void {
		Object.defineProperty( tile, 'getBoundingClientRect', {
			configurable: true,
			value: () => ( {
				left,
				right: left + 40,
				top: 600,
				bottom: 640,
				width: 40,
				height: 40,
				x: left,
				y: 600,
			} ),
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

		rows( '.os-constellation__head' )[ 0 ].click();
		expect( opened.at( -1 )?.url ).toBe( '/wp-admin/themes.php' );
		expect( panel() ).toBeNull();

		flushExit();
		hover( tile );
		rows( '.os-constellation__row--sub' )[ 1 ].click();
		// `parentUrl` pins to the MENU's landing page, not the child —
		// otherwise the window's tab strip has no way back to Themes.
		expect( opened.at( -1 )?.url ).toBe( '/wp-admin/site-editor.php' );
		expect( opened.at( -1 )?.parentUrl ).toBe( '/wp-admin/themes.php' );
	} );

	test( 'offers a trailing new-window row', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );
		const newRow = rows( '.os-constellation__row--new' )[ 0 ];
		expect( newRow.textContent ).toContain( 'Appearance' );
		newRow.click();
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
		vi.advanceTimersByTime( 5 );
		expect( panel() ).not.toBeNull();
		expect( document.activeElement ).toBe(
			rows( '.os-constellation__row' )[ 0 ],
		);
	} );

	test( 'Escape collapses the flyout and hands focus back to the tile', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );
		const row = rows( '.os-constellation__row' )[ 0 ];
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
			rows( '.os-constellation__head' )[ 0 ].click();

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
			rows( '.os-constellation__head' )[ 0 ].click();
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

		/**
		 * The hand-off is the case a plain close-then-open gets wrong:
		 * moving along the rail read as the menu blinking out and a
		 * different one blinking in. It has to read as ONE menu
		 * travelling and changing contents.
		 */
		test( 'a hand-off slides and cross-fades instead of blinking', () => {
			const tile = setupShell( 'openstation' );
			const other = addTile( 'options-general.php' );
			placeTile( tile, 100 );
			placeTile( other, 160 );
			mountWith( [ appearance, settings ] );

			hover( tile );
			expect( panel()?.getAttribute( 'aria-label' ) ).toContain(
				'Appearance',
			);
			const fromX = panel()!.style.left;

			hover( other );

			// Both panels are on screen mid-travel: the outgoing one
			// marked as retiring, the incoming one live and already
			// showing the new menu.
			const dying = ghost()!;
			expect( dying ).not.toBeNull();
			expect(
				dying.classList.contains( 'os-constellation--handoff' ),
			).toBe( true );
			expect( panel()?.getAttribute( 'aria-label' ) ).toContain(
				'Settings',
			);
			expect(
				panel()?.classList.contains( 'os-constellation--handoff' ),
			).toBe( true );

			// They travel together: the outgoing panel has been walked
			// to the incoming one's anchor, so the pair moves as one
			// object rather than one vanishing beside another.
			expect( panel()!.style.left ).not.toBe( fromX );
			expect( dying.style.left ).toBe( panel()!.style.left );

			flushExit();
			expect( ghost() ).toBeNull();
			expect(
				document.querySelectorAll( '.os-constellation' ),
			).toHaveLength( 1 );
			// And once it has landed it stops being a hand-off, so the
			// NEXT dismissal gets the fall-into-the-rail exit.
			expect(
				panel()?.classList.contains( 'os-constellation--handoff' ),
			).toBe( false );
		} );

		test( 'the incoming panel is born at the outgoing one’s anchor', () => {
			const tile = setupShell( 'openstation' );
			const other = addTile( 'options-general.php' );
			placeTile( tile, 100 );
			placeTile( other, 160 );
			mountWith( [ appearance, settings ] );

			hover( tile );
			const fromX = panel()!.style.left;
			expect( fromX ).toBe( '120px' );

			// Step far enough to run the show timer but stop before the
			// frame that walks the new panel to its own anchor.
			other.dispatchEvent( pointerOver() );
			vi.advanceTimersByTime( 0 );
			expect( panel()!.style.left ).toBe( fromX );
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
