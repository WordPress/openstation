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
		const seg = host.querySelector< HTMLElement >( '[data-segment-id="count"] .desktop-mode-folder-status-bar__label' );
		expect( seg?.textContent ).toBe( '2 files, 1 folder' );
	} );

	test( 'singular vs plural labels', async () => {
		const { bar, store } = await load();
		store.__resetFilesStoreForTests();
		store.setFolderPlacements( 0, [ placement( 1, 'post' ) ] );
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		bar.mountFolderStatusBar( host, 0 );
		const seg = host.querySelector< HTMLElement >( '[data-segment-id="count"] .desktop-mode-folder-status-bar__label' );
		expect( seg?.textContent ).toBe( '1 file' );
	} );

	test( 'plugin filter can append a segment', async () => {
		const { bar, store } = await load();
		store.__resetFilesStoreForTests();
		store.setFolderPlacements( 0, [] );
		const stub = ( window.wp as { hooks: { addFilter: ( ...a: unknown[] ) => void } } ).hooks;
		stub.addFilter(
			'desktop-mode.files.folder-window.status-bar',
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
			'[data-segment-id="count"] .desktop-mode-folder-status-bar__label',
		);
		expect( seg?.textContent ).toBe( '1 file' );
	} );

	test( 'dispose unmounts and stops repainting', async () => {
		const { bar, store } = await load();
		store.__resetFilesStoreForTests();
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = bar.mountFolderStatusBar( host, 0 );
		expect( host.querySelector( '.desktop-mode-folder-status-bar' ) ).not.toBeNull();
		handle.dispose();
		expect( host.querySelector( '.desktop-mode-folder-status-bar' ) ).toBeNull();
		// Subsequent store mutation must not re-create the bar.
		store.setFolderPlacements( 0, [ placement( 9 ) ] );
		expect( host.querySelector( '.desktop-mode-folder-status-bar' ) ).toBeNull();
	} );
} );
