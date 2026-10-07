import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Window } from '../../src/window';
import type { WindowConfig } from '../../src/types';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const LIFECYCLE_HOOKS = [
	'os.window.minimized',
	'os.window.restored',
	'os.window.maximized',
	'os.window.unmaximized',
	'os.window.fullscreen-entered',
	'os.window.fullscreen-exited',
	'os.window.title-changed',
	'os.window.detached',
] as const;

function baseConfig( overrides: Partial<WindowConfig> = {} ): WindowConfig {
	return {
		id: 'w1',
		url: 'http://example.test/wp-admin/edit.php',
		title: 'Editor',
		icon: 'dashicons-admin-post',
		x: 40,
		y: 40,
		width: 800,
		height: 600,
		minWidth: 320,
		minHeight: 200,
		...overrides,
	};
}

function mountWindow( cfg: WindowConfig ): { win: Window; cleanup: () => void } {
	const parent = document.createElement( 'div' );
	Object.defineProperty( parent, 'clientWidth', { value: 1200, configurable: true } );
	Object.defineProperty( parent, 'clientHeight', { value: 800, configurable: true } );
	document.body.appendChild( parent );
	const win = new Window( cfg );
	parent.appendChild( win.element );
	return {
		win,
		cleanup: () => {
			parent.remove();
		},
	};
}

describe( 'Window — lifecycle hook firing', () => {
	let hooks: FakeWpHooks;
	let handle: { win: Window; cleanup: () => void };

	beforeEach( () => {
		hooks = installHooksStub();
		handle = mountWindow( baseConfig() );
	} );

	afterEach( () => {
		handle.cleanup();
		clearHooksStub();
	} );

	test( 'setTitle fires window.title-changed with { windowId, title }', () => {
		const log = recordActions( hooks, LIFECYCLE_HOOKS );

		handle.win.setTitle( 'New Title' );

		const evt = log.find( ( e ) => e.name === 'os.window.title-changed' );
		expect( evt ).toBeDefined();
		const payload = evt!.args[ 0 ] as { windowId: string; title: string };
		expect( payload.windowId ).toBe( 'w1' );
		expect( payload.title ).toBe( 'New Title' );
	} );

	test( 'minimize fires window.minimized', () => {
		const log = recordActions( hooks, LIFECYCLE_HOOKS );

		handle.win.minimize();

		const evt = log.find( ( e ) => e.name === 'os.window.minimized' );
		expect( evt ).toBeDefined();
		expect(
			( evt!.args[ 0 ] as { windowId: string } ).windowId,
		).toBe( 'w1' );
	} );

	test( 'restore (from minimized) fires window.restored; no-op when already normal fires nothing', () => {

		handle.win.minimize();
		const log = recordActions( hooks, LIFECYCLE_HOOKS );
		handle.win.restore();

		const restored = log.filter( ( e ) => e.name === 'os.window.restored' );
		expect( restored ).toHaveLength( 1 );

		const log2 = recordActions( hooks, LIFECYCLE_HOOKS );
		handle.win.restore();
		expect(
			log2.some( ( e ) => e.name === 'os.window.restored' ),
		).toBe( false );
	} );

	test( 'maximize() (one-way) fires window.maximized', () => {
		const log = recordActions( hooks, LIFECYCLE_HOOKS );

		handle.win.maximize();

		const evts = log.filter( ( e ) => e.name === 'os.window.maximized' );
		expect( evts ).toHaveLength( 1 );
	} );

	test( 'maximize() is idempotent — second call fires nothing', () => {
		handle.win.maximize();
		const log = recordActions( hooks, LIFECYCLE_HOOKS );
		handle.win.maximize();

		expect( log ).toEqual( [] );
	} );

	test( 'toggleMaximize enters with maximized, exits with unmaximized', () => {
		const log = recordActions( hooks, LIFECYCLE_HOOKS );

		handle.win.toggleMaximize();
		handle.win.toggleMaximize();

		const names = log
			.filter(
				( e ) =>
					e.name === 'os.window.maximized'
					|| e.name === 'os.window.unmaximized',
			)
			.map( ( e ) => e.name );
		expect( names ).toEqual( [
			'os.window.maximized',
			'os.window.unmaximized',
		] );
	} );

	test( 'toggleFullscreen enters with fullscreen-entered, exits with fullscreen-exited', () => {
		const log = recordActions( hooks, LIFECYCLE_HOOKS );

		handle.win.toggleFullscreen();
		handle.win.toggleFullscreen();

		const names = log
			.filter(
				( e ) =>
					e.name === 'os.window.fullscreen-entered'
					|| e.name === 'os.window.fullscreen-exited',
			)
			.map( ( e ) => e.name );
		expect( names ).toEqual( [
			'os.window.fullscreen-entered',
			'os.window.fullscreen-exited',
		] );
	} );

	test( 'detach fires window.detached with { windowId, url } stripped of chromeless flags', () => {

		handle.cleanup();
		handle = mountWindow(
			baseConfig( {
				id: 'posts',
				url: `${ window.location.origin }/wp-admin/edit.php?openstation_chromeless=1`,
			} ),
		);

		const openSpy = vi
			.spyOn( window, 'open' )
			.mockImplementation( () => null );

		const log = recordActions( hooks, LIFECYCLE_HOOKS );

		handle.win.detach();

		const evt = log.find( ( e ) => e.name === 'os.window.detached' );
		expect( evt ).toBeDefined();
		const payload = evt!.args[ 0 ] as { windowId: string; url: string };
		expect( payload.windowId ).toBe( 'posts' );
		expect( payload.url ).not.toContain( 'openstation_chromeless=1' );
		expect( payload.url ).toContain( 'desktop_mode_classic=1' );

		openSpy.mockRestore();
	} );

	test( 'detach opens the page an unreadable frame reported, not the one the window opened on', () => {

		const origin = window.location.origin;
		handle.cleanup();
		handle = mountWindow( baseConfig( { id: 'post-2', url: `${ origin }/wp-admin/post.php?post=2&action=edit` } ) );
		const iframe = handle.win.iframe as HTMLIFrameElement;
		const isolated = {
			get location(): Location {
				throw new DOMException( 'Blocked a frame', 'SecurityError' );
			},
		};
		Object.defineProperty( iframe, 'contentWindow', { value: isolated, configurable: true } );
		const elementor = `${ origin }/wp-admin/post.php?post=2&action=elementor`;
		const landed = new MessageEvent( 'message', { data: { type: 'os-iframe-navigated', url: elementor }, origin } );
		Object.defineProperty( landed, 'source', { value: isolated } );
		window.dispatchEvent( landed );
		const openSpy = vi.spyOn( window, 'open' ).mockImplementation( () => null );

		handle.win.detach();

		expect( openSpy ).toHaveBeenCalledWith( `${ elementor }&desktop_mode_classic=1`, '_blank', 'noopener' );

		iframe.src = `${ origin }/wp-admin/edit.php`;
		expect( handle.win.getCurrentUrl() ).toBe( iframe.src );
		openSpy.mockRestore();
	} );

	test( 'detach refuses cross-origin URLs and fires nothing', () => {
		handle.cleanup();
		handle = mountWindow(
			baseConfig( {
				id: 'external',
				url: 'https://evil.example.com/wp-admin/',
			} ),
		);
		const openSpy = vi
			.spyOn( window, 'open' )
			.mockImplementation( () => null );

		const log = recordActions( hooks, LIFECYCLE_HOOKS );
		handle.win.detach();

		expect(
			log.some( ( e ) => e.name === 'os.window.detached' ),
		).toBe( false );
		expect( openSpy ).not.toHaveBeenCalled();

		openSpy.mockRestore();
	} );
} );
