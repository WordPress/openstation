/**
 * Regression test: a folder-tree upload must repaint the desktop
 * immediately. The server creates the folder rows + placements
 * (mkdir-p from relativePath), but each per-file response only
 * carries that file's own placement — so after the batch the
 * dialog re-pulls the canonical container list into the store
 * instead of leaving the new folder tile invisible until the next
 * heartbeat tick.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const listFolders = vi.fn();
const listPlacements = vi.fn();
const ensureUploadPath = vi.fn();

vi.mock( '../../src/desktop-files/rest', () => ( {
	listFolders: ( ...a: unknown[] ) => listFolders( ...a ),
	listPlacements: ( ...a: unknown[] ) => listPlacements( ...a ),
	ensureUploadPath: ( ...a: unknown[] ) => ensureUploadPath( ...a ),
} ) );

class FakeXhr {
	static last: FakeXhr | null = null;
	/** parentId the canned response places the upload in. */
	static nextParentId = 0;
	status = 200;
	responseText = '';
	responseType = '';
	withCredentials = false;
	upload = {
		addEventListener() {
			/* progress unused here */
		},
	};
	private listeners = new Map< string, () => void >();
	constructor() {
		FakeXhr.last = this;
	}
	open() {}
	setRequestHeader() {}
	addEventListener( name: string, cb: () => void ) {
		this.listeners.set( name, cb );
	}
	send() {
		// Auto-respond on the next tick with a created placement.
		setTimeout( () => {
			this.status = 201;
			this.responseText = JSON.stringify( {
				placement: {
					id: 500,
					parentId: FakeXhr.nextParentId,
					x: 16,
					y: 16,
					sortOrder: 0,
					updatedAtMs: 1,
					meta: null,
					file: {
						type: 'upload',
						ref: '77',
						title: 'doc.txt',
						icon: 'dashicons-media-text',
						previewUrl: '',
						exists: true,
					},
				},
				storedFileId: 77,
			} );
			this.listeners.get( 'load' )?.();
		}, 0 );
	}
	abort() {}
}

describe( 'tree upload desktop refresh', () => {
	const realXhr = globalThis.XMLHttpRequest;
	beforeEach( () => {
		installHooksStub();
		( globalThis as { XMLHttpRequest: unknown } ).XMLHttpRequest = FakeXhr;
		document.body.innerHTML = '';
		listFolders.mockReset();
		listPlacements.mockReset();
		ensureUploadPath.mockReset();
	} );
	afterEach( () => {
		( globalThis as { XMLHttpRequest: unknown } ).XMLHttpRequest = realXhr;
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'after a tree batch the container is re-pulled into the store', async () => {
		vi.resetModules();
		const store = await import( '../../src/desktop-files/store' );
		store.__resetFilesStoreForTests();
		const dialog = await import( '../../src/os-file-drop/dialog' );

		const folderRow = { id: 3, name: 'docs', ownerId: 1, shareMode: 'private', updatedAtMs: 2 };
		const folderPlacement = {
			id: 900,
			parentId: 0,
			x: 16,
			y: 16,
			sortOrder: 0,
			updatedAtMs: 2,
			meta: null,
			file: {
				type: 'folder',
				ref: '3',
				title: 'docs',
				icon: 'dashicons-portfolio',
				previewUrl: '',
				exists: true,
			},
		};
		listFolders.mockResolvedValue( { folders: [ folderRow ] } );
		listPlacements.mockResolvedValue( {
			placements: [ folderPlacement ],
			folderId: 0,
		} );
		FakeXhr.nextParentId = 3; // Leaf folder created server-side.

		void dialog.openUploadDialog( {
			entries: [
				{
					file: new File( [ 'x' ], 'doc.txt', { type: 'text/plain' } ),
					mime: 'text/plain',
					fields: {
						title: 'doc',
						altText: '',
						caption: '',
						description: '',
						filename: 'doc.txt',
					},
					relativePath: 'docs/doc.txt',
				},
			],
			context: { surface: 'wallpaper', x: 0, y: 0 },
			mediaUrl: 'https://x/media',
			restNonce: 'n',
			filesUrl: 'https://x/wp-json/desktop-mode/v1/files',
			storage: { canUpload: true, maxBytes: 0, quotaBytes: 0, zipAvailable: true },
			forceDesktop: true,
		} );

		// Click the primary Upload button.
		const buttons = Array.from(
			document.querySelectorAll< HTMLElement >( 'os-button[variant="primary"]' ),
		);
		expect( buttons.length ).toBe( 1 );
		buttons[ 0 ].click();

		await vi.waitFor( () => {
			expect( listPlacements ).toHaveBeenCalledWith( 0 );
			expect( listFolders ).toHaveBeenCalled();
			const roots = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
			expect( roots.some( ( p ) => p.id === 900 ) ).toBe( true );
		} );
	} );

	test( 'flat uploads skip the container re-pull', async () => {
		vi.resetModules();
		const store = await import( '../../src/desktop-files/store' );
		store.__resetFilesStoreForTests();
		const dialog = await import( '../../src/os-file-drop/dialog' );

		FakeXhr.nextParentId = 0; // Flat upload lands at the root.
		void dialog.openUploadDialog( {
			entries: [
				{
					file: new File( [ 'x' ], 'flat.txt', { type: 'text/plain' } ),
					mime: 'text/plain',
					fields: {
						title: 'flat',
						altText: '',
						caption: '',
						description: '',
						filename: 'flat.txt',
					},
				},
			],
			context: { surface: 'wallpaper', x: 0, y: 0 },
			mediaUrl: 'https://x/media',
			restNonce: 'n',
			filesUrl: 'https://x/wp-json/desktop-mode/v1/files',
			storage: { canUpload: true, maxBytes: 0, quotaBytes: 0, zipAvailable: true },
		} );

		const buttons = Array.from(
			document.querySelectorAll< HTMLElement >( 'os-button[variant="primary"]' ),
		);
		buttons[ 0 ].click();

		// Wait for the modal to close (batch finished)…
		await vi.waitFor( () => {
			expect( document.querySelector( 'os-modal' ) ).toBeNull();
		} );
		// …and confirm no canonical re-pull happened (the returned
		// placement was ingested directly instead).
		expect( listPlacements ).not.toHaveBeenCalled();
		expect( listFolders ).not.toHaveBeenCalled();
		const roots = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		expect( roots.some( ( p ) => p.file?.type === 'upload' ) ).toBe( true );
	} );
} );
