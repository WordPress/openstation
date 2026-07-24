/**
 * Tests for the upload dialog: destination defaults by drop intent
 * (media-kind files on the desk default to Media Library) and the
 * single-dialog merge behavior (a second drop folds into the open
 * dialog instead of stacking a new modal).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

async function load() {
	vi.resetModules();
	return await import( '../../src/os-file-drop/dialog' );
}

const entry = ( name: string, mime: string ) => ( {
	file: new File( [ 'x' ], name, { type: mime } ),
	mime,
	fields: {
		title: name,
		altText: '',
		caption: '',
		description: '',
		filename: name,
	},
} );

const baseDialogArgs = () => ( {
	context: { surface: 'wallpaper' as const, x: 0, y: 0 },
	mediaUrl: 'https://example.test/wp-json/wp/v2/media',
	restNonce: 'n',
	filesUrl: 'https://example.test/wp-json/desktop-mode/v1/files',
	storage: { canUpload: true, maxBytes: 0, quotaBytes: 0, zipAvailable: true },
} );

describe( 'resolveDefaultDestination', () => {
	test( 'all-media flat drop on the desk defaults to Media Library', async () => {
		const { resolveDefaultDestination } = await load();
		expect(
			resolveDefaultDestination( {
				desktopAllowed: true,
				surface: 'wallpaper',
				mimes: [ 'image/jpeg', 'image/png', 'video/mp4' ],
			} ),
		).toBe( 'media' );
	} );

	test( 'a single non-media file flips the desk default to Desktop', async () => {
		const { resolveDefaultDestination } = await load();
		expect(
			resolveDefaultDestination( {
				desktopAllowed: true,
				surface: 'wallpaper',
				mimes: [ 'image/jpeg', 'application/pdf' ],
			} ),
		).toBe( 'desktop' );
	} );

	test( 'folder-targeted drops stay Desktop even for media files', async () => {
		const { resolveDefaultDestination } = await load();
		expect(
			resolveDefaultDestination( {
				desktopAllowed: true,
				surface: 'folder',
				folderId: 5,
				mimes: [ 'image/jpeg' ],
			} ),
		).toBe( 'desktop' );
	} );

	test( 'WordPress windows default to Media Library regardless of type', async () => {
		const { resolveDefaultDestination } = await load();
		expect(
			resolveDefaultDestination( {
				desktopAllowed: true,
				surface: 'window',
				mimes: [ 'application/zip' ],
			} ),
		).toBe( 'media' );
	} );

	test( 'forceDesktop and preferDesktop win over media kinds', async () => {
		const { resolveDefaultDestination } = await load();
		expect(
			resolveDefaultDestination( {
				desktopAllowed: true,
				surface: 'wallpaper',
				forceDesktop: true,
				mimes: [ 'image/jpeg' ],
			} ),
		).toBe( 'desktop' );
		expect(
			resolveDefaultDestination( {
				desktopAllowed: true,
				surface: 'folder',
				folderId: 0,
				preferDesktop: true,
				mimes: [ 'image/jpeg' ],
			} ),
		).toBe( 'desktop' );
	} );

	test( 'desktop storage unavailable always means Media Library', async () => {
		const { resolveDefaultDestination } = await load();
		expect(
			resolveDefaultDestination( {
				desktopAllowed: false,
				surface: 'wallpaper',
				mimes: [ 'application/zip' ],
			} ),
		).toBe( 'media' );
	} );
} );

describe( 'single-dialog replace', () => {
	beforeEach( () => {
		installHooksStub();
		document.body.innerHTML = '';
	} );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'a second drop replaces the open dialog batch instead of stacking', async () => {
		const mod = await load();
		// Non-media file so the desk default is Desktop.
		void mod.openUploadDialog( {
			...baseDialogArgs(),
			entries: [ entry( 'a.txt', 'text/plain' ) ],
		} );
		expect( document.querySelectorAll( 'wpd-modal' ).length ).toBe( 1 );
		expect( document.querySelector( 'wpd-modal' )?.getAttribute( 'title' ) ).toBe(
			'Upload to Desktop',
		);

		// Second drop while the dialog is open: latest wins, first
		// batch discarded.
		void mod.openUploadDialog( {
			...baseDialogArgs(),
			entries: [ entry( 'b.txt', 'text/plain' ), entry( 'c.txt', 'text/plain' ) ],
		} );
		const modals = document.querySelectorAll( 'wpd-modal' );
		expect( modals.length ).toBe( 1 );
		expect( modals[ 0 ].getAttribute( 'title' ) ).toBe( 'Upload 2 files to Desktop' );
		expect( modals[ 0 ].textContent ).not.toContain( 'a.txt' );
		expect( modals[ 0 ].textContent ).toContain( 'b.txt' );
		expect( modals[ 0 ].textContent ).toContain( 'c.txt' );
	} );

	test( 'the replacement recomputes the destination for the new drop', async () => {
		const mod = await load();
		void mod.openUploadDialog( {
			...baseDialogArgs(),
			entries: [ entry( 'notes.txt', 'text/plain' ) ], // Desktop default.
		} );
		expect( document.querySelector( 'wpd-modal' )?.getAttribute( 'title' ) ).toBe(
			'Upload to Desktop',
		);

		// All-media second drop: the dialog flips to the Media default.
		void mod.openUploadDialog( {
			...baseDialogArgs(),
			entries: [ entry( 'photo.jpg', 'image/jpeg' ) ],
		} );
		const modals = document.querySelectorAll( 'wpd-modal' );
		expect( modals.length ).toBe( 1 );
		expect( modals[ 0 ].getAttribute( 'title' ) ).toBe( 'Upload to Media Library' );
		expect( modals[ 0 ].textContent ).not.toContain( 'notes.txt' );
	} );

	test( 'a tree drop replacing a flat batch forces Desktop', async () => {
		const mod = await load();
		void mod.openUploadDialog( {
			...baseDialogArgs(),
			entries: [ entry( 'photo.jpg', 'image/jpeg' ) ],
		} );
		expect( document.querySelector( 'wpd-modal' )?.getAttribute( 'title' ) ).toBe(
			'Upload to Media Library',
		);

		void mod.openUploadDialog( {
			...baseDialogArgs(),
			entries: [
				{ ...entry( 'doc.txt', 'text/plain' ), relativePath: 'docs/doc.txt' },
			],
			forceDesktop: true,
			emptyDirs: [ 'docs/empty' ],
		} );
		const modals = document.querySelectorAll( 'wpd-modal' );
		expect( modals.length ).toBe( 1 );
		expect( modals[ 0 ].getAttribute( 'title' ) ).toBe( 'Upload to Desktop' );
		expect( modals[ 0 ].textContent ).not.toContain( 'photo.jpg' );
	} );

	test( 'shows the per-file size cap for the active destination', async () => {
		const mod = await load();
		void mod.openUploadDialog( {
			...baseDialogArgs(),
			storage: {
				canUpload: true,
				maxBytes: 8 * 1024 * 1024,
				quotaBytes: 0,
				zipAvailable: true,
			},
			mediaMaxBytes: 2 * 1024 * 1024,
			entries: [ entry( 'a.txt', 'text/plain' ) ], // Desktop default.
		} );
		const capLine = (): string =>
			document.querySelector( '.desktop-mode-upload-dialog__max-size' )
				?.textContent ?? '';
		expect( capLine() ).toBe( 'Maximum file size: 8.0 MB' );

		// Switching destination re-renders with the media cap.
		const segmented = document.querySelector( 'wpd-segmented' )!;
		segmented.dispatchEvent(
			new CustomEvent( 'wpd-pick', { detail: { value: 'media' } } ),
		);
		expect( capLine() ).toBe( 'Maximum file size: 2.0 MB' );
	} );

	test( 'hides the size cap when no client cap is configured', async () => {
		const mod = await load();
		void mod.openUploadDialog( {
			...baseDialogArgs(),
			entries: [ entry( 'a.txt', 'text/plain' ) ],
		} );
		expect(
			document.querySelector( '.desktop-mode-upload-dialog__max-size' ),
		).toBeNull();
	} );

	test( 'closing the dialog allows a fresh one to open', async () => {
		const mod = await load();
		void mod.openUploadDialog( {
			...baseDialogArgs(),
			entries: [ entry( 'a.txt', 'text/plain' ) ],
		} );
		const first = document.querySelector( 'wpd-modal' )!;
		first.dispatchEvent( new CustomEvent( 'wpd-modal-cancel' ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( document.querySelectorAll( 'wpd-modal' ).length ).toBe( 0 );

		void mod.openUploadDialog( {
			...baseDialogArgs(),
			entries: [ entry( 'd.txt', 'text/plain' ) ],
		} );
		expect( document.querySelectorAll( 'wpd-modal' ).length ).toBe( 1 );
	} );
} );
