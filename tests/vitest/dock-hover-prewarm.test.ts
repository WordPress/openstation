/**
 * The dock's hover intent, native edition.
 *
 * "Prewarm windows on hover" used to warm iframe pages only — a hidden
 * speculative window, adopted by the click — and stood down on every
 * native tile. Now the same dwell on a native window's tile calls
 * `wp.os.prewarmWindow( id )`: a system tile (Trash, Preferences), a
 * launcher synthesised from a registered icon, or a menu URL a native
 * remap captures (Posts with the native Posts window on).
 *
 * What these tests pin: which door each kind of tile takes, that the
 * toggle is read live, and that touch, leaving early, pressing, and an
 * already-open window all warm nothing.
 *
 * @group dock
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dock, type DockItem } from '../../src/dock';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { WindowManager } from '../../src/window-manager';

vi.mock( '../../src/native-url-remap', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('../../src/native-url-remap') >();
	return {
		...actual,
		// The native Posts window is in charge of edit.php; nothing else remaps.
		resolveNativeUrlRemap: ( url: string ) => ( url.includes( 'edit.php' ) ? 'desktop-mode-posts' : null ),
	};
} );

const DWELL_MS = 180;

interface Shell {
	prewarmWindow: ReturnType< typeof vi.fn >;
	settings: { windowPrewarmEnabled: boolean };
}

function installShell(): Shell {
	const shell: Shell = { prewarmWindow: vi.fn( async () => true ), settings: { windowPrewarmEnabled: true } };
	// Beside the hooks stub, never in its place.
	const wp = ( window as unknown as { wp?: Record< string, unknown > } ).wp ?? {};
	wp.os = {
		getOsSettings: () => shell.settings,
		prewarmWindow: shell.prewarmWindow,
	};
	( window as unknown as { wp?: unknown } ).wp = wp;
	return shell;
}

function menuItem( id: string, url: string ): DockItem {
	return { id, title: id, icon: 'dashicons-admin-post', url, badge: 0, submenu: [] };
}

function setup( items: DockItem[] ) {
	document.body.innerHTML = '';
	const desktopArea = document.createElement( 'div' );
	desktopArea.id = 'os-area';
	const dockEl = document.createElement( 'div' );
	dockEl.id = 'os-dock';
	document.body.append( desktopArea, dockEl );

	const getById = vi.fn( () => null );
	const prewarm = vi.fn( async () => true );
	const manager = {
		open: vi.fn(),
		openNew: vi.fn(),
		prewarm,
		getById,
		getByBaseIdOnActiveDesktop: () => undefined,
		getAllByBaseId: () => [],
		getAllByBaseIdOnActiveDesktop: () => [],
		getFocused: () => null,
		getAll: () => [],
		getCount: () => 0,
		getActiveDesktopId: () => 'desktop-1',
	} as unknown as WindowManager;

	const dock = new Dock( dockEl, manager, items, `${ window.location.origin }/wp-admin/`, 'bottom' );
	const tile = ( navId: string ): HTMLElement => {
		const el = dockEl.querySelector< HTMLElement >( `[data-nav-id="${ navId }"]` );
		if ( ! el ) {
			throw new Error( `no tile ${ navId }` );
		}
		return el;
	};
	return { dock, dockEl, manager, getById, prewarm, tile };
}

function pointer( el: HTMLElement, type: 'pointerenter' | 'pointerleave' | 'pointerdown', pointerType = 'mouse' ): void {
	const evt = new Event( type, { bubbles: type !== 'pointerenter' } );
	Object.defineProperty( evt, 'pointerType', { value: pointerType } );
	el.dispatchEvent( evt );
}

describe( 'dock — hover prewarm of native windows', () => {
	let shell: Shell;

	beforeEach( () => {
		installHooksStub();
		vi.useFakeTimers();
		shell = installShell();
	} );

	afterEach( () => {
		vi.useRealTimers();
		delete ( window as unknown as { wp?: { os?: unknown } } ).wp?.os;
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'a menu URL a native remap captures warms the native window, not an iframe', () => {
		const h = setup( [ menuItem( 'edit.php', `${ window.location.origin }/wp-admin/edit.php` ) ] );
		pointer( h.tile( 'edit.php' ), 'pointerenter' );
		expect( shell.prewarmWindow ).not.toHaveBeenCalled();
		vi.advanceTimersByTime( DWELL_MS );
		expect( shell.prewarmWindow ).toHaveBeenCalledWith( 'desktop-mode-posts' );
		expect( h.prewarm ).not.toHaveBeenCalled();
	} );

	test( 'a system tile warms its own window', () => {
		const h = setup( [] );
		h.dock.appendSystemItem( { id: 'desktop-mode-trash', title: 'Trash', icon: 'dashicons-trash', onOpen: vi.fn() } );
		pointer( h.tile( 'desktop-mode-trash' ), 'pointerenter' );
		vi.advanceTimersByTime( DWELL_MS );
		expect( shell.prewarmWindow ).toHaveBeenCalledWith( 'desktop-mode-trash' );
	} );

	test( 'a launcher synthesised from a registered icon warms the window it targets', () => {
		const h = setup( [ { ...menuItem( 'jorvy', '' ), windowId: 'jorvy-window' } ] );
		pointer( h.tile( 'jorvy' ), 'pointerenter' );
		vi.advanceTimersByTime( DWELL_MS );
		expect( shell.prewarmWindow ).toHaveBeenCalledWith( 'jorvy-window' );
	} );

	test( 'an iframe page still gets the speculative window', () => {
		const h = setup( [ menuItem( 'upload.php', `${ window.location.origin }/wp-admin/upload.php` ) ] );
		pointer( h.tile( 'upload.php' ), 'pointerenter' );
		vi.advanceTimersByTime( DWELL_MS );
		expect( h.prewarm ).toHaveBeenCalledTimes( 1 );
		expect( shell.prewarmWindow ).not.toHaveBeenCalled();
	} );

	test( 'the toggle is read at hover time; touch, leaving, pressing and an open window warm nothing', () => {
		const h = setup( [ menuItem( 'edit.php', `${ window.location.origin }/wp-admin/edit.php` ) ] );
		const tile = h.tile( 'edit.php' );

		shell.settings.windowPrewarmEnabled = false;
		pointer( tile, 'pointerenter' );
		vi.advanceTimersByTime( DWELL_MS );
		expect( shell.prewarmWindow ).not.toHaveBeenCalled();
		shell.settings.windowPrewarmEnabled = true;

		pointer( tile, 'pointerenter', 'touch' );
		vi.advanceTimersByTime( DWELL_MS );
		expect( shell.prewarmWindow ).not.toHaveBeenCalled();

		pointer( tile, 'pointerenter' );
		vi.advanceTimersByTime( DWELL_MS / 2 );
		pointer( tile, 'pointerleave' );
		vi.advanceTimersByTime( DWELL_MS );
		expect( shell.prewarmWindow ).not.toHaveBeenCalled();

		pointer( tile, 'pointerenter' );
		vi.advanceTimersByTime( DWELL_MS / 2 );
		pointer( tile, 'pointerdown' );
		vi.advanceTimersByTime( DWELL_MS );
		expect( shell.prewarmWindow ).not.toHaveBeenCalled();

		h.getById.mockReturnValue( { id: 'desktop-mode-posts' } as never );
		pointer( tile, 'pointerenter' );
		vi.advanceTimersByTime( DWELL_MS );
		expect( shell.prewarmWindow ).not.toHaveBeenCalled();
	} );
} );
