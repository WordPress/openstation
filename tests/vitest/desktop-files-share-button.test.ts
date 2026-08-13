/**
 * The "Share folder" title-bar button, and the folders map it reads.
 *
 * The button is owner-only, and a window gives its match predicate
 * nothing but an id — so ownership has to come from the client's
 * folders map. Nothing on the normal boot path filled that map:
 * placement hydration populates placements, and `listFolders()` only
 * ran after a create, a rename or an untrash. After a plain reload
 * every folder looked ownerless, `folderOwnerId()` returned 0, the
 * gate compared 0 against a real user id, and the owner of a folder
 * lost the control that manages its sharing.
 *
 * The rows now ride the boot config as `filesBootFolders` (see
 * `openstation_files_inject_boot_folders()`), and this pins both
 * halves: the seed applies them, and the gate then answers correctly
 * for owner and recipient.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { RestFolderShape } from '../../src/desktop-files/rest';
import type { Window as DesktopWindow } from '../../src/window';

const OWNER = 7;
const RECIPIENT = 9;

type Modules = {
	seed: typeof import( '../../src/desktop-files/boot-folders' );
	store: typeof import( '../../src/desktop-files/store' );
	share: typeof import( '../../src/desktop-files/share-menu-items' );
	titleBar: typeof import( '../../src/title-bar-buttons/registry' );
};

let mods: Modules;

async function load(): Promise< Modules > {
	return {
		seed: await import( '../../src/desktop-files/boot-folders' ),
		store: await import( '../../src/desktop-files/store' ),
		share: await import( '../../src/desktop-files/share-menu-items' ),
		titleBar: await import( '../../src/title-bar-buttons/registry' ),
	};
}

function folderRow( id: number, ownerId: number ): RestFolderShape {
	return {
		id,
		ownerId,
		name: `Folder ${ id }`,
		shareMode: 'private',
		shareMeta: null,
		updatedAtMs: 1,
	};
}

/** Just enough window for the button registry's match predicate. */
function folderWindow( folderId: number ): DesktopWindow {
	return {
		id: `os-folder-${ folderId }`,
		config: { baseId: `os-folder-${ folderId }`, title: 'Folder' },
	} as unknown as DesktopWindow;
}

function setBootFolders( rows: RestFolderShape[] | undefined ): void {
	( window as unknown as { openStationConfig?: unknown } ).openStationConfig = {
		currentUserId: OWNER,
		...( rows === undefined ? {} : { filesBootFolders: rows } ),
	};
}

/** Does the share button match this window? */
function hasShareButton( win: DesktopWindow ): boolean {
	const { right } = mods.titleBar.buttonsForWindow( win );
	return right.some( ( b ) => b.id === 'desktop-mode/folder-share' );
}

beforeEach( async () => {
	vi.resetModules();
	installHooksStub();
	setBootFolders( undefined );
	mods = await load();
	// Both registries are `createSharedStore`-backed, which is
	// deliberately immune to `vi.resetModules()` — reset them by hand
	// or each test inherits the previous one's folders and buttons.
	mods.store.__resetFilesStoreForTests();
	mods.titleBar.unregisterTitleBarButton( 'desktop-mode/folder-share' );
} );

afterEach( () => {
	clearHooksStub();
	mods.titleBar.unregisterTitleBarButton( 'desktop-mode/folder-share' );
	delete ( window as unknown as { openStationConfig?: unknown } )
		.openStationConfig;
} );

describe( 'boot-folder seeding', () => {
	test( 'applies the rows the shell inlined', () => {
		setBootFolders( [ folderRow( 3, OWNER ), folderRow( 4, RECIPIENT ) ] );

		expect( mods.seed.seedBootFolders() ).toBe( true );

		const folders = mods.store.getFilesState().folders;
		expect( folders.get( 3 )?.ownerId ).toBe( OWNER );
		expect( folders.get( 4 )?.ownerId ).toBe( RECIPIENT );
	} );

	test( 'is one-shot — a later re-hydration must refetch, not reuse', () => {
		setBootFolders( [ folderRow( 3, OWNER ) ] );

		expect( mods.seed.seedBootFolders() ).toBe( true );
		expect( mods.seed.seedBootFolders() ).toBe( false );

		const config = ( window as unknown as {
			openStationConfig?: { filesBootFolders?: unknown };
		} ).openStationConfig;
		expect( config?.filesBootFolders ).toBeUndefined();
	} );

	test( 'no snapshot leaves the store untouched', () => {
		expect( mods.seed.seedBootFolders() ).toBe( false );
		expect( mods.store.getFilesState().folders.size ).toBe( 0 );
	} );

	test( 'the files entry point actually calls it on boot', async () => {
		// The tests above drive `seedBootFolders()` directly, which
		// would keep passing if the one line wiring it into boot were
		// dropped — the exact shape of the bug being fixed. Importing
		// the entry point is what pins the wiring.
		setBootFolders( [ folderRow( 3, OWNER ) ] );
		await import( '../../src/desktop-files/index' );

		expect( mods.store.getFilesState().folders.get( 3 )?.ownerId ).toBe(
			OWNER,
		);
	} );
} );

describe( 'Share folder title-bar button', () => {
	test( 'the owner gets it after a plain boot', () => {
		setBootFolders( [ folderRow( 3, OWNER ) ] );
		mods.seed.seedBootFolders();
		mods.share.installShareMenuItems();

		expect( hasShareButton( folderWindow( 3 ) ) ).toBe( true );
	} );

	test( 'without the seed the owner loses it — the reported regression', () => {
		// Same folder, same viewer; only the seed is missing. This is
		// what every reload used to look like.
		setBootFolders( undefined );
		mods.share.installShareMenuItems();

		expect( hasShareButton( folderWindow( 3 ) ) ).toBe( false );
	} );

	test( 'a recipient does not get it', () => {
		setBootFolders( [ folderRow( 3, RECIPIENT ) ] );
		mods.seed.seedBootFolders();
		mods.share.installShareMenuItems();

		// Viewer is OWNER; folder 3 is owned by someone else.
		expect( hasShareButton( folderWindow( 3 ) ) ).toBe( false );
	} );

	test( 'non-folder windows are left alone', () => {
		setBootFolders( [ folderRow( 3, OWNER ) ] );
		mods.seed.seedBootFolders();
		mods.share.installShareMenuItems();

		const win = {
			id: 'os-window-edit-php',
			config: { baseId: 'os-window-edit-php', title: 'Posts' },
		} as unknown as DesktopWindow;
		expect( hasShareButton( win ) ).toBe( false );
	} );

	test( 'the per-user sharing kill switch still hides it', () => {
		setBootFolders( [ folderRow( 3, OWNER ) ] );
		mods.seed.seedBootFolders();
		mods.share.installShareMenuItems();
		( window as unknown as { wp?: unknown } ).wp = {
			os: { getOsSettings: () => ( { foldersSharingEnabled: false } ) },
		};

		expect( hasShareButton( folderWindow( 3 ) ) ).toBe( false );

		delete ( window as unknown as { wp?: unknown } ).wp;
	} );
} );
