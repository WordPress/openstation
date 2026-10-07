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

		expect( win.iframe ).toBe( original );
		expect( original.isConnected ).toBe( true );
		expect(
			original.classList.contains(
				'os-window__iframe--swap-front',
			),
		).toBe( true );

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

		expect( win.iframe ).toBe( original );
		expect( original.isConnected ).toBe( true );

		buffer.dispatchEvent( new Event( 'load' ) );

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

		expect( buffer.src ).toContain( 'openstation_chromeless=1' );
	} );

	test( 'keeps the old page up until the twin has loaded its URL', async () => {

		const insert = Element.prototype.insertAdjacentElement;
		vi.spyOn( Element.prototype, 'insertAdjacentElement' ).mockImplementation(
			function ( this: Element, where: InsertPosition, el: Element ) {
				const inserted = insert.call( this, where, el );
				if ( el instanceof HTMLIFrameElement && ! el.getAttribute( 'src' ) ) {
					el.dispatchEvent( new Event( 'load' ) );
				}
				return inserted;
			},
		);
		const win = await manager.open( openConfig( 'sw-blank' ) );
		const original = win.iframe!;

		win.swapReload( '/wp-admin/a.php?v=2' );

		expect( win.iframe ).toBe( original );
		expect( original.isConnected ).toBe( true );
	} );

	test( 'a swap completing before the FIRST load clears the boot overlay', async () => {
		const win = await manager.open( openConfig( 'sw-early' ) );
		const body = win.element.querySelector( '.os-window__body' )!;

		expect(
			body.classList.contains( 'os-window__body--loading' ),
		).toBe( true );

		win.swapReload();
		const buffer = body.querySelector< HTMLIFrameElement >(
			BUFFER_SELECTOR,
		)!;
		buffer.dispatchEvent( new Event( 'load' ) );

		expect(
			body.classList.contains( 'os-window__body--loading' ),
		).toBe( false );
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

		const buffers = body.querySelectorAll( BUFFER_SELECTOR );
		expect( buffers ).toHaveLength( 1 );
		expect( first.isConnected ).toBe( false );

		first.dispatchEvent( new Event( 'load' ) );
		expect( win.iframe ).toBe( original );

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

		win.iframe!.dispatchEvent( new Event( 'load' ) );

		win.swapReload();
		const buffer = body.querySelector< HTMLIFrameElement >(
			BUFFER_SELECTOR,
		)!;
		buffer.dispatchEvent( new Event( 'load' ) );
		expect( win.iframe ).toBe( buffer );

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
		expect( log ).toHaveLength( 0 );

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

		const winA = await manager.open( {
			id: 'sw7',
			url: '/hello-world/?preview=true',
			title: 'Preview',
			icon: 'dashicons-visibility',
		} );

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
