/**
 * Tests for `Window.swapReload()` — the silent, double-buffered
 * refresh used by the editor-preview companion:
 *
 *   - buffer creation: hidden twin stacked in the body, visible frame
 *     untouched, loading overlay never armed
 *   - swap on buffer load: old frame removed, `win.iframe` re-pointed,
 *     buffer promoted (class/name/aria cleanup)
 *   - re-entrancy: a newer swap supersedes an in-flight buffer; a
 *     superseded buffer's late load is ignored
 *   - post-swap overlay contract: a later classic `reload()` still
 *     clears the loading overlay via the re-wired `load` handler
 *   - `WINDOW_RELOADED` fires with `silent: true` on completion
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { HOOKS } from '../../src/hooks';
import {
	installWindowLoadingTransitions,
	_resetWindowLoadingTransitionsForTests,
} from '../../src/window/loading';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

function openConfig( id: string ) {
	return {
		id,
		url: `/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

const BUFFER_SELECTOR = '.os-window__iframe--buffer';

describe( 'Window.swapReload', () => {
	let hooks: FakeWpHooks;
	let desktopArea: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		hooks = installHooksStub();
		desktopArea = document.createElement( 'div' );
		Object.defineProperty( desktopArea, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		Object.defineProperty( desktopArea, 'clientWidth', {
			value: 1600,
			configurable: true,
		} );
		Object.defineProperty( desktopArea, 'clientHeight', {
			value: 900,
			configurable: true,
		} );
		document.body.appendChild( desktopArea );
		manager = new WindowManager( desktopArea );
		// The body--loading class toggling is hook-driven; the shell
		// boot installs it once, tests re-install per hooks stub.
		_resetWindowLoadingTransitionsForTests();
		installWindowLoadingTransitions();
	} );

	afterEach( () => {
		manager.destroy();
		clearHooksStub();
		vi.restoreAllMocks();
		vi.useRealTimers();
		document.body.innerHTML = '';
	} );

	test( 'loads into a hidden twin — visible frame and overlay untouched', async () => {
		const win = await manager.open( openConfig( 'sw1' ) );
		const body = win.element.querySelector( '.os-window__body' )!;
		const original = win.iframe!;
		const overlayStateBefore = body.classList.contains(
			'os-window__body--loading',
		);

		win.swapReload();

		const buffer = body.querySelector< HTMLIFrameElement >(
			BUFFER_SELECTOR,
		);
		expect( buffer ).not.toBeNull();
		expect( buffer!.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		// The visible frame is still the primary one, still attached,
		// elevated above the loading twin for the swap's duration.
		expect( win.iframe ).toBe( original );
		expect( original.isConnected ).toBe( true );
		expect(
			original.classList.contains(
				'os-window__iframe--swap-front',
			),
		).toBe( true );
		// swapReload never arms (or clears) the loading overlay.
		expect(
			body.classList.contains( 'os-window__body--loading' ),
		).toBe( overlayStateBefore );
	} );

	test( 'buffer load promotes instantly and re-points win.iframe', async () => {
		const win = await manager.open( openConfig( 'sw2' ) );
		const body = win.element.querySelector( '.os-window__body' )!;
		const original = win.iframe!;

		win.swapReload( '/wp-admin/a.php?fresh=1' );
		const buffer = body.querySelector< HTMLIFrameElement >(
			BUFFER_SELECTOR,
		)!;
		// Until the load lands, the visible frame is untouched.
		expect( win.iframe ).toBe( original );
		expect( original.isConnected ).toBe( true );

		buffer.dispatchEvent( new Event( 'load' ) );

		// Instant cut — same tick, no animation.
		expect( original.isConnected ).toBe( false );
		expect( win.iframe ).toBe( buffer );
		expect(
			buffer.classList.contains(
				'os-window__iframe--buffer',
			),
		).toBe( false );
		expect( buffer.hasAttribute( 'aria-hidden' ) ).toBe( false );
		expect( buffer.getAttribute( 'name' ) ).toBe(
			'os-frame-sw2',
		);
		expect( buffer.src ).toContain( 'fresh=1' );
		// Same-origin gate rode along, like navigateTo.
		expect( buffer.src ).toContain( 'openstation_chromeless=1' );
	} );

	test( 'a newer swap supersedes an in-flight buffer; its late load is inert', async () => {
		const win = await manager.open( openConfig( 'sw3' ) );
		const body = win.element.querySelector( '.os-window__body' )!;
		const original = win.iframe!;

		win.swapReload( '/wp-admin/a.php?v=1' );
		const first = body.querySelector< HTMLIFrameElement >(
			BUFFER_SELECTOR,
		)!;
		win.swapReload( '/wp-admin/a.php?v=2' );

		// Only the newest buffer remains in the DOM.
		const buffers = body.querySelectorAll( BUFFER_SELECTOR );
		expect( buffers ).toHaveLength( 1 );
		expect( first.isConnected ).toBe( false );

		// A late load on the superseded (detached) buffer changes nothing.
		first.dispatchEvent( new Event( 'load' ) );
		expect( win.iframe ).toBe( original );

		// The live buffer still completes normally.
		const second = body.querySelector< HTMLIFrameElement >(
			BUFFER_SELECTOR,
		)!;
		second.dispatchEvent( new Event( 'load' ) );
		expect( win.iframe ).toBe( second );
		expect( second.src ).toContain( 'v=2' );
	} );

	test( 'a later classic reload() still clears the overlay after a swap', async () => {
		const win = await manager.open( openConfig( 'sw4' ) );
		const body = win.element.querySelector( '.os-window__body' )!;
		// Settle the initial load state first.
		win.iframe!.dispatchEvent( new Event( 'load' ) );

		win.swapReload();
		const buffer = body.querySelector< HTMLIFrameElement >(
			BUFFER_SELECTOR,
		)!;
		buffer.dispatchEvent( new Event( 'load' ) );
		expect( win.iframe ).toBe( buffer );

		// Classic reload arms the overlay; the swapped-in frame's
		// re-wired load handler must clear it.
		//
		// jsdom has no navigation, so the real `location.reload()`
		// logs "Not implemented" to the virtual console instead of
		// throwing (so `reload()`'s own catch never runs, and the
		// noise lands in CI logs). jsdom's `Location` rejects
		// spies, so stub `contentWindow` on the element — the swap
		// has already completed here, so nothing else reads it.
		Object.defineProperty( buffer, 'contentWindow', {
			configurable: true,
			value: { location: { reload: vi.fn() }, scrollX: 0, scrollY: 0 },
		} );
		win.reload();
		expect(
			body.classList.contains( 'os-window__body--loading' ),
		).toBe( true );
		buffer.dispatchEvent( new Event( 'load' ) );
		expect(
			body.classList.contains( 'os-window__body--loading' ),
		).toBe( false );
	} );

	test( 'fires WINDOW_RELOADED with silent: true on completion', async () => {
		const win = await manager.open( openConfig( 'sw5' ) );
		const body = win.element.querySelector( '.os-window__body' )!;
		const log = recordActions( hooks, [ HOOKS.WINDOW_RELOADED ] );

		win.swapReload( '/wp-admin/a.php?v=3' );
		expect( log ).toHaveLength( 0 ); // Not before the load lands.

		body.querySelector< HTMLIFrameElement >( BUFFER_SELECTOR )!
			.dispatchEvent( new Event( 'load' ) );

		expect( log ).toHaveLength( 1 );
		expect( log[ 0 ].args[ 0 ] ).toMatchObject( {
			windowId: 'sw5',
			silent: true,
		} );
	} );

	test( 'a cross-origin URL is rejected — no buffer created', async () => {
		const win = await manager.open( openConfig( 'sw6' ) );
		const body = win.element.querySelector( '.os-window__body' )!;

		win.swapReload( 'https://evil.example/?p=1' );

		expect( body.querySelector( BUFFER_SELECTOR ) ).toBeNull();
	} );

	test( 'a pointerdown inside a bridge-less iframe document focuses the window', async () => {
		// A FRONT-END url — the forwarder deliberately skips admin
		// documents (the chromeless bridge escalates focus there).
		const winA = await manager.open( {
			id: 'sw7',
			url: '/hello-world/?preview=true',
			title: 'Preview',
			icon: 'dashicons-visibility',
		} );
		// jsdom never fires iframe load on its own; in real browsers
		// this is where the forwarder attaches to the loaded document.
		winA.iframe!.dispatchEvent( new Event( 'load' ) );

		const winB = await manager.open( openConfig( 'sw8' ) );
		expect( manager.getFocused() ).toBe( winB );

		winA.iframe!.contentDocument!.dispatchEvent(
			new Event( 'pointerdown', { bubbles: true } ),
		);

		expect( manager.getFocused() ).toBe( winA );
	} );

	test( 'the submenu tab highlight survives a swap to a sibling URL', async () => {
		const win = await manager.open( {
			id: 'sw11',
			url: '/wp-admin/edit.php',
			title: 'Posts',
			icon: 'dashicons-admin-post',
			submenu: [
				{ title: 'All Posts', url: '/wp-admin/edit.php' },
				{ title: 'Add New', url: '/wp-admin/post-new.php' },
			],
		} );
		const body = win.element.querySelector( '.os-window__body' )!;
		const tabs = win.element.querySelectorAll< HTMLElement >(
			'.os-window__tab[data-kind="submenu"]',
		);
		expect(
			tabs[ 0 ].classList.contains( 'os-window__tab--active' ),
		).toBe( true );

		win.swapReload( '/wp-admin/post-new.php' );
		body.querySelector< HTMLIFrameElement >( BUFFER_SELECTOR )!
			.dispatchEvent( new Event( 'load' ) );

		// The promoted twin shows post-new.php — the tab highlight
		// must follow (the sync wiring is re-attached, not lost with
		// the old frame).
		expect(
			tabs[ 1 ].classList.contains( 'os-window__tab--active' ),
		).toBe( true );
		expect(
			tabs[ 0 ].classList.contains( 'os-window__tab--active' ),
		).toBe( false );
	} );

	test( 'the focus forwarder survives a swap', async () => {
		const winA = await manager.open( {
			id: 'sw9',
			url: '/hello-world/?preview=true',
			title: 'Preview',
			icon: 'dashicons-visibility',
		} );
		const body = winA.element.querySelector(
			'.os-window__body',
		)!;

		winA.swapReload( '/hello-world/?preview=true&fresh=1' );
		body.querySelector< HTMLIFrameElement >( BUFFER_SELECTOR )!
			.dispatchEvent( new Event( 'load' ) );

		const winB = await manager.open( openConfig( 'sw10' ) );
		expect( manager.getFocused() ).toBe( winB );

		winA.iframe!.contentDocument!.dispatchEvent(
			new Event( 'pointerdown', { bubbles: true } ),
		);

		expect( manager.getFocused() ).toBe( winA );
	} );
} );
