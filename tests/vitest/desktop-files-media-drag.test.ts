/**
 * Tests for an upload tile on the drag bridge and on post tiles:
 * the `upload` bridge payload (gated on media-ness and capability),
 * its drop-time resolution into an `attachment` payload through the
 * bridge's resolver registry, the iframe drop target waiting on that
 * resolution before posting `os-drop`, and the tile-payload handlers
 * that let media uploads land on post and page tiles.
 */
import { RestError } from '../../src/core/api-client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

interface ConfigShape {
	currentUserId?: number;
	desktopStorage?: { canAddToMedia?: boolean };
}

function setConfig( cfg: ConfigShape ): void {
	( window as unknown as { openStationConfig?: ConfigShape } ).openStationConfig = cfg;
}

const uploadFile = ( overrides: Record< string, unknown > = {} ) => ( {
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
	...overrides,
} );

const placement = ( file: Record< string, unknown >, overrides: Record< string, unknown > = {} ) => ( {
	id: 11,
	parentId: 0,
	x: 0,
	y: 0,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file,
	...overrides,
} );

const postFile = ( overrides: Record< string, unknown > = {} ) => ( {
	type: 'post',
	ref: '9',
	title: 'Hello world',
	icon: 'dashicons-admin-post',
	previewUrl: '',
	exists: true,
	postType: 'post',
	status: 'publish',
	link: 'https://example.test/hello-world/',
	...overrides,
} );

const restMock = {
	addUploadToMediaLibrary: vi.fn(),
	attachUploadsToPost: vi.fn(),
	listPlacements: vi.fn( async () => ( { placements: [], folderId: 0 } ) ),
};
const storeMock = { setFolderPlacements: vi.fn() };
const openUrlWindow = vi.fn( () => true );
const showToast = vi.fn();

vi.mock( '../../src/desktop-files/rest', () => restMock );
vi.mock( '../../src/desktop-files/store', () => storeMock );
vi.mock( '../../src/desktop-files/open', () => ( { openUrlWindow } ) );
vi.mock( '../../src/toast', () => ( { showToast } ) );

beforeEach( () => {
	vi.resetModules();
	restMock.addUploadToMediaLibrary.mockReset();
	restMock.attachUploadsToPost.mockReset();
	restMock.listPlacements.mockClear();
	storeMock.setFolderPlacements.mockClear();
	openUrlWindow.mockClear();
	showToast.mockClear();
	setConfig( { currentUserId: 5, desktopStorage: { canAddToMedia: true } } );
} );

afterEach( () => {
	setConfig( {} );
} );

describe( 'upload bridge payload', () => {
	test( 'a media upload lifts as an upload payload', async () => {
		const { uploadBridgePayload } = await import( '../../src/desktop-files/media-drag' );
		expect( uploadBridgePayload( uploadFile( { previewUrl: 'https://example.test/t.jpg' } ) ) ).toEqual( {
			kind: 'upload',
			fileId: 77,
			title: 'photo.jpg',
			mime: 'image/jpeg',
			thumbnailUrl: 'https://example.test/t.jpg',
		} );
	} );

	test( 'non-media, non-upload, and no-capability cases lift nothing', async () => {
		const { uploadBridgePayload } = await import( '../../src/desktop-files/media-drag' );
		expect( uploadBridgePayload( uploadFile( { isMedia: false } ) ) ).toBeUndefined();
		expect( uploadBridgePayload( uploadFile( { type: 'attachment' } ) ) ).toBeUndefined();
		expect( uploadBridgePayload( uploadFile( { ref: 'nope' } ) ) ).toBeUndefined();
		setConfig( { currentUserId: 5, desktopStorage: { canAddToMedia: false } } );
		expect( uploadBridgePayload( uploadFile() ) ).toBeUndefined();
	} );

	test( 'the layer hands upload tiles to the media module', async () => {
		// Pin the seam: `buildBridgePayloadFromPlacement` in layer.ts
		// routes `upload` through `uploadBridgePayload`. The layer is
		// not importable in isolation here, so assert on the resolver
		// registry that boot installs instead.
		const bridge = await import( '../../src/drag-bridge' );
		const media = await import( '../../src/desktop-files/media-drag' );
		const off = media.installMediaDrag();
		expect( bridge.bridgePayloadNeedsResolution( { kind: 'upload', fileId: 1, title: '', mime: '' } ) ).toBe( true );
		expect( bridge.bridgePayloadNeedsResolution( { kind: 'attachment', id: 1, url: '', title: '', alt: '', mime: '' } ) ).toBe( false );
		off();
		expect( bridge.bridgePayloadNeedsResolution( { kind: 'upload', fileId: 1, title: '', mime: '' } ) ).toBe( false );
	} );
} );

describe( 'upload payload resolution', () => {
	test( 'resolves through the Media Library into an attachment payload', async () => {
		restMock.addUploadToMediaLibrary.mockResolvedValue( {
			attachmentId: 42,
			created: true,
			title: 'photo',
			url: 'https://example.test/photo.jpg',
			editUrl: 'https://example.test/wp-admin/post.php?post=42&action=edit',
		} );
		const bridge = await import( '../../src/drag-bridge' );
		const media = await import( '../../src/desktop-files/media-drag' );
		media.installMediaDrag();
		const resolved = await bridge.resolveBridgePayload( {
			kind: 'upload',
			fileId: 77,
			title: 'photo.jpg',
			mime: 'image/jpeg',
			thumbnailUrl: 'https://example.test/t.jpg',
		} );
		expect( restMock.addUploadToMediaLibrary ).toHaveBeenCalledWith( 77 );
		expect( resolved ).toEqual( {
			kind: 'attachment',
			id: 42,
			url: 'https://example.test/photo.jpg',
			title: 'photo',
			alt: '',
			mime: 'image/jpeg',
			thumbnailUrl: 'https://example.test/t.jpg',
		} );
	} );

	test( 'a failed copy resolves to null and toasts', async () => {
		restMock.addUploadToMediaLibrary.mockRejectedValue(
			new RestError( '', { status: 415, code: 'openstation_stored_file_not_media', serverMessage: 'This file type cannot be added to the Media Library.' } ),
		);
		const bridge = await import( '../../src/drag-bridge' );
		const media = await import( '../../src/desktop-files/media-drag' );
		media.installMediaDrag();
		const resolved = await bridge.resolveBridgePayload( {
			kind: 'upload', fileId: 77, title: 'photo.jpg', mime: 'image/jpeg',
		} );
		expect( resolved ).toBeNull();
		expect( ( showToast.mock.calls[ 0 ][ 0 ] as { message: string } ).message ).toBe(
			'Could not add to the Media Library: This file type cannot be added to the Media Library.',
		);
	} );

	test( 'payloads with no resolver pass through unchanged', async () => {
		const bridge = await import( '../../src/drag-bridge' );
		const payload = { kind: 'post' as const, id: 3, postType: 'post', url: 'https://example.test/p/', title: 'P' };
		expect( await bridge.resolveBridgePayload( payload ) ).toBe( payload );
	} );
} );

describe( 'iframe drop target with a resolvable payload', () => {
	function stubWpHooks(): void {
		( window as { wp?: unknown } ).wp = {
			hooks: {
				addAction: vi.fn(),
				removeAction: vi.fn(),
				doAction: vi.fn(),
				addFilter: vi.fn(),
				removeFilter: vi.fn(),
				applyFilters: ( _name: string, value: unknown ) => value,
			},
		};
	}

	afterEach( () => {
		document.body.innerHTML = '';
		delete ( window as { wp?: unknown } ).wp;
	} );

	async function mountAndDrag( bridgePayload: unknown ) {
		stubWpHooks();
		const targets: Array< { onDrop: ( s: unknown, ev: { clientX: number; clientY: number } ) => void } > = [];
		const dragManager = {
			start: vi.fn(),
			registerDropTarget: vi.fn( ( t: { onDrop: ( s: unknown, ev: { clientX: number; clientY: number } ) => void } ) => {
				targets.push( t );
				return () => undefined;
			} ),
			getSession: vi.fn( () => null ),
		};
		const mod = await import( '../../src/drag/iframe-drop-targets' );
		const { DRAG_EVENTS } = await import( '../../src/drag' );
		mod.__resetIframeDropTargetsForTests();
		mod.installIframeDropTargets( dragManager as never );

		const win = document.createElement( 'div' );
		win.className = 'os-window';
		win.id = 'wp-window-post-php';
		const iframe = document.createElement( 'iframe' );
		iframe.className = 'os-window__iframe';
		win.appendChild( iframe );
		document.body.appendChild( win );
		const posted: unknown[] = [];
		vi.spyOn( iframe.contentWindow as Window, 'postMessage' ).mockImplementation( ( msg: unknown ) => {
			posted.push( msg );
		} );

		const payload = { type: 'desktop-file', source: win, data: { bridgePayload } };
		document.dispatchEvent( new CustomEvent( DRAG_EVENTS.START, { detail: { payload } } ) );
		expect( targets ).toHaveLength( 1 );
		targets[ 0 ].onDrop( { payload }, { clientX: 10, clientY: 10 } );
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		mod.__resetIframeDropTargetsForTests();
		return posted as Array< { type: string; payload?: { kind: string; id?: number } } >;
	}

	test( 'an upload payload is resolved to an attachment before os-drop', async () => {
		restMock.addUploadToMediaLibrary.mockResolvedValue( {
			attachmentId: 42, created: true, title: 'photo', url: 'https://example.test/photo.jpg', editUrl: '',
		} );
		const media = await import( '../../src/desktop-files/media-drag' );
		media.installMediaDrag();
		const posted = await mountAndDrag( { kind: 'upload', fileId: 77, title: 'photo.jpg', mime: 'image/jpeg' } );
		const drop = posted.find( ( m ) => m.type === 'os-drop' );
		expect( drop?.payload ).toMatchObject( { kind: 'attachment', id: 42, url: 'https://example.test/photo.jpg' } );
	} );

	test( 'a failed resolution sends os-drag-leave instead of os-drop', async () => {
		restMock.addUploadToMediaLibrary.mockRejectedValue( new Error( 'nope' ) );
		const media = await import( '../../src/desktop-files/media-drag' );
		media.installMediaDrag();
		const posted = await mountAndDrag( { kind: 'upload', fileId: 77, title: 'photo.jpg', mime: 'image/jpeg' } );
		expect( posted.some( ( m ) => m.type === 'os-drop' ) ).toBe( false );
		expect( posted.some( ( m ) => m.type === 'os-drag-leave' ) ).toBe( true );
	} );

	test( 'an attachment payload is posted synchronously, as before', async () => {
		const attachment = { kind: 'attachment', id: 5, url: 'https://example.test/a.png', title: 'A', alt: '', mime: 'image/png' };
		const posted = await mountAndDrag( attachment );
		expect( posted.find( ( m ) => m.type === 'os-drop' )?.payload ).toEqual( attachment );
		expect( restMock.addUploadToMediaLibrary ).not.toHaveBeenCalled();
	} );
} );

describe( 'media uploads dropped on post tiles', () => {
	const session = ( placements: unknown[] ) => ( {
		payload: {
			type: 'desktop-file',
			source: document.createElement( 'div' ),
			data: {
				placement: placements[ 0 ],
				...( placements.length > 1 ? { placements } : {} ),
				sourceFolderId: 0,
			},
		},
	} );

	async function load() {
		const tp = await import( '../../src/desktop-files/tile-payloads' );
		tp.__resetTilePayloadHandlersForTests();
		const mod = await import( '../../src/desktop-files/media-drop-targets' );
		mod.installMediaDropTargets();
		return tp;
	}

	test( 'a post tile accepts a media upload and labels the chip', async () => {
		const tp = await load();
		const ctx = { placement: placement( postFile() ) as never };
		expect( tp.tilePayloadAccepts( session( [ placement( uploadFile() ) ] ).payload, ctx ) ).toBe( true );
		expect( tp.tilePayloadAcceptLabel( 'desktop-file', ctx ) ).toBe( 'Add to post' );

		const page = { placement: placement( postFile( { postType: 'page' } ) ) as never };
		expect( tp.tilePayloadAccepts( session( [ placement( uploadFile() ) ] ).payload, page ) ).toBe( true );
		expect( tp.tilePayloadAcceptLabel( 'desktop-file', page ) ).toBe( 'Add to page' );
	} );

	test( 'the whole selection has to be media uploads', async () => {
		const tp = await load();
		const ctx = { placement: placement( postFile() ) as never };
		const mixed = session( [ placement( uploadFile() ), placement( uploadFile( { ref: '78', isMedia: false } ) ) ] );
		expect( tp.tilePayloadAccepts( mixed.payload, ctx ) ).toBe( false );
		const withPost = session( [ placement( uploadFile() ), placement( postFile( { ref: '3' } ) ) ] );
		expect( tp.tilePayloadAccepts( withPost.payload, ctx ) ).toBe( false );
		const twoImages = session( [ placement( uploadFile() ), placement( uploadFile( { ref: '78' } ) ) ] );
		expect( tp.tilePayloadAccepts( twoImages.payload, ctx ) ).toBe( true );
	} );

	test( 'other tiles, trashed posts, and viewers without the capability get nothing', async () => {
		const tp = await load();
		const upload = session( [ placement( uploadFile() ) ] ).payload;
		expect( tp.tilePayloadAccepts( upload, { placement: placement( uploadFile( { ref: '80' } ) ) as never } ) ).toBe( false );
		expect( tp.tilePayloadAccepts( upload, { placement: placement( postFile( { status: 'trash' } ) ) as never } ) ).toBe( false );
		expect( tp.tilePayloadAccepts( upload, { placement: placement( postFile( { exists: false } ) ) as never } ) ).toBe( false );
		setConfig( { currentUserId: 5, desktopStorage: { canAddToMedia: false } } );
		expect( tp.tilePayloadAccepts( upload, { placement: placement( postFile() ) as never } ) ).toBe( false );
	} );

	test( 'dropping calls the route with every file id, opens the post, toasts, and re-pulls the folder', async () => {
		restMock.attachUploadsToPost.mockResolvedValue( {
			postId: 9,
			title: 'Hello world',
			editUrl: 'https://example.test/wp-admin/post.php?post=9&action=edit',
			appended: true,
			featuredImageSet: true,
			attachments: [ { attachmentId: 1 }, { attachmentId: 2 } ],
		} );
		const tp = await load();
		const target = placement( postFile(), { parentId: 4 } );
		const s = session( [ placement( uploadFile() ), placement( uploadFile( { ref: '78' } ) ) ] );
		expect( tp.tilePayloadDrop( s as never, { clientX: 0, clientY: 0 }, { placement: target as never } ) ).toBe( true );
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect( restMock.attachUploadsToPost ).toHaveBeenCalledWith( 9, [ 77, 78 ] );
		// The post opens on its own — no "Edit" action to click.
		expect( openUrlWindow ).toHaveBeenCalledWith( {
			url: 'https://example.test/wp-admin/post.php?post=9&action=edit',
			title: 'Hello world',
			icon: 'dashicons-admin-post',
		} );
		const toast = showToast.mock.calls[ 0 ][ 0 ] as { message: string; action?: unknown };
		expect( toast.message ).toBe( 'Added 2 files to “Hello world”.' );
		expect( toast.action ).toBeUndefined();
		expect( restMock.listPlacements ).toHaveBeenCalledWith( 4 );
		expect( storeMock.setFolderPlacements ).toHaveBeenCalledWith( 4, [] );
	} );

	test( 'a rejected drop surfaces the server message', async () => {
		restMock.attachUploadsToPost.mockRejectedValue(
			new RestError( '', { status: 403, code: 'openstation_stored_file_cannot_edit_post', serverMessage: 'You are not allowed to edit this post.' } ),
		);
		const tp = await load();
		tp.tilePayloadDrop( session( [ placement( uploadFile() ) ] ) as never, { clientX: 0, clientY: 0 }, { placement: placement( postFile() ) as never } );
		await Promise.resolve();
		await Promise.resolve();
		expect( ( showToast.mock.calls[ 0 ][ 0 ] as { message: string } ).message ).toBe(
			'Could not add to the post: You are not allowed to edit this post.',
		);
		expect( openUrlWindow ).not.toHaveBeenCalled();
		expect( restMock.listPlacements ).not.toHaveBeenCalled();
	} );
} );
