import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

describe( 'web bookmark activation and window safety', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( async () => {
		const openers = await import( '../../src/desktop-files/openers' );
		const registry = await import( '../../src/desktop-files/registry' );
		const buttons = await import( '../../src/title-bar-buttons/registry' );
		openers.__resetOpenersForTests();
		registry.__resetForTests();
		buttons.unregisterTitleBarButton( 'desktop-mode/embed-open-browser' );
		clearHooksStub();
		document.body.innerHTML = '';
		vi.restoreAllMocks();
	} );

	test( 'double-click and Enter share the opener while click and Space do not open', async () => {
		vi.resetModules();
		const fileTile = await import( '../../src/desktop-files/file-tile' );
		const registry = await import( '../../src/desktop-files/registry' );
		const openers = await import( '../../src/desktop-files/openers' );
		const open = await import( '../../src/desktop-files/open' );
		registry.registerType( { type: 'embed', label: 'Web bookmark', sort: 1 } );
		const activate = vi.fn();
		openers.registerOpener( {
			id: 'test-embed',
			label: 'Test embed',
			types: [ 'embed' ],
			isDefault: true,
			handler: { kind: 'js', open: activate },
		} );
		open.installOpenDeps( {
			openUrl: () => true,
			openNativeWindow: () => true,
			deriveWindowId: () => 'unused',
		} );
		const row = {
			id: 8,
			parentId: 0,
			x: 16,
			y: 16,
			sortOrder: 0,
			updatedAtMs: 1,
			meta: null,
			file: {
				type: 'embed',
				ref: 'https://example.com/',
				title: 'example.com',
				icon: 'dashicons-welcome-view-site',
				previewUrl: '',
				exists: true,
				url: 'https://example.com/',
			},
		};
		const tile = fileTile.buildTile( row, 0 );
		document.body.appendChild( tile );

		tile.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		tile.dispatchEvent( new KeyboardEvent( 'keydown', { key: ' ', bubbles: true } ) );
		expect( activate ).not.toHaveBeenCalled();

		tile.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true, cancelable: true } ) );
		tile.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true, cancelable: true } ) );
		await Promise.resolve();
		expect( activate ).toHaveBeenCalledTimes( 2 );
		expect( activate.mock.calls[ 0 ][ 1 ] ).toMatchObject( {
			placement: { id: 8 },
		} );
	} );

	test( 'embed opener validates the serialized URL and restores geometry', async () => {
		vi.resetModules();
		const { DefaultDesktopFile } = await import( '../../src/desktop-files/file' );
		const { openEmbedWindow } = await import( '../../src/desktop-files/embed-window' );
		const open = vi.fn();
		( window.wp as unknown as { desktop: { windowManager: { open: typeof open } } } ).desktop = {
			windowManager: { open },
		};
		const area = document.createElement( 'div' );
		area.id = 'desktop-mode-area';
		Object.defineProperties( area, {
			clientWidth: { value: 1200 },
			clientHeight: { value: 900 },
		} );
		document.body.appendChild( area );

		const safe = new DefaultDesktopFile( {
			type: 'embed',
			ref: 'https://example.com/',
			title: 'example.com',
			icon: 'dashicons-welcome-view-site',
			previewUrl: '',
			exists: true,
			url: 'https://example.com/path',
		}, 'embed' );
		openEmbedWindow( safe, { placement: {
			id: 9,
			x: 0,
			y: 0,
			meta: {
				name: 'Kept title',
				iconUrl: 'data:image/png;base64,AA',
				window: { x: 44, y: 55, width: 640, height: 480 },
			},
		} } );
		expect( open ).toHaveBeenCalledWith( expect.objectContaining( {
			id: 'desktop-mode-embed-9',
			url: 'https://example.com/path',
			title: 'Kept title',
			icon: 'data:image/png;base64,AA',
			x: 44,
			y: 55,
			width: 640,
			height: 480,
		} ) );

		const unsafe = new DefaultDesktopFile( {
			...safe.shape,
			url: 'javascript:alert(1)',
		}, 'embed' );
		openEmbedWindow( unsafe );
		expect( open ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'installs an always-visible browser title-bar action', async () => {
		vi.resetModules();
		const { installEmbedTitleBarButton } = await import( '../../src/desktop-files/embed-window' );
		const { listTitleBarButtons } = await import( '../../src/title-bar-buttons/registry' );
		installEmbedTitleBarButton();
		installEmbedTitleBarButton();

		const button = listTitleBarButtons().find(
			( item ) => item.id === 'desktop-mode/embed-open-browser',
		);
		expect( button ).toMatchObject( {
			label: 'Open in browser',
			placement: 'right',
		} );
		const detach = vi.fn();
		const embedWindow = { id: 'desktop-mode-embed-4', detach } as never;
		expect( button?.match( embedWindow ) ).toBe( true );
		button?.onClick?.( embedWindow, new MouseEvent( 'click' ) );
		expect( detach ).toHaveBeenCalledOnce();
		expect(
			listTitleBarButtons().filter(
				( item ) => item.id === 'desktop-mode/embed-open-browser',
			),
		).toHaveLength( 1 );
	} );
} );
