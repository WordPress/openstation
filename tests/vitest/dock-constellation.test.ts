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
import {
	_resetNativeUrlRemap,
	bindNativeUrlRemap,
	registerNativeUrlRemap,
} from '../../src/native-url-remap';
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

const doors: string[] = [];

function makeManagerStub(): WindowManager {
	return {
		getAllByBaseIdOnActiveDesktop: () => [],

		getAll: () => [],
		getActiveDesktopId: () => 'default-1',
		getFocused: () => null,
		getById: () => undefined,
		focus: () => {},
		open: ( cfg: Record< string, unknown > ) => {
			opened.push( cfg );
			doors.push( 'open' );
		},
		openNew: ( cfg: Record< string, unknown > ) => {
			opened.push( cfg );
			doors.push( 'openNew' );
			return Promise.resolve( null );
		},
	} as unknown as WindowManager;
}

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

function pointerOver(): Event {
	const ev = new Event( 'pointerover', { bubbles: true } );
	Object.defineProperty( ev, 'pointerType', { value: 'mouse' } );
	return ev;
}

function hover( tile: HTMLElement ): void {
	tile.dispatchEvent( pointerOver() );

	vi.advanceTimersByTime( 140 );

	vi.advanceTimersByTime( 5 );
}

function panel(): HTMLElement | null {
	return document.querySelector< HTMLElement >(
		'.os-constellation:not( .os-constellation--closing )',
	);
}

function ghost(): HTMLElement | null {
	return document.querySelector< HTMLElement >(
		'.os-constellation--closing',
	);
}

function flushExit(): void {
	vi.advanceTimersByTime( 400 );
}

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
		doors.length = 0;
		installHooksStub();
		vi.useFakeTimers();

		vi.stubGlobal( 'requestAnimationFrame', ( cb: FrameRequestCallback ) =>
			setTimeout( () => cb( 0 ), 0 ) as unknown as number,
		);
	} );

	afterEach( () => {
		teardown?.();
		_resetNativeUrlRemap();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		clearHooksStub();
		document.body.innerHTML = '';
		document.body.className = '';
	} );

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

	function addTile( slug: string ): HTMLElement {
		const tile = document.createElement( 'div' );
		tile.className = 'os-dock__item';
		tile.dataset.menuSlug = slug;
		tile.appendChild( document.createElement( 'button' ) );
		document.querySelector( '.os-dock' )!.appendChild( tile );
		return tile;
	}

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

		expect( tile.hasAttribute( 'data-constellation-open' ) ).toBe( true );
		expect(
			document.body.classList.contains( 'os-constellation-open' ),
		).toBe( true );
	} );

	test( 'an off-site row is marked, and leaves for the browser', () => {
		const openSpy = vi.fn();
		vi.stubGlobal( 'open', openSpy );

		const tile = setupShell( 'openstation' );
		mountWith( [
			{
				...appearance,
				submenu: [
					{ title: 'Editor', url: '/wp-admin/site-editor.php' },
					{
						title: 'Docs',
						url: 'https://example.org/docs',
						offSite: true,
					},
				],
			},
		] );
		hover( tile );

		const docs = rows( '.os-constellation__row--sub' )[ 1 ];
		expect(
			docs.querySelector( '.os-constellation__row-offsite' ),
		).not.toBeNull();

		expect( docs.getAttribute( 'aria-label' ) ).toBeNull();
		expect( docs.textContent ).toContain( 'Docs' );
		expect( docs.textContent ).toContain( '(opens in a new tab)' );

		docs.click();

		expect( opened ).toHaveLength( 0 );
		expect( openSpy ).toHaveBeenCalledWith(
			'https://example.org/docs',
			'_blank',
			'noopener,noreferrer',
		);
	} );

	test( 'head opens the menu; a submenu row opens its child page', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );

		rows( '.os-constellation__head' )[ 0 ].click();
		expect( opened.at( -1 )?.url ).toBe( '/wp-admin/themes.php' );

		expect( doors.at( -1 ) ).toBe( 'open' );
		expect( panel() ).toBeNull();

		flushExit();
		hover( tile );
		rows( '.os-constellation__row--sub' )[ 1 ].click();

		expect( opened.at( -1 )?.url ).toBe( '/wp-admin/site-editor.php' );
		expect( opened.at( -1 )?.parentUrl ).toBe( '/wp-admin/themes.php' );

		expect( doors.at( -1 ) ).toBe( 'openNew' );
	} );

	test( 'offers no new-window row', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );
		expect( rows( '.os-constellation__row--new' ) ).toHaveLength( 0 );
	} );

	test( 'the menu’s own page leads the Open list', () => {
		const tile = setupShell( 'openstation' );
		mountWith( [ { ...appearance, selfLabel: 'All Themes' } ] );

		hover( tile );
		expect( rowLabels() ).toEqual( [ 'All Themes', 'Themes', 'Editor' ] );
	} );

	test( 'a submenu row carries selfLabel to the window it opens', () => {
		const tile = setupShell( 'openstation' );
		mountWith( [ { ...appearance, selfLabel: 'All Themes' } ] );

		hover( tile );
		rows( '.os-constellation__row--sub' )[ 1 ].click();
		expect( opened.at( -1 )?.selfLabel ).toBe( 'All Themes' );
	} );

	test( 'the head carries it too', () => {
		const tile = setupShell( 'openstation' );
		mountWith( [ { ...appearance, selfLabel: 'All Themes' } ] );

		hover( tile );
		rows( '.os-constellation__head' )[ 0 ].click();
		expect( opened.at( -1 )?.selfLabel ).toBe( 'All Themes' );
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

			expect( panel() ).toBeNull();
			expect( ghost() ).not.toBeNull();
			expect( tile.hasAttribute( 'data-constellation-open' ) ).toBe(
				false,
			);

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

			const dying = ghost()!;
			expect( dying.classList.contains( 'os-constellation--open' ) ).toBe(
				false,
			);
			expect(
				dying.classList.contains( 'os-constellation--closing' ),
			).toBe( true );
		} );

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

			const dying = ghost();
			expect( dying ).not.toBeNull();
			expect( dying?.getAttribute( 'aria-label' ) ).toContain(
				'Appearance',
			);
			expect( dying!.style.left ).toBe( '120px' );

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

			expect( ghost() ).toBeNull();
			expect( panel() ).toBeNull();
		} );

		test( 'a tile menu opening cuts it, so the two never stack', () => {

			const tile = setupShell( 'openstation' );
			mount();
			hover( tile );
			expect( panel() ).not.toBeNull();

			document.dispatchEvent(
				new CustomEvent( ITEM_MENU_OPENING_EVENT, {
					detail: { id: 'themes.php', surface: 'dock' },
				} ),
			);

			expect( panel() ).toBeNull();
			expect( ghost() ).toBeNull();
		} );

		test( 'stops listening for tile menus once torn down', () => {
			const tile = setupShell( 'openstation' );
			mount();
			hover( tile );
			teardown();

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

		expect( document.activeElement ).toBe(
			tile.querySelector( '.os-dock__item-primary' ),
		);
		expect( ev.defaultPrevented ).toBe( false );
	} );

	test( 'caps its height to the room above the tile', () => {
		const tile = setupShell( 'openstation' );

		placeTile( tile, 100, 700 );
		mount();
		hover( tile );

		expect(
			panel()!.style.getPropertyValue( '--os-cn-max-h' ),
		).toBe( '674px' );
	} );

	test( 'never caps below a usable height on a short viewport', () => {
		const tile = setupShell( 'openstation' );

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

	test( 'clicking the anchor tile dismisses the flyout', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );
		expect( panel() ).not.toBeNull();

		tile.querySelector< HTMLElement >( '.os-dock__item-primary' )!.click();
		expect( panel() ).toBeNull();
	} );

	test( 'clicking inside the panel does not dismiss it on its own', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );

		panel()!.click();
		expect( panel() ).not.toBeNull();
	} );

	test( 'scrolling the menu itself does not dismiss it', () => {
		const tile = setupShell( 'openstation' );
		mount();
		hover( tile );

		const group = panel()!.querySelector( '.os-constellation__group' )!;
		group.dispatchEvent( new Event( 'scroll' ) );

		expect( panel() ).not.toBeNull();
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

		expect( opened ).toHaveLength( 0 );
	} );

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

					{ title: 'Log out', url: '', onSelect: () => {} },
				] ),
		} );

		hover( tile );
		const live = rows(
			'.os-constellation__row--live .os-constellation__row-label',
		).map( ( el ) => el.textContent );
		expect( live ).toEqual( [ 'OpenStation Preferences' ] );
	} );

	test( 'a menu whose window is native lists it as open', () => {
		const tile = setupShell( 'unified' );
		const live = {
			id: 'desktop-mode-posts',
			state: 'normal',
			config: { title: 'Posts' },
		} as unknown as ReturnType< typeof Object >;
		bindNativeUrlRemap( {
			getSnapshot: () => ( {} ) as never,
			openById: () => true,

			adminUrl: `${ window.location.origin }/wp-admin/`,
		} );
		registerNativeUrlRemap( {
			id: 'desktop-mode-posts',
			nativeWindowId: 'desktop-mode-posts',
			matches: ( _url, parsed ) => parsed.pathname.endsWith( '/edit.php' ),
		} );

		teardown?.();
		teardown = mountDockConstellation( {
			windowManager: {
				...makeManagerStub(),
				getAllByBaseIdOnActiveDesktop: ( id: string ) =>
					id === 'desktop-mode-posts' ? [ live ] : [],
			} as unknown as WindowManager,
			adminUrl: '/wp-admin/',

			getMenuItems: () => [ { ...appearance, url: '/wp-admin/edit.php' } ],
			getSystemItem: () => undefined,
		} );

		hover( tile );
		expect(
			rows( '.os-constellation__row--live .os-constellation__row-label' ).map(
				( el ) => el.textContent,
			),
		).toEqual( [ 'Posts' ] );
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

		expect( panel() ).toBeNull();
	} );
} );
