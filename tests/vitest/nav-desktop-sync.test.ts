/**
 * Tests for the navigation → files-store reconciler.
 *
 * Two jobs. One is minting a placement for anything on the wallpaper
 * that has no registered icon behind it — a promoted admin menu, a
 * system tile. The other is the user-reported "Also show on desktop"
 * bug: after taking a server-registered icon off the wallpaper, putting
 * it back must re-surface the placement on the SAME tick, without F5.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { NavItem } from '../../src/nav';
import type { RestPlacementShape } from '../../src/desktop-files/rest';

type SyncModule = typeof import( '../../src/nav/desktop-sync' );
type StoreModule = typeof import( '../../src/desktop-files/store' );

async function load(): Promise< { sync: SyncModule; store: StoreModule } > {
	vi.resetModules();
	return {
		sync: await import( '../../src/nav/desktop-sync' ),
		store: await import( '../../src/desktop-files/store' ),
	};
}

function placement( id: number, ref: string ): RestPlacementShape {
	return {
		id,
		parentId: 0,
		x: 0,
		y: 0,
		sortOrder: 0,
		updatedAtMs: 1,
		meta: null,
		file: {
			type: 'shortcut',
			ref,
			title: `Tile ${ ref }`,
			icon: 'dashicons-admin-generic',
			previewUrl: '',
			exists: true,
		},
	};
}

/** A nav item backed by a registered desktop icon. */
function iconItem( id: string, title: string ): NavItem {
	return {
		id,
		kind: 'app',
		title,
		icon: 'dashicons-admin-generic',
		windowId: id,
		entry: {
			id,
			title,
			icon: 'dashicons-admin-generic',
			window: id,
			url: '',
			position: 100,
		},
	};
}

/** A nav item backed by a system tile — no icon of its own. */
function tileItem( id: string, title: string ): NavItem {
	return {
		id,
		kind: 'control',
		title,
		icon: 'dashicons-superhero-alt',
		windowId: id,
		tile: {
			id,
			title,
			icon: 'dashicons-superhero-alt',
			windowId: id,
			placeable: true,
			onOpen: () => {},
		},
	};
}

function stubOsSettings(
	dockPromotedPositions: Record< string, { x: number; y: number } > = {},
): { updateOsSettings: ReturnType< typeof vi.fn > } {
	const updateOsSettings = vi.fn();
	const w = window as unknown as { wp?: { os?: Record< string, unknown > } };
	w.wp = w.wp ?? {};
	w.wp.os = w.wp.os ?? {};
	w.wp.os.getOsSettings = () => ( { dockPromotedPositions } );
	w.wp.os.updateOsSettings = updateOsSettings;
	return { updateOsSettings };
}

describe( 'syncDesktopShortcuts — registered icons', () => {
	beforeEach( () => {
		installHooksStub();
		stubOsSettings();
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'taking an icon off the wallpaper removes its placement; putting it back re-adds it', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();
		const item = iconItem( 'desktop-mode-my-wordpress', 'My WordPress' );

		// Seed the store with the icon's placement, as REST hydration
		// would have done on page load.
		store.setFolderPlacements( 0, [
			placement( 42, 'desktop-mode-my-wordpress' ),
		] );

		// 1) The navigation no longer lists it on the desktop.
		sync.syncDesktopShortcuts( [], [ item ] );
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length,
		).toBe( 0 );

		// 2) It comes back — the reconciler MUST restore the placement
		//    on the same tick, with its original row id.
		sync.syncDesktopShortcuts( [ item ], [ item ] );
		const rows = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		expect( rows.length ).toBe( 1 );
		expect( rows[ 0 ].id ).toBe( 42 );
		expect( rows[ 0 ].file.ref ).toBe( 'desktop-mode-my-wordpress' );
	} );

	test( 'an icon the navigation keeps on the wallpaper is left alone', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();
		const item = iconItem( 'desktop-mode-recycle-bin', 'Recycle Bin' );
		store.setFolderPlacements( 0, [
			placement( 13, 'desktop-mode-recycle-bin' ),
		] );

		sync.syncDesktopShortcuts( [ item ], [ item ] );
		const rows = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		expect( rows.map( ( r ) => r.id ) ).toEqual( [ 13 ] );
	} );
} );

describe( 'syncDesktopShortcuts — items with no icon of their own', () => {
	beforeEach( () => {
		installHooksStub();
		stubOsSettings();
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	const mio = tileItem( 'os-mio-toggle', 'Mio' );

	test( 'a tile the navigation leaves off the wallpaper mints nothing', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();

		sync.syncDesktopShortcuts( [], [ mio ] );
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length ?? 0,
		).toBe( 0 );
	} );

	test( 'a promoted tile carries its own opener', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();

		sync.syncDesktopShortcuts( [ mio ], [ mio ] );
		const rows = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		expect( rows ).toHaveLength( 1 );
		expect( rows[ 0 ].file.title ).toBe( 'Mio' );
		// Not a url and not a window: the opener runs the tile's own
		// onOpen, which is the only thing a toggle tile has.
		expect(
			( rows[ 0 ].file as unknown as { shortcutSystemTile?: string } )
				.shortcutSystemTile,
		).toBe( 'os-mio-toggle' );
		// And it keeps its bare id as the ref, which is how the files
		// layer and the dock recognise the Trash.
		expect( rows[ 0 ].file.ref ).toBe( 'os-mio-toggle' );
	} );

	test( 'a promoted admin menu is namespaced so it cannot shadow a real icon', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();
		const posts: NavItem = {
			id: 'edit-php',
			kind: 'core',
			title: 'Posts',
			icon: 'dashicons-admin-post',
			menu: {
				id: 'edit-php',
				title: 'Posts',
				icon: 'dashicons-admin-post',
				url: 'edit.php',
				badge: 0,
				submenu: [],
				isCore: true,
			},
		};

		sync.syncDesktopShortcuts( [ posts ], [ posts ] );
		const rows = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		expect( rows[ 0 ].file.ref ).toBe( 'dock-promoted:edit-php' );
		expect(
			( rows[ 0 ].file as unknown as { shortcutUrl?: string } )
				.shortcutUrl,
		).toBe( 'edit.php' );
	} );

	test( 'taking it back off the wallpaper removes the placement', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();

		sync.syncDesktopShortcuts( [ mio ], [ mio ] );
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length,
		).toBe( 1 );

		sync.syncDesktopShortcuts( [], [ mio ] );
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length ?? 0,
		).toBe( 0 );
	} );

	test( 'a stored position is restored instead of resetting to the corner', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();

		sync.syncDesktopShortcuts( [ mio ], [ mio ], {
			'os-mio-toggle': { x: 240, y: 96 },
		} );
		const rows = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		expect( [ rows[ 0 ].x, rows[ 0 ].y ] ).toEqual( [ 240, 96 ] );
	} );
} );
