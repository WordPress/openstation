/**
 * Tests for the Media Library entries on upload tiles: "Add to
 * Media Library" on any media-capable stored file, "Start a post /
 * page with this image" on images, each gated by the server's
 * `desktopStorage` capability flags; and the click paths that call
 * the REST client and open the resulting edit screen.
 */
import { RestError } from '../../src/core/api-client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

interface StorageFlags {
	canAddToMedia?: boolean;
	canStartPost?: boolean;
	canStartPage?: boolean;
}

interface ConfigShape {
	currentUserId?: number;
	desktopStorage?: StorageFlags;
}

function setConfig( cfg: ConfigShape ): void {
	( window as unknown as { openStationConfig?: ConfigShape } ).openStationConfig = cfg;
}

const allFlags: StorageFlags = {
	canAddToMedia: true,
	canStartPost: true,
	canStartPage: true,
};

const imagePlacement = ( overrides: Record< string, unknown > = {} ) => ( {
	id: 11,
	parentId: 0,
	x: 0,
	y: 0,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file: {
		type: 'upload',
		ref: '77',
		title: 'photo.jpg',
		icon: 'dashicons-format-image',
		previewUrl: '',
		exists: true,
		ownerId: 5,
		sizeBytes: 8,
		mime: 'image/jpeg',
		kind: 'image',
		isMedia: true,
		...( ( overrides.file as Record< string, unknown > ) ?? {} ),
	},
	...Object.fromEntries( Object.entries( overrides ).filter( ( [ k ] ) => k !== 'file' ) ),
} );

const pdfPlacement = () =>
	imagePlacement( {
		file: { title: 'report.pdf', mime: 'application/pdf', kind: 'pdf', isMedia: true },
	} );

const exePlacement = () =>
	imagePlacement( {
		file: { title: 'setup.exe', mime: 'application/octet-stream', kind: 'file', isMedia: false },
	} );

interface MenuEntry {
	id: string;
	label: string;
	multi?: boolean;
	onClick: () => unknown;
	bulk?: ( items: unknown[] ) => unknown;
}

const restMock = {
	addUploadToMediaLibrary: vi.fn(),
	startPostFromUpload: vi.fn(),
};
const openUrlWindow = vi.fn( () => true );
const showToast = vi.fn();

vi.mock( '../../src/desktop-files/rest', () => restMock );
vi.mock( '../../src/desktop-files/open', () => ( { openUrlWindow } ) );
vi.mock( '../../src/toast', () => ( { showToast } ) );

async function loadAndInstall() {
	vi.resetModules();
	const hooks = await import( '../../src/hooks' );
	const mod = await import( '../../src/desktop-files/media-menu-items' );
	mod.installMediaMenuItems();
	return {
		applyMenu: ( placement: unknown ) =>
			hooks.applyFilters( 'os.files.tile-menu', [], placement ) as MenuEntry[],
	};
}

describe( 'media menu items', () => {
	beforeEach( () => {
		installHooksStub();
		restMock.addUploadToMediaLibrary.mockReset();
		restMock.startPostFromUpload.mockReset();
		openUrlWindow.mockClear();
		showToast.mockClear();
	} );
	afterEach( () => {
		clearHooksStub();
		setConfig( {} );
	} );

	test( 'image tile gets Add, Start a post, and Start a page', async () => {
		setConfig( { currentUserId: 5, desktopStorage: allFlags } );
		const { applyMenu } = await loadAndInstall();
		const ids = applyMenu( imagePlacement() ).map( ( i ) => i.id );
		expect( ids ).toEqual( [
			'desktop-mode/upload-add-to-media',
			'desktop-mode/upload-start-post',
			'desktop-mode/upload-start-page',
		] );
	} );

	test( 'non-image media gets Add only', async () => {
		setConfig( { currentUserId: 5, desktopStorage: allFlags } );
		const { applyMenu } = await loadAndInstall();
		const ids = applyMenu( pdfPlacement() ).map( ( i ) => i.id );
		expect( ids ).toEqual( [ 'desktop-mode/upload-add-to-media' ] );
	} );

	test( 'a file the Media Library would reject gets nothing', async () => {
		setConfig( { currentUserId: 5, desktopStorage: allFlags } );
		const { applyMenu } = await loadAndInstall();
		expect( applyMenu( exePlacement() ) ).toEqual( [] );
	} );

	test( 'the isMedia flag is the gate, not the kind', async () => {
		setConfig( { currentUserId: 5, desktopStorage: allFlags } );
		const { applyMenu } = await loadAndInstall();
		// An image the server filtered out of the media policy.
		expect( applyMenu( imagePlacement( { file: { isMedia: false } } ) ) ).toEqual( [] );
		// A legacy payload without the flag is treated as not media.
		const legacy = imagePlacement();
		delete ( legacy.file as { isMedia?: boolean } ).isMedia;
		expect( applyMenu( legacy ) ).toEqual( [] );
	} );

	test( 'capability flags gate each entry', async () => {
		setConfig( {
			currentUserId: 5,
			desktopStorage: { canAddToMedia: true, canStartPost: false, canStartPage: true },
		} );
		let { applyMenu } = await loadAndInstall();
		expect( applyMenu( imagePlacement() ).map( ( i ) => i.id ) ).toEqual( [
			'desktop-mode/upload-add-to-media',
			'desktop-mode/upload-start-page',
		] );

		// Without upload_files nothing is offered — the post entries
		// need the attachment too.
		setConfig( {
			currentUserId: 5,
			desktopStorage: { canAddToMedia: false, canStartPost: true, canStartPage: true },
		} );
		( { applyMenu } = await loadAndInstall() );
		expect( applyMenu( imagePlacement() ) ).toEqual( [] );
	} );

	test( 'non-upload tiles are untouched', async () => {
		setConfig( { currentUserId: 5, desktopStorage: allFlags } );
		const { applyMenu } = await loadAndInstall();
		expect( applyMenu( imagePlacement( { file: { type: 'attachment' } } ) ) ).toEqual( [] );
	} );

	test( 'Add calls the media route and toasts with an Open action', async () => {
		setConfig( { currentUserId: 5, desktopStorage: allFlags } );
		restMock.addUploadToMediaLibrary.mockResolvedValue( {
			attachmentId: 42,
			created: true,
			title: 'photo',
			url: 'https://example.test/photo.jpg',
			editUrl: 'https://example.test/wp-admin/post.php?post=42&action=edit',
		} );
		const { applyMenu } = await loadAndInstall();
		const add = applyMenu( imagePlacement() ).find(
			( i ) => i.id === 'desktop-mode/upload-add-to-media',
		) as MenuEntry;
		expect( add.multi ).toBe( true );
		await add.onClick();
		expect( restMock.addUploadToMediaLibrary ).toHaveBeenCalledWith( 77 );
		const toast = showToast.mock.calls[ 0 ][ 0 ] as {
			message: string;
			action: { onClick: () => void };
		};
		expect( toast.message ).toBe( 'Added to the Media Library.' );
		toast.action.onClick();
		expect( openUrlWindow ).toHaveBeenCalledWith(
			expect.objectContaining( {
				url: 'https://example.test/wp-admin/post.php?post=42&action=edit',
				title: 'photo',
			} ),
		);
	} );

	test( 'Add on an already-copied file says so', async () => {
		setConfig( { currentUserId: 5, desktopStorage: allFlags } );
		restMock.addUploadToMediaLibrary.mockResolvedValue( {
			attachmentId: 42,
			created: false,
			title: 'photo',
			url: '',
			editUrl: '',
		} );
		const { applyMenu } = await loadAndInstall();
		const add = applyMenu( imagePlacement() ).find(
			( i ) => i.id === 'desktop-mode/upload-add-to-media',
		) as MenuEntry;
		await add.onClick();
		expect( ( showToast.mock.calls[ 0 ][ 0 ] as { message: string } ).message ).toBe(
			'Already in the Media Library.',
		);
	} );

	test( 'a failed Add surfaces the server message', async () => {
		setConfig( { currentUserId: 5, desktopStorage: allFlags } );
		restMock.addUploadToMediaLibrary.mockRejectedValue(
			new RestError( '', { status: 415, code: 'openstation_stored_file_not_media', serverMessage: 'This file type cannot be added to the Media Library.' } ),
		);
		const { applyMenu } = await loadAndInstall();
		const add = applyMenu( imagePlacement() ).find(
			( i ) => i.id === 'desktop-mode/upload-add-to-media',
		) as MenuEntry;
		await add.onClick();
		expect( ( showToast.mock.calls[ 0 ][ 0 ] as { message: string } ).message ).toBe(
			'Could not add to the Media Library: This file type cannot be added to the Media Library.',
		);
	} );

	test( 'bulk Add runs one call per file and one toast', async () => {
		setConfig( { currentUserId: 5, desktopStorage: allFlags } );
		restMock.addUploadToMediaLibrary
			.mockResolvedValueOnce( { attachmentId: 1, created: true, title: '', url: '', editUrl: '' } )
			.mockResolvedValueOnce( { attachmentId: 2, created: false, title: '', url: '', editUrl: '' } )
			.mockRejectedValueOnce( new Error( 'nope' ) );
		const { applyMenu } = await loadAndInstall();
		const add = applyMenu( imagePlacement() ).find(
			( i ) => i.id === 'desktop-mode/upload-add-to-media',
		) as MenuEntry;
		await add.bulk?.( [
			imagePlacement( { file: { ref: '1' } } ),
			imagePlacement( { file: { ref: '2' } } ),
			pdfPlacement(),
			exePlacement(), // not media — skipped, no call
		] );
		expect( restMock.addUploadToMediaLibrary ).toHaveBeenCalledTimes( 3 );
		expect( showToast ).toHaveBeenCalledTimes( 1 );
		expect( ( showToast.mock.calls[ 0 ][ 0 ] as { message: string } ).message ).toBe(
			'Added 1 file to the Media Library. 1 already there. 1 could not be added.',
		);
	} );

	test( 'Start a page posts the type and opens the edit URL in a window', async () => {
		setConfig( { currentUserId: 5, desktopStorage: allFlags } );
		restMock.startPostFromUpload.mockResolvedValue( {
			postId: 9,
			postType: 'page',
			editUrl: 'https://example.test/wp-admin/post.php?post=9&action=edit',
			attachment: { attachmentId: 42, created: true, title: '', url: '', editUrl: '' },
		} );
		const { applyMenu } = await loadAndInstall();
		const start = applyMenu( imagePlacement() ).find(
			( i ) => i.id === 'desktop-mode/upload-start-page',
		) as MenuEntry;
		expect( start.multi ).toBeUndefined();
		await start.onClick();
		expect( restMock.startPostFromUpload ).toHaveBeenCalledWith( 77, 'page' );
		expect( openUrlWindow ).toHaveBeenCalledWith( {
			url: 'https://example.test/wp-admin/post.php?post=9&action=edit',
			title: 'Add New Page',
			icon: 'dashicons-admin-page',
		} );
		expect( showToast ).not.toHaveBeenCalled();
	} );

	test( 'a failed Start toasts and opens nothing', async () => {
		setConfig( { currentUserId: 5, desktopStorage: allFlags } );
		restMock.startPostFromUpload.mockRejectedValue(
			new RestError( '', { status: 403, code: 'openstation_stored_file_cannot_create_posts', serverMessage: 'You are not allowed to create this kind of content.' } ),
		);
		const { applyMenu } = await loadAndInstall();
		const start = applyMenu( imagePlacement() ).find(
			( i ) => i.id === 'desktop-mode/upload-start-post',
		) as MenuEntry;
		await start.onClick();
		expect( openUrlWindow ).not.toHaveBeenCalled();
		expect( ( showToast.mock.calls[ 0 ][ 0 ] as { message: string } ).message ).toBe(
			'Could not start a post: You are not allowed to create this kind of content.',
		);
	} );
} );
