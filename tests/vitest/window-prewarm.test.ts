import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import {
	installWindowLoadingTransitions,
	_resetWindowLoadingTransitionsForTests,
} from '../../src/window/loading';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';

function openConfig( id: string, url?: string ) {
	return {
		id,
		url: url ?? `/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

describe( 'WindowManager.prewarm', () => {
	let hooks: FakeWpHooks;
	let desktopArea: HTMLElement;
	let manager: WindowManager;
	let openedEvents: string[];
	let closedEvents: string[];
	const onOpened = ( e: Event ) =>
		openedEvents.push( ( e as CustomEvent ).detail.windowId );
	const onClosed = ( e: Event ) =>
		closedEvents.push( ( e as CustomEvent ).detail.windowId );

	beforeEach( () => {
		hooks = installHooksStub();
		void hooks;
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
		openedEvents = [];
		closedEvents = [];
		document.addEventListener( 'os-window-opened', onOpened );
		document.addEventListener( 'os-window-closed', onClosed );
	} );

	afterEach( () => {
		document.removeEventListener( 'os-window-opened', onOpened );
		document.removeEventListener( 'os-window-closed', onClosed );
		manager.destroy();
		clearHooksStub();
		vi.restoreAllMocks();
		vi.useRealTimers();
		document.body.innerHTML = '';
	} );

	test( 'mounts hidden, outside the stack, announcing nothing', async () => {
		const started = await manager.prewarm( openConfig( 'edit-php' ) );

		expect( started ).toBe( true );
		expect( manager.getAll() ).toHaveLength( 0 );
		const el = desktopArea.querySelector( '#wp-window-edit-php' ) as HTMLElement;
		expect( el ).not.toBeNull();
		expect( el.style.display ).toBe( 'none' );
		expect( el.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		expect( openedEvents ).toHaveLength( 0 );
	} );

	test( 'open() adopts the prewarmed window and announces it then', async () => {
		await manager.prewarm( openConfig( 'edit-php' ) );
		const preEl = desktopArea.querySelector( '#wp-window-edit-php' );

		const win = await manager.open( openConfig( 'edit-php' ) );

		expect( win.element ).toBe( preEl );
		expect( win.element.style.display ).toBe( '' );
		expect( win.element.hasAttribute( 'aria-hidden' ) ).toBe( false );
		expect( manager.getAll() ).toHaveLength( 1 );
		expect( manager.getFocused() ).toBe( win );
		expect( openedEvents ).toEqual( [ 'edit-php' ] );

		expect(
			desktopArea.querySelectorAll( '.os-window' ),
		).toHaveLength( 1 );
	} );

	test( 'openNew() adopts it too — that is the dock click path', async () => {
		await manager.prewarm( openConfig( 'edit-php' ) );
		const preEl = desktopArea.querySelector( '#wp-window-edit-php' );

		const win = await manager.openNew( openConfig( 'edit-php' ) );

		expect( win.element ).toBe( preEl );
		expect( manager.getAll() ).toHaveLength( 1 );
		expect( openedEvents ).toEqual( [ 'edit-php' ] );
	} );

	test( 'a different URL under the same baseId discards and builds fresh', async () => {
		await manager.prewarm( openConfig( 'edit-php' ) );
		const preEl = desktopArea.querySelector( '#wp-window-edit-php' );

		const win = await manager.open(
			openConfig( 'edit-php', '/wp-admin/edit.php?post_type=page' ),
		);

		expect( win.element ).not.toBe( preEl );
		expect( preEl!.isConnected ).toBe( false );
		expect( manager.getAll() ).toHaveLength( 1 );
		expect( closedEvents ).toHaveLength( 0 );
	} );

	test( 'discardPrewarmed removes the element without announcing a close', async () => {
		await manager.prewarm( openConfig( 'edit-php' ) );
		manager.discardPrewarmed();

		expect( desktopArea.querySelector( '#wp-window-edit-php' ) ).toBeNull();
		expect( closedEvents ).toHaveLength( 0 );

		expect( await manager.prewarm( openConfig( 'edit-php' ) ) ).toBe( true );
	} );

	test( 'refuses to warm a page that is already open', async () => {
		await manager.open( openConfig( 'edit-php' ) );
		expect( await manager.prewarm( openConfig( 'edit-php' ) ) ).toBe(
			false,
		);
	} );

	test( 'single slot — a newer prediction evicts the older one', async () => {
		await manager.prewarm( openConfig( 'edit-php' ) );
		await manager.prewarm( openConfig( 'upload-php' ) );

		expect( desktopArea.querySelector( '#wp-window-edit-php' ) ).toBeNull();
		expect(
			desktopArea.querySelector( '#wp-window-upload-php' ),
		).not.toBeNull();
	} );

	test( 'a click landing mid-prewarm does not leave two windows on one id', async () => {

		const warming = manager.prewarm( openConfig( 'edit-php' ) );
		await manager.open( openConfig( 'edit-php' ) );
		const warmed = await warming;

		expect( warmed, 'the click won; the speculation is dropped' ).toBe(
			false,
		);
		expect(
			desktopArea.querySelectorAll( '#wp-window-edit-php' ),
		).toHaveLength( 1 );

		expect( openedEvents ).toEqual( [ 'edit-php' ] );
	} );

	test( 'discarding releases the connection bridge without announcing a close', async () => {

		const closed: string[] = [];
		(
			globalThis as unknown as {
				__openStationConnectionBridge?: unknown;
			}
		).__openStationConnectionBridge = {
			onWindowClosed: ( id: string ) => closed.push( id ),
		};

		await manager.prewarm( openConfig( 'edit-php' ) );
		manager.discardPrewarmed();

		expect( closed ).toEqual( [ 'edit-php' ] );
		expect( closedEvents, 'no close is announced' ).toEqual( [] );
		delete (
			globalThis as unknown as {
				__openStationConnectionBridge?: unknown;
			}
		).__openStationConnectionBridge;
	} );

	test( 'an unclaimed prewarm is reaped by the TTL', async () => {
		vi.useFakeTimers();
		await manager.prewarm( openConfig( 'edit-php' ) );
		expect(
			desktopArea.querySelector( '#wp-window-edit-php' ),
		).not.toBeNull();

		vi.advanceTimersByTime( 46_000 );

		expect( desktopArea.querySelector( '#wp-window-edit-php' ) ).toBeNull();
	} );
} );
