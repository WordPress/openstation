/**
 * Addressing a folder by id alone — `folderFileById()` and the
 * conflict toast's "View folder" action that depends on it.
 *
 * The toast learns about a folder from a 409 response: an id and a
 * name, no tile, no serialized shape. It still has to open the same
 * folder window a double-click on that folder's tile would open, and
 * it gets there by building a `DesktopFile` and handing it to the
 * ordinary opener registry rather than by reconstructing the window
 * itself.
 *
 * These tests pin the resolution order (server shape > store row >
 * caller fallback) and the dispatch — including that an already-open
 * folder window is reused rather than rebuilt, which comes free from
 * routing through the registered opener.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type FolderRefModule = typeof import( '../../src/desktop-files/folder-ref' );
type StoreModule = typeof import( '../../src/desktop-files/store' );
type OpenersModule = typeof import( '../../src/desktop-files/openers' );
type OpenModule = typeof import( '../../src/desktop-files/open' );
type TypesModule = typeof import( '../../src/desktop-files/built-in-types' );
type ConflictModule = typeof import( '../../src/desktop-files/conflict-toast' );
type RestModule = typeof import( '../../src/desktop-files/rest' );
type ToastModule = typeof import( '../../src/toast' );

async function load(): Promise< {
	folderRef: FolderRefModule;
	store: StoreModule;
	openers: OpenersModule;
	open: OpenModule;
	types: TypesModule;
	conflict: ConflictModule;
	rest: RestModule;
	toast: ToastModule;
} > {
	vi.resetModules();
	const modules = {
		folderRef: await import( '../../src/desktop-files/folder-ref' ),
		store: await import( '../../src/desktop-files/store' ),
		openers: await import( '../../src/desktop-files/openers' ),
		open: await import( '../../src/desktop-files/open' ),
		types: await import( '../../src/desktop-files/built-in-types' ),
		conflict: await import( '../../src/desktop-files/conflict-toast' ),
		rest: await import( '../../src/desktop-files/rest' ),
		toast: await import( '../../src/toast' ),
	};
	modules.types.registerBuiltInFileTypes();
	return modules;
}

/** A server-serialized placement whose file IS the given folder. */
function folderPlacement( folderId: number, title: string, icon: string ) {
	return {
		id: 900 + folderId,
		parentId: 0,
		x: 0,
		y: 0,
		sortOrder: 0,
		updatedAtMs: 1,
		meta: null,
		file: {
			type: 'folder',
			ref: String( folderId ),
			title,
			icon,
			previewUrl: '',
			exists: true,
		},
	};
}

/**
 * The files store is a `createSharedStore`, so it lives on a global
 * and `vi.resetModules()` does NOT clear it — state would leak from
 * one test into the next and a fallback assertion would read the
 * previous test's placement. Reset it explicitly.
 */
async function resetStore(): Promise< void > {
	const store = await import( '../../src/desktop-files/store' );
	store.__resetFilesStoreForTests();
}

describe( 'folderFileById — resolution order', () => {
	beforeEach( async () => {
		installHooksStub();
		await resetStore();
	} );

	afterEach( async () => {
		await resetStore();
		clearHooksStub();
	} );

	test( "prefers the server's own shape from a loaded placement", async () => {
		const { folderRef, store } = await load();
		// A plugin's serialize filter renamed it and gave it a custom
		// icon — the server is authoritative and we must not
		// second-guess it.
		store.setFolderPlacements( 0, [
			folderPlacement( 12, 'Q3 Campaign', 'dashicons-megaphone' ),
		] );

		const file = folderRef.folderFileById( 12, 'ignored fallback' );

		expect( file.type() ).toBe( 'folder' );
		expect( file.ref() ).toBe( '12' );
		expect( file.title() ).toBe( 'Q3 Campaign' );
		expect( file.icon() ).toBe( 'dashicons-megaphone' );
	} );

	test( 'finds the placement wherever in the tree it is loaded', async () => {
		const { folderRef, store } = await load();
		// Nested, not on the desktop root — the search has to walk
		// every loaded folder, not just folder 0.
		store.setFolderPlacements( 7, [
			folderPlacement( 12, 'Nested', 'dashicons-portfolio' ),
		] );

		expect( folderRef.folderFileById( 12 ).title() ).toBe( 'Nested' );
	} );

	test( 'falls back to the folder row name when no placement is loaded', async () => {
		const { folderRef, store } = await load();
		store.setFolders( [
			{
				id: 12,
				ownerId: 1,
				name: 'Named by the row',
				shareMode: 'private',
				shareMeta: null,
				updatedAtMs: 1,
			},
		] );

		const file = folderRef.folderFileById( 12, 'ignored fallback' );

		expect( file.title() ).toBe( 'Named by the row' );
		expect( file.icon() ).toBe( 'dashicons-portfolio' );
	} );

	test( "falls back to the caller's title when the store knows nothing", async () => {
		const { folderRef } = await load();

		const file = folderRef.folderFileById( 99, 'From the conflict' );

		expect( file.ref() ).toBe( '99' );
		expect( file.title() ).toBe( 'From the conflict' );
	} );

	test( 'still produces a usable file with no title at all', async () => {
		const { folderRef } = await load();

		const file = folderRef.folderFileById( 99 );

		expect( file.type() ).toBe( 'folder' );
		expect( file.title() ).toBeTruthy();
	} );

	test( 'ignores a placement of a different type with the same ref', async () => {
		const { folderRef, store } = await load();
		// Post 12 is not folder 12. Matching on ref alone would open a
		// folder window titled after a post.
		store.setFolderPlacements( 0, [
			{
				...folderPlacement( 12, 'A post', 'dashicons-admin-post' ),
				file: {
					type: 'post',
					ref: '12',
					title: 'A post',
					icon: 'dashicons-admin-post',
					previewUrl: '',
					exists: true,
				},
			},
		] );

		expect( folderRef.folderFileById( 12, 'Real folder' ).title() ).toBe(
			'Real folder',
		);
	} );

	test( 'the fallback icon matches the folder type', async () => {
		const { folderRef, types } = await load();

		expect( folderRef.folderFileById( 5 ).icon() ).toBe(
			types.FOLDER_FILE_ICON,
		);
	} );
} );

describe( 'conflict toast — "View folder" dispatches through the opener', () => {
	beforeEach( async () => {
		installHooksStub();
		await resetStore();
	} );

	afterEach( async () => {
		await resetStore();
		clearHooksStub();
		document.body.replaceChildren();
	} );

	/** Build a 409 the REST client would have thrown. */
	function conflictError(
		rest: RestModule,
		parentId: number,
		parentName = 'Somewhere else',
	) {
		return new rest.FilesConflictError( {
			actor: { id: 2, name: 'Ada' },
			reason: 'moved',
			current: {
				parentId,
				parentName,
			},
		} as never );
	}

	/**
	 * Capture the toast's action button instead of rendering it —
	 * `<os-toast>` lives in the lazily loaded overlays bundle, and the
	 * action's behavior is what these tests are about.
	 */
	function captureAction( toast: ToastModule ) {
		const captured: { label: string; onClick: () => void }[] = [];
		const spy = vi
			.spyOn( toast, 'showToast' )
			.mockImplementation( ( opts ) => {
				if ( opts.action ) {
					captured.push( opts.action );
				}
				return () => undefined;
			} );
		return { captured, spy };
	}

	test( 'opens the folder window through the registered folder opener', async () => {
		const { conflict, openers, open, rest, toast, store } = await load();
		store.setFolderPlacements( 0, [
			folderPlacement( 12, 'Q3 Campaign', 'dashicons-megaphone' ),
		] );

		const opened = vi.fn();
		openers.registerOpener( {
			id: 'test-folder-window',
			label: 'Open folder',
			types: [ 'folder' ],
			isDefault: true,
			sort: 1,
			handler: { kind: 'js', open: opened },
		} );
		open.installOpenDeps( {
			openUrl: () => true,
			openNativeWindow: () => true,
			deriveWindowId: ( url: string ) => url,
		} );

		const { captured } = captureAction( toast );
		conflict.showConflictToast( conflictError( rest, 12 ) );

		expect( captured ).toHaveLength( 1 );
		expect( captured[ 0 ].label ).toBe( 'View folder' );

		captured[ 0 ].onClick();
		await vi.waitFor( () => expect( opened ).toHaveBeenCalled() );

		// The opener received a real folder DesktopFile — which is what
		// lets it build the same window a tile double-click builds,
		// rather than the toast reconstructing one.
		const file = opened.mock.calls[ 0 ][ 0 ];
		expect( file.type() ).toBe( 'folder' );
		expect( file.ref() ).toBe( '12' );
		expect( file.title() ).toBe( 'Q3 Campaign' );
	} );

	test( 'offers no action for the desktop root', async () => {
		const { conflict, rest, toast } = await load();

		const { captured, spy } = captureAction( toast );
		conflict.showConflictToast( conflictError( rest, 0 ) );

		// Folder 0 is the desktop itself — already on screen.
		expect( captured ).toHaveLength( 0 );
		expect( spy ).toHaveBeenCalled();
	} );

	test( 'offers the action even when no folder window is open yet', async () => {
		const { conflict, rest, toast } = await load();

		const { captured } = captureAction( toast );
		conflict.showConflictToast( conflictError( rest, 12, 'Archive' ) );

		// The regression this replaces: the button was only offered
		// when that folder's window already happened to be open, so in
		// the common case the toast had no way to act on itself.
		expect( captured ).toHaveLength( 1 );
	} );
} );
