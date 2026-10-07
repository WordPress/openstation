import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createLayoutDispatcher } from '../../src/desktop-layout';
import { type DockItem, type SystemDockItem } from '../../src/dock';
import {
	_resetDockRailRenderersForTests,
	installDefaultDockRailRenderer,
} from '../../src/dock-rail';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import type { WindowManager } from '../../src/window-manager';
import type { DesktopIconServerEntry } from '../../src/types';

function makeManagerStub(): WindowManager {
	return {
		getFocused: () => null,
		getAllByBaseId: () => [],

		getAllByBaseIdOnActiveDesktop: () => [],
		getAll: () => [],
		getById: () => undefined,
		getActiveDesktopId: () => 'default-1',
	} as unknown as WindowManager;
}

function makeItem( overrides: Partial< DockItem > = {} ): DockItem {
	return {
		id: 'item',
		title: 'Item',
		icon: 'dashicons-admin-generic',
		url: 'http://localhost/wp-admin/admin.php?page=item',
		badge: 0,
		submenu: [],
		multi: false,
		isCore: false,
		...overrides,
	};
}

const dashboard = makeItem( {
	id: 'index.php',
	title: 'Dashboard',
	url: '/wp-admin/index.php',
	isCore: true,
} );
const posts = makeItem( {
	id: 'edit.php',
	title: 'Posts',
	url: '/wp-admin/edit.php',
	isCore: true,
} );
const yoast = makeItem( {
	id: 'wpseo_dashboard',
	title: 'Yoast SEO',
	url: '/wp-admin/admin.php?page=wpseo_dashboard',
	isCore: false,
} );
const woo = makeItem( {
	id: 'woocommerce',
	title: 'WooCommerce',
	url: '/wp-admin/admin.php?page=woocommerce',
	isCore: false,
} );

const noopTile: SystemDockItem = {
	id: 'desktop-mode-os-settings',
	title: 'OS Settings',
	icon: 'dashicons-desktop',
	onOpen: () => {},
};

const controlTile: SystemDockItem = {
	id: 'os-system',
	title: 'System',
	icon: 'dashicons-admin-generic',
	navKind: 'control',
	onOpen: () => {},
};

function setupShell(): {
	shellRoot: HTMLElement;
	shellBody: HTMLElement;
	bottomDockEl: HTMLElement;
	desktopArea: HTMLElement;
} {
	document.body.innerHTML = '';
	const shellRoot = document.createElement( 'div' );
	shellRoot.id = 'os-shell';
	shellRoot.className = 'os-shell';

	const shellBody = document.createElement( 'div' );
	shellBody.className = 'os-shell__body';
	shellRoot.appendChild( shellBody );

	const bottomDockEl = document.createElement( 'nav' );
	bottomDockEl.id = 'os-dock';
	bottomDockEl.className = 'os-dock';
	shellBody.appendChild( bottomDockEl );

	const desktopArea = document.createElement( 'div' );
	desktopArea.id = 'os-area';
	shellBody.appendChild( desktopArea );

	document.body.appendChild( shellRoot );
	return { shellRoot, shellBody, bottomDockEl, desktopArea };
}

function makeDeps(
	overrides: Partial< Parameters< typeof createLayoutDispatcher >[ 0 ] > = {},
): {
	deps: Parameters< typeof createLayoutDispatcher >[ 0 ];
	renderIcons: ReturnType< typeof vi.fn >;
	shell: ReturnType< typeof setupShell >;
} {
	const shell = setupShell();
	const renderIcons = vi.fn();
	const deps: Parameters< typeof createLayoutDispatcher >[ 0 ] = {
		shellRoot: shell.shellRoot,
		shellBody: shell.shellBody,
		bottomDockEl: shell.bottomDockEl,
		desktopArea: shell.desktopArea,
		windowManager: makeManagerStub(),
		adminUrl: '/wp-admin/',
		renderIcons,
		...overrides,
	};
	return { deps, renderIcons, shell };
}

describe( 'desktop-layout dispatcher', () => {
	beforeEach( () => {
		installHooksStub();
		_resetDockRailRenderersForTests();
		installDefaultDockRailRenderer();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetDockRailRenderersForTests();
		document.body.innerHTML = '';
	} );

	test( 'writes data-os-layout to the shell root on init', () => {
		const { deps, shell } = makeDeps();
		createLayoutDispatcher( deps, 'unified', [ dashboard ], [] );
		expect(
			shell.shellRoot.getAttribute( 'data-os-layout' ),
		).toBe( 'unified' );
	} );

	test( 'classic: creates two docks (side + bottom) with correct placements', () => {
		const { deps } = makeDeps();
		createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, posts, yoast, woo ],
			[],
		);
		const sideDock = document.getElementById( 'os-side-dock' );
		expect( sideDock ).not.toBeNull();
		expect(
			sideDock?.getAttribute( 'data-os-dock-placement' ),
		).toBe( 'left' );
		expect( sideDock?.classList.contains( 'os-dock' ) ).toBe(
			true,
		);

		const bottomDock = document.getElementById( 'os-dock' );
		expect(
			bottomDock?.getAttribute( 'data-os-dock-placement' ),
		).toBe( 'bottom' );
	} );

	test( 'classic: routes core items to side dock, plugin items to bottom dock', () => {
		const { deps } = makeDeps();
		createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, posts, yoast, woo ],
			[],
		);

		const sideTiles = Array.from(
			document
				.getElementById( 'os-side-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( sideTiles ).toEqual(
			expect.arrayContaining( [ 'index.php', 'edit.php' ] ),
		);

		const bottomTiles = Array.from(
			document
				.getElementById( 'os-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( bottomTiles ).toEqual(
			expect.arrayContaining( [ 'wpseo_dashboard', 'woocommerce' ] ),
		);
		expect( bottomTiles ).not.toContain( 'index.php' );
	} );

	test( 'unified: single bottom dock holds every item, no side dock element', () => {
		const { deps } = makeDeps();
		createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, posts, yoast, woo ],
			[],
		);
		expect( document.getElementById( 'os-side-dock' ) ).toBeNull();

		const bottomTiles = Array.from(
			document
				.getElementById( 'os-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( bottomTiles ).toEqual(
			expect.arrayContaining( [
				'index.php',
				'edit.php',
				'wpseo_dashboard',
				'woocommerce',
			] ),
		);
	} );

	test( 'classic + unified: renderIcons gets only the server list (no synthesis)', () => {
		const { deps, renderIcons } = makeDeps();
		const serverIcons: DesktopIconServerEntry[] = [
			{
				id: 'plugin:icon',
				title: 'Plugin',
				icon: 'dashicons-admin-plugins',
				window: 'plugin-window',
				url: '',
				position: 50,
			},
		];
		createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, posts, yoast ],
			serverIcons,
		);
		const lastCall = renderIcons.mock.calls.at( -1 )![ 0 ];
		expect(
			( lastCall as DesktopIconServerEntry[] ).map( ( i ) => i.id ),
		).toEqual( [ 'plugin:icon' ] );
	} );

	test( 'setLayout: classic → unified tears down side dock', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		expect(
			document.getElementById( 'os-side-dock' ),
		).not.toBeNull();
		dispatcher.setLayout( 'unified' );
		expect( document.getElementById( 'os-side-dock' ) ).toBeNull();
		expect( dispatcher.getSide() ).toBeNull();
		expect( dispatcher.getPrimary() ).not.toBeNull();
		expect( dispatcher.getLayout() ).toBe( 'unified' );
	} );

	test( 'setLayout: unified → classic creates side dock', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, yoast ],
			[],
		);
		expect( document.getElementById( 'os-side-dock' ) ).toBeNull();
		dispatcher.setLayout( 'classic' );
		expect(
			document.getElementById( 'os-side-dock' ),
		).not.toBeNull();
		expect( dispatcher.getSide() ).not.toBeNull();
	} );

	test( 'setLayout: same value is a no-op (no event, no rebuild)', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		const events = vi.fn();
		document.addEventListener( 'os-layout-changed', events );
		const sideBefore = dispatcher.getSide();
		dispatcher.setLayout( 'classic' );
		expect( events ).not.toHaveBeenCalled();
		expect( dispatcher.getSide() ).toBe( sideBefore );
		document.removeEventListener( 'os-layout-changed', events );
	} );

	test( 'setLayout: emits os-layout-changed with new primary/side', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, yoast ],
			[],
		);
		let detail: { layout: string; primary: unknown; side: unknown } | null = null;
		document.addEventListener(
			'os-layout-changed',
			( e ) => {
				detail = ( e as CustomEvent ).detail;
			},
			{ once: true },
		);
		dispatcher.setLayout( 'classic' );
		expect( detail ).not.toBeNull();
		expect( detail!.layout ).toBe( 'classic' );
		expect( detail!.primary ).toBe( dispatcher.getPrimary() );
		expect( detail!.side ).toBe( dispatcher.getSide() );
	} );

	describe( 'one rail groups before it draws', () => {

		const railOrder = ( dockId: string ): string[] =>
			Array.from(
				document
					.getElementById( dockId )!
					.querySelectorAll(
						'[data-menu-slug], .os-dock__separator--group',
					),
			).map( ( el ) =>
				el.classList.contains( 'os-dock__separator--group' )
					? '|'
					: ( el as HTMLElement ).dataset.menuSlug ?? '?',
			);

		test( 'unified: an interleaved menu is sorted, not split', () => {
			const { deps } = makeDeps();

			createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast, posts, woo ],
				[],
			);

			expect( railOrder( 'os-dock' ) ).toEqual( [
				'index.php',
				'edit.php',
				'|',
				'wpseo_dashboard',
				'woocommerce',
			] );
		} );

		test( 'the grouping survives a live menu refresh', () => {
			const { deps } = makeDeps();
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, posts ],
				[],
			);

			dispatcher.applyDockItems( [ dashboard, woo, posts ] );

			expect( railOrder( 'os-dock' ) ).toEqual( [
				'index.php',
				'edit.php',
				'|',
				'woocommerce',
			] );
		} );

		test( 'relative order inside each cluster is preserved', () => {
			const { deps } = makeDeps();
			createLayoutDispatcher(
				deps,
				'unified',
				[ woo, posts, yoast, dashboard ],
				[],
			);

			expect( railOrder( 'os-dock' ) ).toEqual( [
				'edit.php',
				'index.php',
				'|',
				'woocommerce',
				'wpseo_dashboard',
			] );
		} );
	} );

	describe( 'dock placement', () => {
		test( 'a one-rail layout mounts on the edge it was given', () => {
			const { deps } = makeDeps();
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
				'left',
			);
			expect( dispatcher.getDockPlacement() ).toBe( 'left' );
			expect(
				document
					.getElementById( 'os-dock' )
					?.getAttribute( 'data-os-dock-placement' ),
			).toBe( 'left' );
		} );

		test( 'defaults to the bottom when no placement is given', () => {
			const { deps } = makeDeps();
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard ],
				[],
			);
			expect( dispatcher.getDockPlacement() ).toBe( 'bottom' );
			expect(
				document
					.getElementById( 'os-dock' )
					?.getAttribute( 'data-os-dock-placement' ),
			).toBe( 'bottom' );
		} );

		test( 'setDockPlacement rebuilds the rail on the new edge', () => {
			const { deps } = makeDeps();
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
			);
			const before = dispatcher.getPrimary();
			dispatcher.setDockPlacement( 'right' );
			expect(
				document
					.getElementById( 'os-dock' )
					?.getAttribute( 'data-os-dock-placement' ),
			).toBe( 'right' );

			expect( dispatcher.getPrimary() ).not.toBe( before );

			expect(
				document.getElementById( 'os-dock' )!.querySelectorAll(
					'[data-menu-slug]',
				).length,
			).toBe( 2 );
		} );

		test( 'setDockPlacement: same value is a no-op', () => {
			const { deps } = makeDeps();
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard ],
				[],
			);
			const events = vi.fn();
			document.addEventListener( 'os-layout-changed', events );
			const before = dispatcher.getPrimary();
			dispatcher.setDockPlacement( 'bottom' );
			expect( events ).not.toHaveBeenCalled();
			expect( dispatcher.getPrimary() ).toBe( before );
			document.removeEventListener( 'os-layout-changed', events );
		} );

		test( 'classic keeps both rails and remembers the pick for later', () => {
			const { deps } = makeDeps();
			const dispatcher = createLayoutDispatcher(
				deps,
				'classic',
				[ dashboard, yoast ],
				[],
			);
			const primaryBefore = dispatcher.getPrimary();
			dispatcher.setDockPlacement( 'left' );

			expect(
				document
					.getElementById( 'os-dock' )
					?.getAttribute( 'data-os-dock-placement' ),
			).toBe( 'bottom' );
			expect(
				document
					.getElementById( 'os-side-dock' )
					?.getAttribute( 'data-os-dock-placement' ),
			).toBe( 'left' );
			expect( dispatcher.getPrimary() ).toBe( primaryBefore );

			expect( dispatcher.getDockPlacement() ).toBe( 'left' );
			dispatcher.setLayout( 'unified' );
			expect(
				document
					.getElementById( 'os-dock' )
					?.getAttribute( 'data-os-dock-placement' ),
			).toBe( 'left' );
		} );

		test( 'setDockPlacement emits os-layout-changed with the new edge', () => {
			const { deps } = makeDeps();
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard ],
				[],
			);
			let detail: {
				layout: string;
				placement: string;
				primary: unknown;
			} | null = null;
			document.addEventListener(
				'os-layout-changed',
				( e ) => {
					detail = ( e as CustomEvent ).detail;
				},
				{ once: true },
			);
			dispatcher.setDockPlacement( 'left' );
			expect( detail ).not.toBeNull();
			expect( detail!.layout ).toBe( 'unified' );
			expect( detail!.placement ).toBe( 'left' );
			expect( detail!.primary ).toBe( dispatcher.getPrimary() );
		} );

		test( 'system tiles re-attach after a placement change', () => {
			const { deps } = makeDeps();
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard ],
				[],
			);
			dispatcher.appendSystemTile( {
				id: 'os-settings',
				title: 'OpenStation Preferences',
				icon: 'dashicons-admin-generic',
				navKind: 'control',
				onOpen: () => undefined,
			} );
			dispatcher.setDockPlacement( 'left' );
			const dock = document.getElementById( 'os-dock' )!;
			expect(
				dock.querySelectorAll( '.os-dock__item--system' ).length,
			).toBe( 1 );

			expect(
				dock.querySelector( '.os-dock__separator' ),
			).not.toBeNull();
		} );
	} );

	test( 'applyDockItems: classic re-routes a fresh list to the right rails', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.applyDockItems( [ posts, woo ] );

		const sideTiles = Array.from(
			document
				.getElementById( 'os-side-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( sideTiles ).toEqual( [ 'edit.php' ] );

		const bottomTiles = Array.from(
			document
				.getElementById( 'os-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( bottomTiles ).toEqual( [ 'woocommerce' ] );
	} );

	test( 'a control tile lands on the dock in the split layout, never the sidebar', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( controlTile );
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ controlTile.id }"]` ),
		).not.toBeNull();
		expect(
			document
				.getElementById( 'os-side-dock' )!
				.querySelector( `[data-system-id="${ controlTile.id }"]` ),
		).toBeNull();
	} );

	test( 'a launcher the user pinned lands on the dock in either layout', () => {
		for ( const layout of [ 'unified', 'classic' ] as const ) {
			const { deps } = makeDeps( {
				getSettings: () => ( {
					navPlacement: { 'desktop-mode-os-settings': 'rail' },
					navOrder: [],
				} ),
			} );
			const dispatcher = createLayoutDispatcher(
				deps,
				layout,
				[ dashboard, yoast ],
				[],
			);
			dispatcher.appendSystemTile( noopTile );
			expect(
				document
					.getElementById( 'os-dock' )!
					.querySelector( `[data-system-id="${ noopTile.id }"]` ),
			).not.toBeNull();
		}
	} );

	test( 'a control tile follows a layout switch onto the rebuilt dock', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( controlTile );
		dispatcher.setLayout( 'unified' );

		expect( document.getElementById( 'os-side-dock' ) ).toBeNull();
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ controlTile.id }"]` ),
		).not.toBeNull();
	} );

	test( 'appendSystemTile: tracked tiles survive a layout rebuild', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( controlTile );
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ controlTile.id }"]` ),
		).not.toBeNull();

		dispatcher.setLayout( 'classic' );
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ controlTile.id }"]` ),
		).not.toBeNull();
	} );

	test( 'removeSystemTile: drops the tile from tracking and from the live rail', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( controlTile );
		dispatcher.removeSystemTile( controlTile.id );
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ controlTile.id }"]` ),
		).toBeNull();

		dispatcher.setLayout( 'classic' );
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ controlTile.id }"]` ),
		).toBeNull();
	} );

	describe( 'system tiles honor the navigation preferences', () => {
		const gamesTile: SystemDockItem = {
			id: 'desktop-mode-games',
			title: 'Games',
			icon: 'dashicons-games',

			windowId: 'desktop-mode-games',
			navKind: 'control',
			onOpen: () => {},
		};
		const tileSelector = `[data-system-id="${ gamesTile.id }"]`;

		test( 'a pre-existing "hidden" preference keeps the tile off the dock but tracked', () => {
			const { deps } = makeDeps( {
				getSettings: () => ( {
					navPlacement: { 'desktop-mode-games': 'hidden' },
					navOrder: [],
				} ),
			} );
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
			);
			dispatcher.appendSystemTile( gamesTile );
			expect(
				document
					.getElementById( 'os-dock' )!
					.querySelector( tileSelector ),
			).toBeNull();

			expect(
				dispatcher.listSystemTiles().map( ( t ) => t.id ),
			).toContain( gamesTile.id );
		} );

		test( 'a "desktop"-only preference also keeps the tile off the dock', () => {
			const { deps } = makeDeps( {
				getSettings: () => ( {
					navPlacement: { 'desktop-mode-games': 'desktop' },
					navOrder: [],
				} ),
			} );
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
			);
			dispatcher.appendSystemTile( gamesTile );
			expect(
				document
					.getElementById( 'os-dock' )!
					.querySelector( tileSelector ),
			).toBeNull();
		} );

		test( 'a desktop-only app joins the rail while its window is open', () => {
			const open: Array< { id: string; config: Record< string, unknown > } > =
				[];
			const { deps } = makeDeps();
			deps.windowManager.getAll = ( () =>
				open ) as typeof deps.windowManager.getAll;

			createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[
					{
						id: 'wp-explorer-icon',
						title: 'WP Explorer',
						icon: 'dashicons-admin-site',
						window: 'my-wordpress',
						url: '',
					} as never,
				],
			);
			const railTile = () =>
				document
					.getElementById( 'os-dock' )!
					.querySelector( '[data-nav-id="wp-explorer-icon"]' );

			expect( railTile() ).toBeNull();

			open.push( { id: 'my-wordpress', config: {} } );
			document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );
			expect( railTile() ).not.toBeNull();

			open.length = 0;
			document.dispatchEvent( new CustomEvent( 'os-window-closed' ) );
			expect( railTile() ).toBeNull();
		} );

		test( 'a desktop-only system tile joins the rail while its window is open', () => {
			const open: Array< { id: string; config: Record< string, unknown > } > =
				[];
			const { deps } = makeDeps( {
				getSettings: () => ( {
					navPlacement: { 'desktop-mode-games': 'desktop' },
					navOrder: [],
				} ),
			} );
			deps.windowManager.getAll = ( () =>
				open ) as typeof deps.windowManager.getAll;

			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
			);
			dispatcher.appendSystemTile( gamesTile );
			const tile = () =>
				document
					.getElementById( 'os-dock' )!
					.querySelector( tileSelector );

			expect( tile() ).toBeNull();

			open.push( { id: 'desktop-mode-games', config: {} } );
			document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );
			expect( tile() ).not.toBeNull();

			open.length = 0;
			document.dispatchEvent( new CustomEvent( 'os-window-closed' ) );
			expect( tile() ).toBeNull();
		} );

		test( 'a hidden app still gets a tile while its window is open', () => {
			const open: Array< { id: string; config: Record< string, unknown > } > =
				[];
			const { deps } = makeDeps( {
				getSettings: () => ( {
					navPlacement: { 'desktop-mode-games': 'hidden' },
					navOrder: [],
				} ),
			} );
			deps.windowManager.getAll = ( () =>
				open ) as typeof deps.windowManager.getAll;

			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
			);
			dispatcher.appendSystemTile( gamesTile );
			const tile = () =>
				document
					.getElementById( 'os-dock' )!
					.querySelector( tileSelector );

			expect( tile() ).toBeNull();

			open.push( { id: 'desktop-mode-games', config: {} } );
			document.dispatchEvent( new CustomEvent( 'os-window-opened' ) );
			expect( tile() ).not.toBeNull();

			open.length = 0;
			document.dispatchEvent( new CustomEvent( 'os-window-closed' ) );
			expect( tile() ).toBeNull();
		} );

		test( 'refresh() detaches a live tile on hide and re-attaches it on unhide', () => {
			const navPlacement: Record<
				string,
				'both' | 'rail' | 'desktop' | 'hidden'
			> = {};
			const { deps } = makeDeps( {
				getSettings: () => ( { navPlacement, navOrder: [] } ),
			} );
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
			);
			dispatcher.appendSystemTile( gamesTile );
			const dock = document.getElementById( 'os-dock' )!;
			expect( dock.querySelector( tileSelector ) ).not.toBeNull();

			navPlacement[ 'desktop-mode-games' ] = 'hidden';
			dispatcher.refresh();
			expect( dock.querySelector( tileSelector ) ).toBeNull();

			navPlacement[ 'desktop-mode-games' ] = 'both';
			dispatcher.refresh();
			expect( dock.querySelector( tileSelector ) ).not.toBeNull();
		} );

		test( 'a layout rebuild does not resurrect a hidden tile', () => {
			const { deps } = makeDeps( {
				getSettings: () => ( {
					navPlacement: { 'desktop-mode-games': 'hidden' },
					navOrder: [],
				} ),
			} );
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
			);
			dispatcher.appendSystemTile( gamesTile );
			dispatcher.setLayout( 'classic' );
			expect(
				document
					.getElementById( 'os-dock' )!
					.querySelector( tileSelector ),
			).toBeNull();
		} );

		test( 'an app registered as both a window tile and an icon has one answer', () => {
			const { deps } = makeDeps();
			const serverIcons: DesktopIconServerEntry[] = [
				{
					id: 'desktop-mode-games',
					title: 'Games',
					icon: 'dashicons-games',
					window: 'desktop-mode-games',
					url: '',
					position: 85,
				},
			];
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				serverIcons,
			);
			dispatcher.appendSystemTile( {
				...gamesTile,
				navKind: 'app',
			} );

			expect(
				dispatcher.getNavItems().filter( ( i ) =>
					i.id === 'desktop-mode-games',
				),
			).toHaveLength( 1 );
			expect(
				document
					.getElementById( 'os-dock' )!
					.querySelector( tileSelector ),
			).toBeNull();
			expect(
				dispatcher.getNav().desktop.map( ( i ) => i.id ),
			).toContain( 'desktop-mode-games' );
		} );

		test( 'a preference keyed by the icon covers the tile its window backs', () => {

			const { deps } = makeDeps( {
				getSettings: () => ( {
					navPlacement: { 'desktop-mode-games': 'hidden' },
					navOrder: [],
				} ),
			} );
			const serverIcons: DesktopIconServerEntry[] = [
				{
					id: 'games-icon',
					title: 'Games',
					icon: 'dashicons-games',
					window: 'desktop-mode-games',
					url: '',
					position: 85,
				},
			];
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				serverIcons,
			);
			dispatcher.appendSystemTile( gamesTile );
			expect(
				document
					.getElementById( 'os-dock' )!
					.querySelector( tileSelector ),
			).toBeNull();
		} );
	} );

	test( 'destroy: tears down both docks and removes the side dock element', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		expect(
			document.getElementById( 'os-side-dock' ),
		).not.toBeNull();
		dispatcher.destroy();
		expect( document.getElementById( 'os-side-dock' ) ).toBeNull();
	} );
} );

describe( 'desktop-layout dispatcher — settings sanitization', () => {
	test( 'invalid desktopLayout in persisted state falls back to default', async () => {
		const stateModule = await import( '../../src/settings/state' );
		const constants = await import( '../../src/settings/constants' );

		( window as unknown as { openStationConfig?: unknown } ).openStationConfig = {
			osSettings: {
				wallpaper: 'dark',
				accent: 'wp-blue',
				dockSize: 'default',
				desktopLayout: 'made-up-value',
			},
		};
		const state = stateModule.loadState();
		expect( state.desktopLayout ).toBe( constants.DEFAULTS.desktopLayout );
		( window as unknown as { openStationConfig?: unknown } ).openStationConfig =
			undefined;
	} );
} );
