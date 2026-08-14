/**
 * Tests for the visibility → files-store reconciler.
 *
 * Specifically covers the user-reported "Also show on desktop" bug:
 * after hiding a server-registered icon from the desktop (visibility
 * = 'dock'), flipping its visibility back to 'desktop' or 'both' must
 * re-surface the placement in the files store on the SAME tick,
 * without F5.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type SyncModule = typeof import( '../../src/settings/desktop-shortcuts-sync' );
type StoreModule = typeof import( '../../src/desktop-files/store' );

async function load(): Promise< { sync: SyncModule; store: StoreModule } > {
	vi.resetModules();
	return {
		sync: await import( '../../src/settings/desktop-shortcuts-sync' ),
		store: await import( '../../src/desktop-files/store' ),
	};
}

function placement( id: number, ref: string ): import('../../src/desktop-files/rest').RestPlacementShape {
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

type TestDockItem = {
	id: string;
	title: string;
	icon: string;
	url: string;
	badge?: number;
	submenu?: { title: string; url: string }[];
	isCore?: boolean;
};

function installDesktopConfig(
	icons: Array< { id: string; title: string; icon: string; url: string; window: string; position: number } >,
	dockItems: TestDockItem[] = [],
): void {
	( window as unknown as { openStationConfig: unknown } ).openStationConfig = {
		desktopIcons: icons,
		dockItems,
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

describe( 'syncShortcutsWithVisibility — server-icon visibility round-trip', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
	} );

	test( 'hiding a server icon removes its placement; restoring re-adds it', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();
		installDesktopConfig( [ {
			id: 'desktop-mode-my-wordpress',
			title: 'My WordPress',
			icon: 'dashicons-wordpress',
			url: '',
			window: 'desktop-mode-my-wordpress',
			position: 100,
		} ] );

		// Seed the store with the icon's placement (as REST hydration
		// would have done on page load).
		store.setFolderPlacements( 0, [
			placement( 42, 'desktop-mode-my-wordpress' ),
		] );

		// 1) User picks "Hide from desktop" → visibility 'dock'.
		//    The reconciler removes the placement.
		sync.syncShortcutsWithVisibility( {
			'desktop-mode-my-wordpress': 'dock',
		} );
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length,
		).toBe( 0 );

		// 2) User picks "Also show on desktop" → visibility 'both'.
		//    The reconciler MUST restore the placement on the same tick.
		sync.syncShortcutsWithVisibility( {
			'desktop-mode-my-wordpress': 'both',
		} );
		const rows = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		expect( rows.length ).toBe( 1 );
		expect( rows[ 0 ].id ).toBe( 42 );
		expect( rows[ 0 ].file.ref ).toBe( 'desktop-mode-my-wordpress' );
	} );

	test( 'flip dock → desktop also restores without F5', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();
		installDesktopConfig( [ {
			id: 'desktop-mode-recycle-bin',
			title: 'Recycle Bin',
			icon: 'dashicons-trash',
			url: '',
			window: 'desktop-mode-recycle-bin',
			position: 200,
		} ] );

		store.setFolderPlacements( 0, [
			placement( 13, 'desktop-mode-recycle-bin' ),
		] );

		sync.syncShortcutsWithVisibility( {
			'desktop-mode-recycle-bin': 'hidden',
		} );
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length,
		).toBe( 0 );

		sync.syncShortcutsWithVisibility( {
			'desktop-mode-recycle-bin': 'desktop',
		} );
		const rows = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		expect( rows.map( ( r ) => r.id ) ).toContain( 13 );
	} );
} );

describe( 'syncShortcutsWithVisibility — promoting a system tile', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		delete ( window as unknown as { openStationConfig?: unknown } )
			.openStationConfig;
	} );

	function stubSystemTiles(
		tiles: Array< {
			id: string;
			title: string;
			icon: string;
			placeable: boolean;
		} >,
	): void {
		const w = window as unknown as {
			wp?: { os?: Record< string, unknown > };
		};
		w.wp = w.wp ?? {};
		w.wp.os = w.wp.os ?? {};
		w.wp.os.listSystemTiles = () => tiles;
	}

	const mio = {
		id: 'os-mio-toggle',
		title: 'Mio',
		icon: 'dashicons-superhero-alt',
		placeable: true,
	};

	test( 'a placeable tile stays off the wallpaper until asked for', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();
		installDesktopConfig( [] );
		stubOsSettings();
		stubSystemTiles( [ mio ] );

		// The dock is its native rail, so no override means no tile.
		sync.syncShortcutsWithVisibility( {} );
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length ?? 0,
		).toBe( 0 );
	} );

	test( 'desktop / both promote it, and the tile carries its opener', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();
		installDesktopConfig( [] );
		stubOsSettings();
		stubSystemTiles( [ mio ] );

		for ( const pick of [ 'desktop', 'both' ] as const ) {
			sync.syncShortcutsWithVisibility( { 'os-mio-toggle': pick } );
			const rows =
				store.getFilesState().placementsByFolder.get( 0 ) ?? [];
			expect( rows ).toHaveLength( 1 );
			expect( rows[ 0 ].file.title ).toBe( 'Mio' );
			// Not a url and not a window: the opener runs the tile's
			// own onOpen, which is the only thing a toggle tile has.
			expect(
				( rows[ 0 ].file as unknown as {
					shortcutSystemTile?: string;
				} ).shortcutSystemTile,
			).toBe( 'os-mio-toggle' );
		}
	} );

	test( 'taking it back off the desktop removes the placement', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();
		installDesktopConfig( [] );
		stubOsSettings();
		stubSystemTiles( [ mio ] );

		sync.syncShortcutsWithVisibility( { 'os-mio-toggle': 'both' } );
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length,
		).toBe( 1 );

		sync.syncShortcutsWithVisibility( { 'os-mio-toggle': 'dock' } );
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length ?? 0,
		).toBe( 0 );
	} );

	test( 'a tile that did not opt in is never promoted', async () => {
		const { sync, store } = await load();
		store.__resetFilesStoreForTests();
		installDesktopConfig( [] );
		stubOsSettings();
		stubSystemTiles( [ { ...mio, id: 'os-exit', placeable: false } ] );

		sync.syncShortcutsWithVisibility( { 'os-exit': 'desktop' } );
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length ?? 0,
		).toBe( 0 );
	} );
} );

