/**
 * Tests for the stored-upload menu wiring: Download on upload
 * tiles, zip download on folders (gated on server ZipArchive),
 * owner-vs-recipient share entries, and download-URL minting.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

interface ConfigShape {
	currentUserId?: number;
	desktopStorage?: {
		canUpload: boolean;
		maxBytes: number;
		quotaBytes: number;
		zipAvailable: boolean;
	};
}

function setConfig( cfg: ConfigShape ): void {
	( window as unknown as { openStationConfig?: ConfigShape } ).openStationConfig = cfg;
}

const uploadPlacement = ( overrides: Record< string, unknown > = {} ) => ( {
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
		title: 'report.pdf',
		icon: 'dashicons-pdf',
		previewUrl: '',
		exists: true,
		ownerId: 5,
		sizeBytes: 8,
		mime: 'application/pdf',
		kind: 'pdf',
	},
	...overrides,
} );

const folderPlacement = () => ( {
	id: 12,
	parentId: 0,
	x: 0,
	y: 0,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file: {
		type: 'folder',
		ref: '9',
		title: 'Docs',
		icon: 'dashicons-portfolio',
		previewUrl: '',
		exists: true,
	},
} );

async function loadAndInstall() {
	vi.resetModules();
	const hooks = await import( '../../src/hooks' );
	const mod = await import( '../../src/desktop-files/upload-menu-items' );
	mod.installUploadMenuItems();
	return {
		applyMenu: ( placement: unknown ) =>
			hooks.applyFilters(
				'os.files.tile-menu',
				[],
				placement,
			) as Array< { id: string; label: string } >,
		applyWallpaper: () =>
			hooks.applyFilters(
				'os.wallpaper-context-menu',
				[],
			) as Array< { id: string } >,
	};
}

describe( 'upload menu items', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		setConfig( {} );
		document.body.innerHTML = '';
	} );

	test( 'upload tile gets Download; owner also gets Share', async () => {
		setConfig( {
			currentUserId: 5,
			desktopStorage: { canUpload: true, maxBytes: 0, quotaBytes: 0, zipAvailable: true },
		} );
		const { applyMenu } = await loadAndInstall();
		const items = applyMenu( uploadPlacement() );
		const ids = items.map( ( i ) => i.id );
		expect( ids ).toContain( 'desktop-mode/upload-download' );
		expect( ids ).toContain( 'desktop-mode/upload-share' );
		expect( ids ).not.toContain( 'desktop-mode/upload-leave' );
	} );

	test( 'recipient root tile gets Leave, not Share', async () => {
		setConfig( {
			currentUserId: 8,
			desktopStorage: { canUpload: true, maxBytes: 0, quotaBytes: 0, zipAvailable: true },
		} );
		const { applyMenu } = await loadAndInstall();
		const items = applyMenu( uploadPlacement() );
		const ids = items.map( ( i ) => i.id );
		expect( ids ).toContain( 'desktop-mode/upload-download' );
		expect( ids ).toContain( 'desktop-mode/upload-leave' );
		expect( ids ).not.toContain( 'desktop-mode/upload-share' );
	} );

	test( 'recipient tile inside a folder gets no Leave entry', async () => {
		setConfig( {
			currentUserId: 8,
			desktopStorage: { canUpload: true, maxBytes: 0, quotaBytes: 0, zipAvailable: true },
		} );
		const { applyMenu } = await loadAndInstall();
		const ids = applyMenu( uploadPlacement( { parentId: 3 } ) ).map( ( i ) => i.id );
		expect( ids ).not.toContain( 'desktop-mode/upload-leave' );
	} );

	test( 'folder tile gets zip download only when the server can zip', async () => {
		setConfig( {
			currentUserId: 5,
			desktopStorage: { canUpload: true, maxBytes: 0, quotaBytes: 0, zipAvailable: true },
		} );
		let { applyMenu } = await loadAndInstall();
		expect( applyMenu( folderPlacement() ).map( ( i ) => i.id ) ).toContain(
			'desktop-mode/folder-zip-download',
		);

		setConfig( {
			currentUserId: 5,
			desktopStorage: { canUpload: true, maxBytes: 0, quotaBytes: 0, zipAvailable: false },
		} );
		( { applyMenu } = await loadAndInstall() );
		expect( applyMenu( folderPlacement() ).map( ( i ) => i.id ) ).not.toContain(
			'desktop-mode/folder-zip-download',
		);
	} );

	test( 'non-upload, non-folder tiles are untouched', async () => {
		setConfig( {
			currentUserId: 5,
			desktopStorage: { canUpload: true, maxBytes: 0, quotaBytes: 0, zipAvailable: true },
		} );
		const { applyMenu } = await loadAndInstall();
		const post = uploadPlacement();
		( post.file as { type: string } ).type = 'post';
		expect( applyMenu( post ) ).toEqual( [] );
	} );

	test( 'wallpaper menu offers pickers only to uploaders', async () => {
		setConfig( {
			currentUserId: 5,
			desktopStorage: { canUpload: true, maxBytes: 0, quotaBytes: 0, zipAvailable: true },
		} );
		let { applyWallpaper } = await loadAndInstall();
		const ids = applyWallpaper().map( ( i ) => i.id );
		expect( ids ).toContain( 'desktop-mode/upload-files' );
		expect( ids ).toContain( 'desktop-mode/upload-folder' );

		setConfig( {
			currentUserId: 5,
			desktopStorage: { canUpload: false, maxBytes: 0, quotaBytes: 0, zipAvailable: true },
		} );
		( { applyWallpaper } = await loadAndInstall() );
		expect( applyWallpaper() ).toEqual( [] );
	} );
} );

describe( 'download URL minting', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'URLs carry the _wpnonce query param', async () => {
		vi.resetModules();
		const rest = await import( '../../src/desktop-files/rest' );
		rest.installRestDeps( {
			baseUrl: 'https://example.test/wp-json/desktop-mode/v1/files',
			nonce: 'abc123',
		} );
		expect( rest.getUploadDownloadUrl( 7 ) ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/files/uploads/7/download?_wpnonce=abc123',
		);
		expect( rest.getFolderZipUrl( 9 ) ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/files/folders/9/download?_wpnonce=abc123',
		);
	} );
} );
