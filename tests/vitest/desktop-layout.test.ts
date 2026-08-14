/**
 * Tests for `src/desktop-layout.ts` — the layout dispatcher that owns
 * the `Dock` instance(s) and the synthesized desktop icons across
 * Classic / Unified / Spatial / OpenStation.
 *
 * Pins down the user-visible shape of each layout:
 *
 * - Classic: TWO docks. Left side bar (id `#os-side-dock`,
 *   `data-os-dock-placement="left"`) holds `isCore` items;
 *   bottom dock (existing `#os-dock`,
 *   `data-os-dock-placement="bottom"`) holds the rest.
 * - Unified: ONE dock at the bottom; every menu item lives there.
 * - Spatial: ONE dock at the bottom with non-core items; core items
 *   are synthesized into the desktop-icons list and pushed through
 *   `renderIcons`. Server-registered icons are PRESERVED and concatenated
 *   ahead of synthesized ones so plugin icons aren't shadowed.
 * - OpenStation: ONE dock at the bottom holding every menu, but
 *   RE-SORTED core-first so the rail's single `--group` separator
 *   always lands on the core→plugin boundary. Icons behave as they do
 *   in Classic / Unified.
 *
 * Also pins layout transitions: switching layouts tears down the old
 * docks (no leaked DOM, no leaked side-dock element on switch away
 * from Classic) and emits a `os-layout-changed` event so
 * plugins that cache `wp.os.dock` can refresh their reference.
 */
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
		/**
		 * Read the rail in visual order: tile slugs, with the divider
		 * that `Dock` inserts at the core-to-plugin boundary marked.
		 */
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
			// A plugin that registers its menu high up — Yoast and
			// Jetpack both do. In menu order the divider would be
			// dropped right after Dashboard, stranding Posts and
			// Settings on the plugin side of a line that then claims
			// nothing true.
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
			// A plugin activates mid-session and lands mid-menu.
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

			// Core keeps Posts-then-Dashboard and plugins keep
			// Woo-then-Yoast: grouping moves the clusters, never the
			// tiles within one, so a user's drag-to-reorder still holds.
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
			// A rail cannot be re-oriented in place — placement reaches
			// a renderer through `mount()`, so the instance is new.
			expect( dispatcher.getPrimary() ).not.toBe( before );
			// …and the tiles came back with it.
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

			// The side bar already owns the left edge; honouring the pick
			// would stack the two rails on top of each other, so the
			// plugin rail stays on the bottom and nothing is rebuilt.
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

			// Stored all the same: switching to a one-rail layout lands
			// on the edge the user chose while wearing Classic.
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
			dispatcher.appendSystemTile(
				{
					id: 'os-settings',
					title: 'OpenStation Preferences',
					icon: 'dashicons-admin-generic',
					onOpen: () => undefined,
				},
				'core',
			);
			dispatcher.setDockPlacement( 'left' );
			const dock = document.getElementById( 'os-dock' )!;
			expect(
				dock.querySelectorAll( '.os-dock__item--system' ).length,
			).toBe( 1 );
			// The WordPress-to-OpenStation divider comes with them.
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

	test( 'appendSystemTile: core affinity lands on the side dock in classic', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( noopTile, 'core' );
		expect(
			document
				.getElementById( 'os-side-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).toBeNull();
	} );

	test( 'appendSystemTile: core affinity falls back to primary in unified', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( noopTile, 'core' );
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();
	} );

	test( 'appendSystemTile: plugin affinity (default) always goes to primary', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( noopTile );
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();
		expect(
			document
				.getElementById( 'os-side-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).toBeNull();
	} );

	test( 'core-affinity tile follows the layout: classic side → unified primary', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( noopTile, 'core' );
		dispatcher.setLayout( 'unified' );
		// Side dock element is gone; tile should re-attach to the
		// rebuilt primary (bottom) dock since there's no side rail
		// in unified.
		expect(
			document.getElementById( 'os-side-dock' ),
		).toBeNull();
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
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
		dispatcher.appendSystemTile( noopTile );
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();

		// Switch layout — the bottom dock is rebuilt; the tracked
		// system tile must re-attach to the new instance.
		dispatcher.setLayout( 'classic' );
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
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
		dispatcher.appendSystemTile( noopTile );
		dispatcher.removeSystemTile( noopTile.id );
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).toBeNull();

		// Layout rebuild must not resurrect the removed tile.
		dispatcher.setLayout( 'classic' );
		expect(
			document
				.getElementById( 'os-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).toBeNull();
	} );

	// Regression tests for https://github.com/WordPress/openstation/issues/405 —
	// native windows registered with `placement: 'dock'` (Games) land on
	// the rails as system tiles, which used to bypass the Apps & Icons
	// `itemVisibility` overrides entirely: hiding the item removed the
	// wallpaper icon but the dock tile stayed.
	describe( 'system tiles honor Apps & Icons visibility overrides', () => {
		const gamesTile: SystemDockItem = {
			id: 'desktop-mode-games',
			title: 'Games',
			icon: 'dashicons-games',
			onOpen: () => {},
		};
		const tileSelector = `[data-system-id="${ gamesTile.id }"]`;

		test( 'a pre-existing "hidden" override keeps the tile off the dock but tracked', () => {
			const { deps } = makeDeps( {
				getSettings: () => ( {
					itemVisibility: { 'desktop-mode-games': 'hidden' },
					dockOrder: [],
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
			// Still tracked — flipping the setting back must restore it.
			expect(
				dispatcher.listSystemTiles().map( ( t ) => t.id ),
			).toContain( gamesTile.id );
		} );

		test( 'a "desktop"-only override also keeps the tile off the dock', () => {
			const { deps } = makeDeps( {
				getSettings: () => ( {
					itemVisibility: { 'desktop-mode-games': 'desktop' },
					dockOrder: [],
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

		test( 'refresh() detaches a live tile on hide and re-attaches it on unhide', () => {
			const visibility: Record< string, 'both' | 'dock' | 'desktop' | 'hidden' > =
				{};
			const { deps } = makeDeps( {
				getSettings: () => ( { itemVisibility: visibility, dockOrder: [] } ),
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

			// User picks "Hidden" in OS Settings → Apps & Icons; the
			// settings subscription calls refresh().
			visibility[ 'desktop-mode-games' ] = 'hidden';
			dispatcher.refresh();
			expect( dock.querySelector( tileSelector ) ).toBeNull();

			// And back.
			visibility[ 'desktop-mode-games' ] = 'both';
			dispatcher.refresh();
			expect( dock.querySelector( tileSelector ) ).not.toBeNull();
		} );

		test( 'a layout rebuild does not resurrect a hidden tile', () => {
			const { deps } = makeDeps( {
				getSettings: () => ( {
					itemVisibility: { 'desktop-mode-games': 'hidden' },
					dockOrder: [],
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

		test( 'an override keyed by the desktop icon targeting the window hides the tile', () => {
			// The Apps & Icons tab keys its rows by icon id, which may
			// differ from the native-window id the tile is keyed by.
			const { deps } = makeDeps( {
				getSettings: () => ( {
					itemVisibility: { 'games-icon': 'hidden' },
					dockOrder: [],
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
		// Drive `_parseRaw` via the public `loadState` path. Set the
		// global config so the server-snapshot branch fires.
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
