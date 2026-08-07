/**
 * Folder window status bar tests.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

async function load() {
	vi.resetModules();
	return {
		bar: await import( '../../src/desktop-files/folder-status-bar' ),
		store: await import( '../../src/desktop-files/store' ),
		hooks: await import( '../../src/hooks' ),
	};
}

const placement = ( id: number, type: 'post' | 'folder' = 'post', parentId = 0 ) => ( {
	id,
	parentId,
	x: 0,
	y: 0,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file: {
		type,
		ref: String( id ),
		title: `${ type } ${ id }`,
		icon: 'dashicons-warning',
		previewUrl: '',
		exists: true,
	},
} );

describe( 'folder status bar', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'renders the file/folder count', async () => {
		const { bar, store } = await load();
		store.__resetFilesStoreForTests();
		store.setFolderPlacements( 5, [ placement( 1, 'post', 5 ), placement( 2, 'folder', 5 ), placement( 3, 'post', 5 ) ] );
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		bar.mountFolderStatusBar( host, 5 );
		const seg = host.querySelector< HTMLElement >( '[data-segment-id="count"] .os-folder-status-bar__label' );
		expect( seg?.textContent ).toBe( '2 files, 1 folder' );
	} );

	test( 'appends the stored-upload size when the folder holds real bytes', async () => {
		const { bar, store } = await load();
		store.__resetFilesStoreForTests();
		const upload = ( id: number, sizeBytes: number ) => ( {
			...placement( id, 'post', 7 ),
			file: {
				...placement( id, 'post', 7 ).file,
				type: 'upload',
				sizeBytes,
			},
		} );
		store.setFolderPlacements( 7, [
			upload( 1, 20 * 1024 * 1024 ),
			upload( 2, 3.2 * 1024 * 1024 ),
			placement( 3, 'folder', 7 ),
			placement( 4, 'post', 7 ), // Reference tile — weighs nothing.
		] );
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		bar.mountFolderStatusBar( host, 7 );
		const seg = host.querySelector< HTMLElement >( '[data-segment-id="count"] .os-folder-status-bar__label' );
		expect( seg?.textContent ).toBe( '3 files, 1 folder (23.2 MB)' );
	} );

	test( 'omits the size for folders with only reference tiles', async () => {
		const { bar, store } = await load();
		store.__resetFilesStoreForTests();
		store.setFolderPlacements( 8, [ placement( 1, 'post', 8 ) ] );
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		bar.mountFolderStatusBar( host, 8 );
		const seg = host.querySelector< HTMLElement >( '[data-segment-id="count"] .os-folder-status-bar__label' );
		expect( seg?.textContent ).toBe( '1 file' );
	} );

	test( 'singular vs plural labels', async () => {
		const { bar, store } = await load();
		store.__resetFilesStoreForTests();
		store.setFolderPlacements( 0, [ placement( 1, 'post' ) ] );
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		bar.mountFolderStatusBar( host, 0 );
		const seg = host.querySelector< HTMLElement >( '[data-segment-id="count"] .os-folder-status-bar__label' );
		expect( seg?.textContent ).toBe( '1 file' );
	} );

	test( 'plugin filter can append a segment', async () => {
		const { bar, store } = await load();
		store.__resetFilesStoreForTests();
		store.setFolderPlacements( 0, [] );
		const stub = ( window.wp as { hooks: { addFilter: ( ...a: unknown[] ) => void } } ).hooks;
		stub.addFilter(
			'os.files.folder-window.status-bar',
			'test/sync',
			( segs: unknown ) => [
				...( segs as Array< Record< string, unknown > > ),
				{ id: 'sync', label: 'Synced', align: 'end', sort: 80 },
			],
		);
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		bar.mountFolderStatusBar( host, 0 );
		expect(
			host.querySelector( '[data-segment-id="sync"]' ),
		).not.toBeNull();
	} );

	test( 'repaints when the placement list changes', async () => {
		const { bar, store } = await load();
		store.__resetFilesStoreForTests();
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		bar.mountFolderStatusBar( host, 0 );
		store.setFolderPlacements( 0, [ placement( 1, 'post' ) ] );
		const seg = host.querySelector< HTMLElement >(
			'[data-segment-id="count"] .os-folder-status-bar__label',
		);
		expect( seg?.textContent ).toBe( '1 file' );
	} );

	test( 'shows the selection size, and only while there is one', async () => {
		const { bar, store } = await load();
		store.__resetFilesStoreForTests();
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		let count = 0;
		let notify: () => void = () => undefined;
		bar.mountFolderStatusBar( host, 0, {
			selection: {
				count: () => count,
				subscribe: ( cb ) => {
					notify = cb;
					return () => undefined;
				},
			},
		} );
		// Nothing selected — no segment at all. A permanent
		// "0 selected" would be noise on a glanceable bar.
		expect(
			host.querySelector( '[data-segment-id="selection"]' ),
		).toBeNull();

		count = 3;
		notify();
		const seg = host.querySelector< HTMLElement >(
			'[data-segment-id="selection"] .os-folder-status-bar__label',
		);
		expect( seg?.textContent ).toBe( '3 selected' );

		count = 0;
		notify();
		expect(
			host.querySelector( '[data-segment-id="selection"]' ),
		).toBeNull();
	} );

	test( 'the status-bar filter sees the selection size', async () => {
		const { bar, store, hooks } = await load();
		store.__resetFilesStoreForTests();
		hooks.addFilter(
			'os.files.folder-window.status-bar',
			'test/selection',
			(
				segs: unknown,
				ctx: { selectedCount: number },
			) => [
				...( segs as Array< Record< string, unknown > > ),
				{ id: 'echo', label: `saw ${ ctx.selectedCount }` },
			],
		);
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		bar.mountFolderStatusBar( host, 0, {
			selection: { count: () => 2, subscribe: () => () => undefined },
		} );
		const seg = host.querySelector< HTMLElement >(
			'[data-segment-id="echo"] .os-folder-status-bar__label',
		);
		expect( seg?.textContent ).toBe( 'saw 2' );
	} );

	test( 'dispose unmounts and stops repainting', async () => {
		const { bar, store } = await load();
		store.__resetFilesStoreForTests();
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = bar.mountFolderStatusBar( host, 0 );
		expect( host.querySelector( '.os-folder-status-bar' ) ).not.toBeNull();
		handle.dispose();
		expect( host.querySelector( '.os-folder-status-bar' ) ).toBeNull();
		// Subsequent store mutation must not re-create the bar.
		store.setFolderPlacements( 0, [ placement( 9 ) ] );
		expect( host.querySelector( '.os-folder-status-bar' ) ).toBeNull();
	} );
} );
