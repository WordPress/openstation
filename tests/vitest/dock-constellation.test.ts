/**
 * Tests for `src/dock-constellation` — the hover-submenu flyout.
 *
 * What is pinned here is the CONTRACT, not the choreography:
 *
 * - It fans out on every layout. It used to be the one thing the
 *   OpenStation layout had that the others did not, and a menu tile
 *   is a menu tile wherever the rail is parked.
 * - It fans AWAY from the edge the rail is on, which it reads off the
 *   rail's own `data-os-dock-placement` rather than off the layout —
 *   Side bar runs two rails on two edges at once, so a per-layout
 *   answer would be wrong for one of them.
 * - It surfaces the submenu — the whole point. A menu with children
 *   gets one row per child, wired to the same window ids a dock click
 *   would address.
 * - It is delegated, so a tile rebuilt by a live menu refresh still
 *   works without re-mounting anything.
 * - Keyboard reaches it: the arrow pointing at where the panel will
 *   appear fans it open and lands focus on the first row; Escape
 *   collapses it and hands focus back.
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
import { ITEM_MENU_OPENING_EVENT } from '../../src/item-visibility-menu';
import type { DockItem, SystemDockItem } from '../../src/dock';
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
		// Consulted by the parent-url sweep: a window opened from a
		// menu's submenu is keyed on the CHILD page, so the base-id
		// lookup alone can never find it.
		getAll: () => [],
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

/** Build a shell with one menu tile on a rail at `placement`. */
function setupShell( layout: string, placement = 'bottom' ): HTMLElement {
	document.body.innerHTML = '';
	const shell = document.createElement( 'div' );
	shell.className = 'os-shell';
	shell.setAttribute( 'data-os-layout', layout );

	const dock = document.createElement( 'nav' );
	dock.className = 'os-dock';
	dock.setAttribute( 'data-os-dock-placement', placement );

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

	// Tears down a previous mount first, so a test that walks several
	// layouts or placements in one body doesn't leave a second
	// delegated listener behind opening a second panel on every hover.
	function mountWith(
		items: DockItem[],
		systemItems: SystemDockItem[] = [],
	): void {
		teardown?.();
		teardown = mountDockConstellation( {
			windowManager: makeManagerStub(),
			adminUrl: '/wp-admin/',
			getMenuItems: () => items,
			getSystemItem: ( id ) =>
				systemItems.find( ( i ) => i.id === id ) ?? null,
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
	function placeTile(
		tile: HTMLElement,
		left: number,
		top = 600,
	): void {
		Object.defineProperty( tile, 'getBoundingClientRect', {
			configurable: true,
			value: () => ( {
				left,
				right: left + 40,
				top,
				bottom: top + 40,
				width: 40,
				height: 40,
				x: left,
				y: top,
			} ),
		} );
	}

	test( 'fans out in every layout, not just OpenStation', () => {
		for ( const layout of [ 'classic', 'unified', 'spatial' ] ) {
			const tile = setupShell( layout );
			mount();
			hover( tile );
			expect( panel(), layout ).not.toBeNull();
		}
	} );

	test( 'fans away from the edge its rail is parked on', () => {
		// The side is named for where the PANEL lands, so a left-hand
		// rail fans right. Read off the rail rather than the layout:
		// Side bar has one of each on screen at the same time.
		for ( const [ placement, side ] of [
			[ 'bottom', 'top' ],
			[ 'left', 'right' ],
			[ 'right', 'left' ],
		] ) {
			const tile = setupShell( 'unified', placement );
			mount();
			hover( tile );
			expect( panel()?.dataset.osCnSide, placement ).toBe( side );
		}
	} );

	test( 'the open key is the arrow pointing at the panel', () => {
		// ArrowUp beside a vertical rail would fight the rail's own
		// roving, which is what Up and Down already do there.
		const tile = setupShell( 'unified', 'left' );
		mount();
		const primary = tile.querySelector( '.os-dock__item-primary' )!;
		primary.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'ArrowUp', bubbles: true } ),
		);
		expect( panel() ).toBeNull();
		primary.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'ArrowRight',
				bubbles: true,
			} ),
		);
		expect( panel() ).not.toBeNull();
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

	/*
	 * There is no trailing "New <menu> window" row. It offered a
	 * second copy of the landing page, which every row in the Open
	 * group already does — and it was the one section a system tile's
	 * action menu could never have, so keeping it would have meant two
	 * different panel shapes depending on which tile you hovered.
	 */
	test( 'offers no new-window row', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );
		expect( rows( '.os-constellation__row--new' ) ).toHaveLength( 0 );
	} );

	/*
	 * "All Posts" is a real row in wp-admin's menu, and the payload
	 * strips it out of `submenu` because two other consumers need that
	 * list to be child links only. The flyout LISTS a menu's pages, so
	 * it puts the menu's own page back at the top: a list that omits
	 * the main page reads as a bug.
	 */
	test( 'the menu’s own page leads the Open list', () => {
		const tile = setupShell( 'openstation' );
		mountWith( [ { ...appearance, selfLabel: 'All Themes' } ] );

		hover( tile );
		expect( rowLabels() ).toEqual( [ 'All Themes', 'Themes', 'Editor' ] );
	} );

	test( 'it opens the menu’s own page', () => {
		const tile = setupShell( 'openstation' );
		mountWith( [ { ...appearance, selfLabel: 'All Themes' } ] );

		hover( tile );
		rows( '.os-constellation__row--sub' )[ 0 ].click();
		expect( opened.at( -1 )?.url ).toBe( '/wp-admin/themes.php' );
	} );

	test( 'a menu with no self-link gains no extra row', () => {
		const tile = setupShell( 'openstation' );
		mount();

		hover( tile );
		expect( rowLabels() ).toEqual( [ 'Themes', 'Editor' ] );
	} );

	/*
	 * The head is the tile: icon and title, nothing else. No page
	 * count — a number the reader has no use for, with the rows
	 * themselves right below it.
	 */
	test( 'the head shows the icon and title, with no page count', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );

		const head = rows( '.os-constellation__head' )[ 0 ];
		expect( head ).toBeDefined();
		expect(
			head.querySelector( '.os-constellation__head-title' )?.textContent,
		).toBe( 'Appearance' );
		expect(
			head.querySelector( '.os-constellation__head-hint' ),
		).toBeNull();
		expect( head.textContent ).not.toContain( 'page' );
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

	describe( 'leaving', () => {
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
		 * Moving along the rail is TWO panels, each animating at its
		 * own tile — not one panel sliding across and swapping its
		 * contents. The outgoing one has to get a real dismissal, and
		 * it has to keep its own anchor while it plays, or its beam
		 * ends up pointing at a tile it has nothing to do with.
		 */
		test( 'moving to another tile dismisses the old menu where it stands', () => {
			const tile = setupShell( 'openstation' );
			const other = addTile( 'options-general.php' );
			placeTile( tile, 100 );
			placeTile( other, 160 );
			mountWith( [ appearance, settings ] );

			hover( tile );
			expect( panel()?.getAttribute( 'aria-label' ) ).toContain(
				'Appearance',
			);

			hover( other );

			// The old menu is still on screen, playing its exit, and
			// still anchored over the tile it belongs to.
			const dying = ghost();
			expect( dying ).not.toBeNull();
			expect( dying?.getAttribute( 'aria-label' ) ).toContain(
				'Appearance',
			);
			expect( dying!.style.left ).toBe( '120px' );

			// The new one is live over ITS tile, playing its entrance.
			expect( panel()?.getAttribute( 'aria-label' ) ).toContain(
				'Settings',
			);
			expect( panel()!.style.left ).toBe( '180px' );
			expect(
				panel()?.classList.contains( 'os-constellation--open' ),
			).toBe( true );

			flushExit();
			expect( ghost() ).toBeNull();
			expect(
				document.querySelectorAll( '.os-constellation' ),
			).toHaveLength( 1 );
		} );

		test( 'the tile being left un-lifts while its menu is still leaving', () => {
			const tile = setupShell( 'openstation' );
			const other = addTile( 'options-general.php' );
			mountWith( [ appearance, settings ] );

			hover( tile );
			expect( tile.hasAttribute( 'data-constellation-open' ) ).toBe(
				true,
			);

			hover( other );
			// Only one tile is ever marked as hosting the menu, even
			// while two panels are painted.
			expect( tile.hasAttribute( 'data-constellation-open' ) ).toBe(
				false,
			);
			expect( other.hasAttribute( 'data-constellation-open' ) ).toBe(
				true,
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

		test( 'a tile menu opening cuts it, so the two never stack', () => {
			// Right-click — or any other route into the tile menu — is a
			// request for a DIFFERENT surface on the same tile. Both
			// anchor to that tile, so leaving the flyout up paints one
			// panel over the other.
			const tile = setupShell( 'openstation' );
			mount();
			hover( tile );
			expect( panel() ).not.toBeNull();

			document.dispatchEvent(
				new CustomEvent( ITEM_MENU_OPENING_EVENT, {
					detail: { id: 'themes.php', surface: 'dock' },
				} ),
			);

			// Cut rather than animated: an exit gliding back into the
			// rail underneath the menu that replaced it is the same
			// collision one frame later.
			expect( panel() ).toBeNull();
			expect( ghost() ).toBeNull();
		} );

		test( 'stops listening for tile menus once torn down', () => {
			const tile = setupShell( 'openstation' );
			mount();
			hover( tile );
			teardown();

			// The listener lives on `document`, so a leak keeps firing
			// into a module nobody is driving any more.
			document.dispatchEvent(
				new CustomEvent( ITEM_MENU_OPENING_EVENT, {
					detail: { id: 'themes.php', surface: 'dock' },
				} ),
			);
			expect( document.querySelector( '.os-constellation' ) ).toBeNull();
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

	test( 'is one tab stop, not one per row', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );
		// Roving tabindex. Arrow keys move between rows; Tab leaves the
		// menu. Without this a fifteen-child submenu would put fifteen
		// stops between the dock and whatever follows it.
		const all = rows( '.os-constellation__row' );
		expect( all.length ).toBeGreaterThan( 1 );
		expect( all.every( ( r ) => r.tabIndex === -1 ) ).toBe( true );
	} );

	test( 'Tab leaves the menu and puts focus back on the rail', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );
		const row = rows( '.os-constellation__row' )[ 0 ];
		row.focus();
		const ev = new KeyboardEvent( 'keydown', {
			key: 'Tab',
			bubbles: true,
			cancelable: true,
		} );
		row.dispatchEvent( ev );

		expect( panel() ).toBeNull();
		// Focus lands on the tile, not `<body>` — the browser then
		// continues tabbing from the rail's own place in the document
		// rather than restarting at the top of the page. And the
		// default is NOT prevented, or that onward move never happens.
		expect( document.activeElement ).toBe(
			tile.querySelector( '.os-dock__item-primary' ),
		);
		expect( ev.defaultPrevented ).toBe( false );
	} );

	test( 'caps its height to the room above the tile', () => {
		const tile = setupShell( 'openstation' );
		// A dock 700px down a viewport: 700 − 14 beam gap − 12 margin.
		placeTile( tile, 100, 700 );
		mount();
		hover( tile );
		// The panel hangs off the top of the dock and cannot be nudged
		// downwards to fit — that would push it over the rail — so a
		// menu too tall for the space is capped and its submenu group
		// takes the scroll instead.
		expect(
			panel()!.style.getPropertyValue( '--os-cn-max-h' ),
		).toBe( '674px' );
	} );

	test( 'never caps below a usable height on a short viewport', () => {
		const tile = setupShell( 'openstation' );
		// A tile 60px from the top leaves 34px — at which point a panel
		// has stopped being a menu and become a scrollbar with a title
		// on it, so the floor wins and it overflows slightly instead.
		placeTile( tile, 100, 60 );
		mount();
		hover( tile );
		expect(
			panel()!.style.getPropertyValue( '--os-cn-max-h' ),
		).toBe( '160px' );
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

	/*
	 * Action menus — a system tile that declared a `submenu`.
	 *
	 * These are the Create and System tiles: a menu with no admin page
	 * behind it, whose rows DO things rather than navigate. The panel
	 * has to drop everything that assumes a landing page, and the rows
	 * have to run their own callback rather than routing to a window.
	 */
	/** Put a system tile carrying `data-constellation-id` on the rail. */
	function addSystemTile( id: string ): HTMLElement {
		const dock = document.querySelector( '.os-dock' ) as HTMLElement;
		const tile = document.createElement( 'div' );
		tile.className = 'os-dock__item os-dock__item--system';
		tile.dataset.systemId = id;
		tile.dataset.constellationId = id;
		tile.appendChild( document.createElement( 'button' ) );
		dock.appendChild( tile );
		return tile;
	}

	function systemTile(
		id: string,
		submenu: SystemDockItem[ 'submenu' ],
	): SystemDockItem {
		return {
			id,
			title: 'System',
			icon: 'dashicons-admin-generic',
			onOpen: () => {},
			submenu,
		};
	}

	test( 'a system tile with a submenu fans its rows out', () => {
		setupShell( 'unified' );
		const tile = addSystemTile( 'os-system' );
		mountWith(
			[ appearance ],
			[
				systemTile( 'os-system', [
					{ title: 'OpenStation Preferences', url: '' },
					{ title: 'Log out', url: '' },
				] ),
			],
		);

		hover( tile );
		expect( rowLabels() ).toEqual( [
			'OpenStation Preferences',
			'Log out',
		] );
	} );

	/*
	 * One panel shape, whichever family of tile you hovered. The two
	 * kinds of menu differ in what fills the sections, never in which
	 * sections exist — so an action menu gets the same head and the
	 * same "Open" heading an admin menu gets.
	 */
	test( 'an action menu wears the same head as an admin menu', () => {
		setupShell( 'unified' );
		const tile = addSystemTile( 'os-system' );
		mountWith(
			[ appearance ],
			[ systemTile( 'os-system', [ { title: 'Log out', url: '' } ] ) ],
		);

		hover( tile );
		const head = rows( '.os-constellation__head' )[ 0 ];
		expect(
			head?.querySelector( '.os-constellation__head-title' )?.textContent,
		).toBe( 'System' );
		expect(
			head?.querySelector( '.os-constellation__head-hint' ),
		).toBeNull();
	} );

	test( 'an action menu heads its rows with Open, like an admin menu', () => {
		setupShell( 'unified' );
		const tile = addSystemTile( 'os-system' );
		mountWith(
			[ appearance ],
			[ systemTile( 'os-system', [ { title: 'Log out', url: '' } ] ) ],
		);

		hover( tile );
		const legends = rows( '.os-constellation__legend' ).map(
			( el ) => el.textContent,
		);
		expect( legends ).toContain( 'Open' );
	} );

	test( 'the head of an action menu runs its first row', () => {
		setupShell( 'unified' );
		const tile = addSystemTile( 'os-system' );
		const first = vi.fn();
		const second = vi.fn();
		mountWith(
			[ appearance ],
			[
				systemTile( 'os-system', [
					{ title: 'Preferences', url: '', onSelect: first },
					{ title: 'Log out', url: '', onSelect: second },
				] ),
			],
		);

		hover( tile );
		rows( '.os-constellation__head' )[ 0 ].click();

		// There is no landing page behind the tile, so the head stands
		// in for the first row — the same thing the tile's own click
		// does, which is what keeps keyboard and touch users whole.
		expect( first ).toHaveBeenCalledTimes( 1 );
		expect( second ).not.toHaveBeenCalled();
	} );

	test( 'a row runs its onSelect instead of routing to a window', () => {
		setupShell( 'unified' );
		const tile = addSystemTile( 'os-system' );
		const onSelect = vi.fn();
		mountWith(
			[ appearance ],
			[
				systemTile( 'os-system', [
					{ title: 'Fullscreen', url: '', onSelect },
				] ),
			],
		);

		hover( tile );
		rows( '.os-constellation__row--sub' )[ 0 ].click();

		expect( onSelect ).toHaveBeenCalledTimes( 1 );
		// And emphatically did NOT open a window on the way.
		expect( opened ).toHaveLength( 0 );
	} );

	/*
	 * An action menu has no window key of its own — it is not a page —
	 * so it asks its rows, each of which declares the window it opens
	 * via `windowId`. That is what lets System list an open
	 * Preferences window where Appearance lists an open Themes one.
	 */
	test( 'an action menu lists the windows its rows have open', () => {
		setupShell( 'unified' );
		const tile = addSystemTile( 'os-system' );
		const prefs = {
			state: 'normal',
			config: { title: 'OpenStation Preferences' },
		} as unknown as ReturnType< typeof Object >;

		teardown?.();
		teardown = mountDockConstellation( {
			windowManager: {
				...makeManagerStub(),
				getAllByBaseIdOnActiveDesktop: ( id: string ) =>
					id === 'os-settings' ? [ prefs ] : [],
			} as unknown as WindowManager,
			adminUrl: '/wp-admin/',
			getMenuItems: () => [ appearance ],
			getSystemItem: () =>
				systemTile( 'os-system', [
					{
						title: 'OpenStation Preferences',
						url: '',
						windowId: 'os-settings',
						onSelect: () => {},
					},
					// No window behind it, so it contributes nothing.
					{ title: 'Log out', url: '', onSelect: () => {} },
				] ),
		} );

		hover( tile );
		const live = rows(
			'.os-constellation__row--live .os-constellation__row-label',
		).map( ( el ) => el.textContent );
		expect( live ).toEqual( [ 'OpenStation Preferences' ] );
	} );

	test( 'an action menu with nothing open lists no windows', () => {
		setupShell( 'unified' );
		const tile = addSystemTile( 'os-system' );
		mountWith(
			[ appearance ],
			[
				systemTile( 'os-system', [
					{
						title: 'OpenStation Preferences',
						url: '',
						windowId: 'os-settings',
					},
				] ),
			],
		);

		hover( tile );
		expect( rows( '.os-constellation__row--live' ) ).toHaveLength( 0 );
	} );

	test( 'a system tile without a submenu gets no flyout', () => {
		setupShell( 'unified' );
		const dock = document.querySelector( '.os-dock' ) as HTMLElement;
		const tile = document.createElement( 'div' );
		tile.className = 'os-dock__item os-dock__item--system';
		tile.dataset.systemId = 'os-mio-toggle';
		tile.appendChild( document.createElement( 'button' ) );
		dock.appendChild( tile );
		mountWith( [ appearance ], [] );

		hover( tile );
		// No `data-constellation-id`, so the hover belongs to the peek.
		expect( panel() ).toBeNull();
	} );
} );
