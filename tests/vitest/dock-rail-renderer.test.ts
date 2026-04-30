/**
 * Tests for the dock rail renderer registry, the default-renderer
 * adapter that wraps the shipped `Dock` class, and the layout
 * dispatcher's integration with both.
 *
 * Three layers exercised:
 *
 * 1. Registry (`src/dock-rail/registry`) — register / unregister /
 *    fallback chain / setActive / resolveActive. Mirrors the
 *    submenu registry test shape so divergences across the two
 *    registries are visible.
 * 2. Default renderer (`src/dock-rail/default-renderer`) — adapter
 *    over `Dock`. The escape-hatch symbol (`unwrapDefaultDock`)
 *    must recover the underlying Dock for backwards compat.
 * 3. Dispatcher integration (`src/desktop-layout`) — custom
 *    renderer's mount() invoked with the expected deps;
 *    `getPrimary` returns null with a custom renderer; switching
 *    the active id rebuilds rails; throwing renderers fall back
 *    to default + emit SHELL_ERROR.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createLayoutDispatcher } from '../../src/desktop-layout';
import { Dock, type DockItem } from '../../src/dock';
import {
	_resetDockRailRenderersForTests,
	defaultDockRailRenderer,
	getActiveDockRailRendererId,
	installDefaultDockRailRenderer,
	listDockRailRenderers,
	registerDockRailRenderer,
	resolveActiveDockRailRenderer,
	setActiveDockRailRenderer,
	unregisterDockRailRenderer,
	unregisterDockRailRenderersByOwner,
	unwrapDefaultDock,
	type DockRailController,
	type DockRailMountDeps,
	type DockRailRenderer,
} from '../../src/dock-rail';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import type { WindowManager } from '../../src/window-manager';

function makeManager(): WindowManager {
	return {
		open: vi.fn(),
		openNew: vi.fn(),
		getFocused: () => null,
		getAllByBaseId: () => [],
		getById: () => undefined,
		getActiveDesktopId: () => 'default-1',
	} as unknown as WindowManager;
}

function makeItem( overrides: Partial< DockItem > = {} ): DockItem {
	return {
		id: 'edit.php',
		title: 'Posts',
		icon: 'dashicons-admin-post',
		url: '/wp-admin/edit.php',
		badge: 0,
		submenu: [],
		multi: false,
		isCore: true,
		...overrides,
	};
}

function makeShell(): {
	shellRoot: HTMLElement;
	shellBody: HTMLElement;
	bottomDockEl: HTMLElement;
	desktopArea: HTMLElement;
} {
	document.body.innerHTML = '';
	const shellRoot = document.createElement( 'div' );
	shellRoot.id = 'wp-desktop-shell';
	const shellBody = document.createElement( 'div' );
	shellBody.className = 'wp-desktop-shell__body';
	const bottomDockEl = document.createElement( 'nav' );
	bottomDockEl.id = 'wp-desktop-dock';
	bottomDockEl.className = 'wp-desktop-dock';
	const desktopArea = document.createElement( 'div' );
	desktopArea.id = 'wp-desktop-area';
	shellBody.append( bottomDockEl, desktopArea );
	shellRoot.append( shellBody );
	document.body.append( shellRoot );
	return { shellRoot, shellBody, bottomDockEl, desktopArea };
}

describe( 'dock-rail registry', () => {
	beforeEach( () => {
		installHooksStub();
		_resetDockRailRenderersForTests();
		installDefaultDockRailRenderer();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetDockRailRenderersForTests();
		document.body.innerHTML = '';
	} );

	test( 'register / unregister / list round-trips', () => {
		expect( listDockRailRenderers() ).toHaveLength( 1 );
		registerDockRailRenderer( {
			id: 'ring',
			label: 'Ring',
			mount: () => ( {
				replaceItems: () => {},
				appendSystemItem: () => {},
				removeSystemItem: () => {},
				destroy: () => {},
			} ),
		} );
		expect( listDockRailRenderers() ).toHaveLength( 2 );
		unregisterDockRailRenderer( 'ring' );
		expect( listDockRailRenderers() ).toHaveLength( 1 );
	} );

	test( 'register validates the contract aggressively', () => {
		expect( () =>
			registerDockRailRenderer( {} as DockRailRenderer ),
		).toThrow( /id must match/ );
		expect( () =>
			registerDockRailRenderer( {
				id: 'BAD ID',
				label: 'X',
				mount: () => ( {} as DockRailController ),
			} as DockRailRenderer ),
		).toThrow( /id must match/ );
		expect( () =>
			registerDockRailRenderer( {
				id: 'good',
				label: '',
				mount: () => ( {} as DockRailController ),
			} as DockRailRenderer ),
		).toThrow( /label/ );
		expect( () =>
			registerDockRailRenderer( {
				id: 'good',
				label: 'X',
			} as unknown as DockRailRenderer ),
		).toThrow( /mount/ );
		expect( () =>
			registerDockRailRenderer( {
				id: 'future',
				label: 'X',
				apiVersion: 99 as 1,
				mount: () => ( {} as DockRailController ),
			} ),
		).toThrow( /apiVersion/ );
	} );

	test( 'setActive + resolveActive picks the user choice; missing falls back to default', () => {
		const ring: DockRailRenderer = {
			id: 'ring',
			label: 'Ring',
			mount: () => ( {
				replaceItems: () => {},
				appendSystemItem: () => {},
				removeSystemItem: () => {},
				destroy: () => {},
			} ),
		};
		registerDockRailRenderer( ring );
		setActiveDockRailRenderer( 'ring' );
		expect( getActiveDockRailRendererId() ).toBe( 'ring' );
		expect( resolveActiveDockRailRenderer()?.id ).toBe( 'ring' );

		setActiveDockRailRenderer( 'plugin-uninstalled' );
		expect( resolveActiveDockRailRenderer()?.id ).toBe( 'default' );
	} );

	test( 'unregisterByOwner sweeps every renderer with a matching tag', () => {
		registerDockRailRenderer( {
			id: 'ring',
			label: 'Ring',
			owner: 'my-plugin',
			mount: () => ( {
				replaceItems: () => {},
				appendSystemItem: () => {},
				removeSystemItem: () => {},
				destroy: () => {},
			} ),
		} );
		registerDockRailRenderer( {
			id: 'fan',
			label: 'Fan',
			owner: 'my-plugin',
			mount: () => ( {
				replaceItems: () => {},
				appendSystemItem: () => {},
				removeSystemItem: () => {},
				destroy: () => {},
			} ),
		} );
		expect( unregisterDockRailRenderersByOwner( 'my-plugin' ) ).toBe( 2 );
		expect( listDockRailRenderers().map( ( r ) => r.id ) ).toEqual( [
			'default',
		] );
	} );
} );

describe( 'dock-rail default renderer adapter', () => {
	beforeEach( () => {
		installHooksStub();
		_resetDockRailRenderersForTests();
		installDefaultDockRailRenderer();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetDockRailRenderersForTests();
		document.body.innerHTML = '';
	} );

	test( 'mounts a Dock and unwrapDefaultDock recovers the instance', () => {
		const container = document.createElement( 'nav' );
		document.body.appendChild( container );
		const deps: DockRailMountDeps = {
			container,
			items: [ makeItem() ],
			orientation: 'bottom',
			openItem: () => {},
			openSystemItem: () => {},
			requestSubmenu: () => {},
			windowManager: makeManager(),
			adminUrl: '/wp-admin/',
		};
		const controller = defaultDockRailRenderer.mount( deps );
		const dock = unwrapDefaultDock( controller );
		expect( dock ).toBeInstanceOf( Dock );
		expect(
			container.querySelector( '[data-menu-slug="edit.php"]' ),
		).not.toBeNull();
		controller.destroy();
	} );

	test( 'unwrapDefaultDock returns null for a custom renderer controller', () => {
		const customController: DockRailController = {
			replaceItems: () => {},
			appendSystemItem: () => {},
			removeSystemItem: () => {},
			destroy: () => {},
		};
		expect( unwrapDefaultDock( customController ) ).toBeNull();
		expect( unwrapDefaultDock( null ) ).toBeNull();
	} );
} );

describe( 'dock-rail dispatcher integration', () => {
	beforeEach( () => {
		installHooksStub();
		_resetDockRailRenderersForTests();
		installDefaultDockRailRenderer();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetDockRailRenderersForTests();
		document.body.innerHTML = '';
	} );

	test( 'custom renderer mount() is invoked with the expected mount-deps', () => {
		const mount = vi.fn(
			( _deps: DockRailMountDeps ): DockRailController => ( {
				replaceItems: vi.fn(),
				appendSystemItem: vi.fn(),
				removeSystemItem: vi.fn(),
				destroy: vi.fn(),
			} ),
		);
		registerDockRailRenderer( {
			id: 'ring',
			label: 'Ring',
			mount,
		} );
		setActiveDockRailRenderer( 'ring' );

		const shell = makeShell();
		createLayoutDispatcher(
			{
				shellRoot: shell.shellRoot,
				shellBody: shell.shellBody,
				bottomDockEl: shell.bottomDockEl,
				desktopArea: shell.desktopArea,
				windowManager: makeManager(),
				adminUrl: '/wp-admin/',
				renderIcons: () => {},
			},
			'unified',
			[ makeItem() ],
			[],
		);

		expect( mount ).toHaveBeenCalledTimes( 1 );
		const deps = mount.mock.calls[ 0 ][ 0 ];
		expect( deps.container ).toBe( shell.bottomDockEl );
		expect( deps.orientation ).toBe( 'bottom' );
		expect( deps.items ).toHaveLength( 1 );
		expect( typeof deps.openItem ).toBe( 'function' );
		expect( typeof deps.openSystemItem ).toBe( 'function' );
		expect( typeof deps.requestSubmenu ).toBe( 'function' );
	} );

	test( 'getPrimary returns Dock for default renderer; null for custom', () => {
		const shell = makeShell();

		// Default renderer first — primary unwraps to a Dock.
		const dispatcher1 = createLayoutDispatcher(
			{
				shellRoot: shell.shellRoot,
				shellBody: shell.shellBody,
				bottomDockEl: shell.bottomDockEl,
				desktopArea: shell.desktopArea,
				windowManager: makeManager(),
				adminUrl: '/wp-admin/',
				renderIcons: () => {},
			},
			'unified',
			[ makeItem() ],
			[],
		);
		expect( dispatcher1.getPrimary() ).toBeInstanceOf( Dock );
		dispatcher1.destroy();

		// Reset and try with a custom renderer — primary is null
		// because the custom controller didn't expose the escape
		// hatch.
		document.body.innerHTML = '';
		registerDockRailRenderer( {
			id: 'ring',
			label: 'Ring',
			mount: () => ( {
				replaceItems: () => {},
				appendSystemItem: () => {},
				removeSystemItem: () => {},
				destroy: () => {},
			} ),
		} );
		setActiveDockRailRenderer( 'ring' );

		const shell2 = makeShell();
		const dispatcher2 = createLayoutDispatcher(
			{
				shellRoot: shell2.shellRoot,
				shellBody: shell2.shellBody,
				bottomDockEl: shell2.bottomDockEl,
				desktopArea: shell2.desktopArea,
				windowManager: makeManager(),
				adminUrl: '/wp-admin/',
				renderIcons: () => {},
			},
			'unified',
			[ makeItem() ],
			[],
		);
		expect( dispatcher2.getPrimary() ).toBeNull();
	} );

	test( 'flipping the active renderer rebuilds the rails', () => {
		const shell = makeShell();
		createLayoutDispatcher(
			{
				shellRoot: shell.shellRoot,
				shellBody: shell.shellBody,
				bottomDockEl: shell.bottomDockEl,
				desktopArea: shell.desktopArea,
				windowManager: makeManager(),
				adminUrl: '/wp-admin/',
				renderIcons: () => {},
			},
			'unified',
			[ makeItem() ],
			[],
		);
		// Default renderer mounted.
		expect(
			shell.bottomDockEl.querySelector( '[data-menu-slug="edit.php"]' ),
		).not.toBeNull();

		const customMount = vi.fn(
			(): DockRailController => ( {
				replaceItems: vi.fn(),
				appendSystemItem: vi.fn(),
				removeSystemItem: vi.fn(),
				destroy: vi.fn(),
			} ),
		);
		registerDockRailRenderer( {
			id: 'ring',
			label: 'Ring',
			mount: customMount,
		} );
		setActiveDockRailRenderer( 'ring' );

		expect( customMount ).toHaveBeenCalledTimes( 1 );
		// Default renderer's DOM should be torn down.
		expect(
			shell.bottomDockEl.querySelector( '[data-menu-slug="edit.php"]' ),
		).toBeNull();
	} );

	test( 'a throwing renderer surfaces SHELL_ERROR and falls back to default', () => {
		const wp = window.wp!;
		const onError = vi.fn();
		wp.hooks.addAction(
			'wp-desktop.shell.error',
			'test/error',
			onError,
		);
		registerDockRailRenderer( {
			id: 'broken',
			label: 'Broken',
			mount: () => {
				throw new Error( 'kaboom' );
			},
		} );
		setActiveDockRailRenderer( 'broken' );

		const shell = makeShell();
		createLayoutDispatcher(
			{
				shellRoot: shell.shellRoot,
				shellBody: shell.shellBody,
				bottomDockEl: shell.bottomDockEl,
				desktopArea: shell.desktopArea,
				windowManager: makeManager(),
				adminUrl: '/wp-admin/',
				renderIcons: () => {},
			},
			'unified',
			[ makeItem() ],
			[],
		);

		expect( onError ).toHaveBeenCalled();
		// Fallback default renderer rendered the tile.
		expect(
			shell.bottomDockEl.querySelector( '[data-menu-slug="edit.php"]' ),
		).not.toBeNull();
	} );
} );
