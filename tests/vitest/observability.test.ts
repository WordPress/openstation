/**
 * Observability additions — tests for the four hook additions + the
 * widget ctx.storage + ensureMounted helper:
 *
 *   - `ctx.storage` namespaced localStorage wrapper.
 *   - `WidgetLayer.ensureMounted( id )` idempotent public entry.
 *   - `HOOKS.IFRAME_ERROR` fired when the bridge relays
 *     `os-iframe-error`.
 *   - `HOOKS.IFRAME_NETWORK_COMPLETED` fired when the bridge relays
 *     `os-iframe-network`.
 *   - `HOOKS.SHELL_ERROR` fired alongside the widget / wallpaper mount
 *     failure paths.
 *   - `MonitorEntry` filter round-trip — plugins can mutate / drop
 *     entries via `os.monitor.entry`.
 *
 * Exercises real classes (`WidgetLayer`, `handleWindowMessage`,
 * `WindowManager`) against jsdom + the hook-bus stub.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createWidgetStorage } from '../../src/widgets/storage';
import { HOOKS, applyFilters } from '../../src/hooks';
import { handleWindowMessage } from '../../src/window/iframe-bridge';
import type { Window as DesktopWindow } from '../../src/window';
import type { MonitorEntry } from '../../src/types';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

describe( 'createWidgetStorage', () => {
	beforeEach( () => {
		installHooksStub();
		localStorage.clear();
	} );
	afterEach( () => {
		clearHooksStub();
		localStorage.clear();
	} );

	test( 'round-trips JSON-serializable values under a namespaced key', () => {
		const storage = createWidgetStorage( 'jorvy/quote' );
		storage.set( 'count', 7 );
		storage.set( 'last', { quote: 'I am Iron Man', ts: 1 } );

		expect( storage.get< number >( 'count' ) ).toBe( 7 );
		expect( storage.get< { quote: string; ts: number } >( 'last' ) ).toEqual( {
			quote: 'I am Iron Man',
			ts: 1,
		} );

		// Keys must be namespaced so a sibling widget can't read them
		// through a coincidentally-matching name.
		expect( localStorage.getItem( 'os.widget.jorvy/quote.count' ) ).toBe( '7' );
		expect( localStorage.getItem( 'count' ) ).toBeNull();
	} );

	test( 'get returns null for missing / malformed values', () => {
		const storage = createWidgetStorage( 'x' );
		expect( storage.get( 'unknown' ) ).toBeNull();

		// Raw write outside the wrapper simulates a malformed entry;
		// get should swallow the parse error and return null.
		localStorage.setItem( 'os.widget.x.bad', '{not json' );
		expect( storage.get( 'bad' ) ).toBeNull();
	} );

	test( 'clear removes only this widget\'s keys', () => {
		const a = createWidgetStorage( 'a' );
		const b = createWidgetStorage( 'b' );
		a.set( 'k', 1 );
		b.set( 'k', 2 );
		localStorage.setItem( 'some-other-key', 'untouched' );

		a.clear();

		expect( a.get( 'k' ) ).toBeNull();
		expect( b.get( 'k' ) ).toBe( 2 );
		expect( localStorage.getItem( 'some-other-key' ) ).toBe( 'untouched' );
	} );

	test( 'two widgets with overlapping keys do not collide', () => {
		const a = createWidgetStorage( 'a' );
		const b = createWidgetStorage( 'b' );
		a.set( 'layout', 'compact' );
		b.set( 'layout', 'wide' );
		expect( a.get( 'layout' ) ).toBe( 'compact' );
		expect( b.get( 'layout' ) ).toBe( 'wide' );
	} );
} );

/**
 * Build a minimal `Window` stand-in for `handleWindowMessage`. The
 * handler only reads `win.id` and `win.iframe.contentWindow`; we use
 * the same `contentWindow` object as the message event's `source` so
 * the origin/source filter passes.
 */
function makeFakeWindow( id: string ): {
	win: DesktopWindow;
	iframeWindow: WindowProxy;
} {
	const iframe = document.createElement( 'iframe' );
	document.body.appendChild( iframe );
	const contentWindow = ( iframe.contentWindow ?? window ) as WindowProxy;
	const win = {
		id,
		iframe,
		config: { id },
		element: document.createElement( 'div' ),
		onFocusRequest: null,
	} as unknown as DesktopWindow;
	return { win, iframeWindow: contentWindow };
}

describe( 'iframe bridge — IFRAME_ERROR routing', () => {
	let hooks: FakeWpHooks;

	beforeEach( () => {
		hooks = installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'routes os-iframe-error message to HOOKS.IFRAME_ERROR', () => {
		const { win, iframeWindow } = makeFakeWindow( 'posts' );
		const log = recordActions( hooks, [ HOOKS.IFRAME_ERROR ] );

		const event = new MessageEvent( 'message', {
			data: {
				type: 'os-iframe-error',
				kind: 'error',
				message: 'Uncaught TypeError: foo',
				filename: 'https://site/wp-admin/edit.php',
				lineno: 17,
				colno: 3,
				stack: 'at foo (x.js:1:1)',
			},
			origin: window.location.origin,
			source: iframeWindow,
		} );
		handleWindowMessage( win, event );

		expect( log ).toHaveLength( 1 );
		const payload = log[ 0 ].args[ 0 ] as {
			windowId: string;
			kind: string;
			message: string;
			stack: string | null;
		};
		expect( payload.windowId ).toBe( 'posts' );
		expect( payload.kind ).toBe( 'error' );
		expect( payload.message ).toBe( 'Uncaught TypeError: foo' );
		expect( payload.stack ).toBe( 'at foo (x.js:1:1)' );
	} );

	test( 'unhandledrejection kind is preserved; unknown kinds default to "error"', () => {
		const { win, iframeWindow } = makeFakeWindow( 'w' );
		const log = recordActions( hooks, [ HOOKS.IFRAME_ERROR ] );

		handleWindowMessage( win, new MessageEvent( 'message', {
			data: {
				type: 'os-iframe-error',
				kind: 'unhandledrejection',
				message: 'boom',
			},
			origin: window.location.origin,
			source: iframeWindow,
		} ) );

		handleWindowMessage( win, new MessageEvent( 'message', {
			data: {
				type: 'os-iframe-error',
				kind: 'wat',
				message: 'also boom',
			},
			origin: window.location.origin,
			source: iframeWindow,
		} ) );

		expect(
			( log[ 0 ].args[ 0 ] as { kind: string } ).kind,
		).toBe( 'unhandledrejection' );
		expect(
			( log[ 1 ].args[ 0 ] as { kind: string } ).kind,
		).toBe( 'error' );
	} );

	test( 'origin mismatch drops the message silently', () => {
		const { win, iframeWindow } = makeFakeWindow( 'w' );
		const log = recordActions( hooks, [ HOOKS.IFRAME_ERROR ] );

		handleWindowMessage( win, new MessageEvent( 'message', {
			data: {
				type: 'os-iframe-error',
				kind: 'error',
				message: 'x',
			},
			origin: 'https://evil.example',
			source: iframeWindow,
		} ) );

		expect( log ).toHaveLength( 0 );
	} );
} );

describe( 'iframe bridge — IFRAME_NETWORK_COMPLETED routing', () => {
	let hooks: FakeWpHooks;

	beforeEach( () => {
		hooks = installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'routes os-iframe-network message with status + duration', () => {
		const { win, iframeWindow } = makeFakeWindow( 'edit' );
		const log = recordActions( hooks, [ HOOKS.IFRAME_NETWORK_COMPLETED ] );

		handleWindowMessage( win, new MessageEvent( 'message', {
			data: {
				type: 'os-iframe-network',
				method: 'POST',
				url: '/wp-admin/admin-ajax.php',
				status: 500,
				duration: 42,
				failed: true,
			},
			origin: window.location.origin,
			source: iframeWindow,
		} ) );

		expect( log ).toHaveLength( 1 );
		const payload = log[ 0 ].args[ 0 ] as {
			windowId: string;
			method: string;
			url: string;
			status: number;
			duration: number;
			failed: boolean;
		};
		expect( payload.windowId ).toBe( 'edit' );
		expect( payload.method ).toBe( 'POST' );
		expect( payload.url ).toBe( '/wp-admin/admin-ajax.php' );
		expect( payload.status ).toBe( 500 );
		expect( payload.failed ).toBe( true );
	} );

	test( 'network failures (status 0) relay with failed: true', () => {
		const { win, iframeWindow } = makeFakeWindow( 'w' );
		const log = recordActions( hooks, [ HOOKS.IFRAME_NETWORK_COMPLETED ] );

		handleWindowMessage( win, new MessageEvent( 'message', {
			data: {
				type: 'os-iframe-network',
				method: 'GET',
				url: '/wp-json/wp/v2/posts',
				status: 0,
				duration: 1000,
				failed: true,
			},
			origin: window.location.origin,
			source: iframeWindow,
		} ) );

		const payload = log[ 0 ].args[ 0 ] as { status: number; failed: boolean };
		expect( payload.status ).toBe( 0 );
		expect( payload.failed ).toBe( true );
	} );
} );

describe( 'MonitorEntry + os.monitor.entry filter', () => {
	let hooks: FakeWpHooks;

	beforeEach( () => {
		hooks = installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'filter can mutate the message + add extra fields', () => {
		hooks.addFilter(
			HOOKS.MONITOR_ENTRY,
			'test/augment',
			( entry: unknown ) => {
				const e = entry as MonitorEntry;
				return {
					...e,
					message: `[tagged] ${ e.message }`,
					extra: { ...( e.extra || {} ), tagged: true },
				};
			},
		);

		const seed: MonitorEntry = {
			ts: 1000,
			type: 'error',
			message: 'Gutenberg save failed',
		};
		const result = applyFilters(
			HOOKS.MONITOR_ENTRY,
			seed,
		) as MonitorEntry;

		expect( result.message ).toBe( '[tagged] Gutenberg save failed' );
		expect( result.extra?.tagged ).toBe( true );
	} );

	test( 'filter can suppress an entry by returning null', () => {
		hooks.addFilter(
			HOOKS.MONITOR_ENTRY,
			'test/drop',
			() => null,
		);

		const seed: MonitorEntry = { ts: 0, type: 'log', message: 'noisy' };
		const result = applyFilters( HOOKS.MONITOR_ENTRY, seed );
		expect( result ).toBeNull();
	} );
} );

describe( 'SHELL_ERROR action fires alongside mount failures', () => {
	let hooks: FakeWpHooks;

	beforeEach( () => {
		hooks = installHooksStub();
		// Silence the console.error that accompanies a mount failure
		// so the test output stays tidy.
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
	} );
	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'widget mount throw fires widget.mount-failed AND shell.error', async () => {
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		const { register, unregister } = await import( '../../src/widgets/registry' );
		unregister( 'boom' );
		unregister( 'ok' );
		register( {
			id: 'boom',
			label: 'Boom',
			description: 'Throws on mount',
			icon: 'dashicons-warning',
			mount: () => {
				throw new Error( 'intentional' );
			},
		} );

		const log = recordActions( hooks, [
			HOOKS.WIDGET_MOUNT_FAILED,
			HOOKS.SHELL_ERROR,
		] );

		const host = document.createElement( 'div' );
		host.id = 'desktop-mode-widgets';
		document.body.appendChild( host );
		const layer = new WidgetLayer( host, '' );
		layer.ensureMounted( 'boom' );

		expect( log.map( ( l ) => l.name ) ).toContain( HOOKS.WIDGET_MOUNT_FAILED );
		expect( log.map( ( l ) => l.name ) ).toContain( HOOKS.SHELL_ERROR );

		const shellErr = log.find( ( l ) => l.name === HOOKS.SHELL_ERROR );
		const p = shellErr!.args[ 0 ] as { scope: string; id: string; error: Error };
		expect( p.scope ).toBe( 'widget-mount' );
		expect( p.id ).toBe( 'boom' );
		expect( p.error ).toBeInstanceOf( Error );
		expect( p.error.message ).toBe( 'intentional' );

		host.remove();
		unregister( 'boom' );
	} );
} );

describe( 'widget chrome — drag threshold', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'a pointerdown + release without crossing threshold does NOT liberate', async () => {
		const { buildFrame } = await import( '../../src/widgets/frame' );

		const parent = document.createElement( 'div' );
		parent.style.position = 'relative';
		Object.defineProperty( parent, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0, top: 0, right: 1200, bottom: 800,
					width: 1200, height: 800, x: 0, y: 0, toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		Object.defineProperty( parent, 'clientWidth', { value: 1200, configurable: true } );
		Object.defineProperty( parent, 'clientHeight', { value: 800, configurable: true } );
		document.body.appendChild( parent );

		let liberateCount = 0;
		const frame = buildFrame(
			{
				id: 'test',
				label: 'Test',
				description: 'x',
				icon: 'dashicons-admin-generic',
				movable: true,
				mount: () => () => undefined,
			},
			{ floatingParent: parent, geometry: undefined },
			{
				onRemove: () => undefined,
				onGeometryChanged: () => undefined,
				onLiberate: () => {
					liberateCount++;
				},
				onRedock: () => undefined,
			},
		);
		// Place card somewhere with a non-zero rect so the liberate
		// math would have a real anchor if it fired.
		document.body.appendChild( frame.card );
		Object.defineProperty( frame.card, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 100, top: 100, right: 420, bottom: 260,
					width: 320, height: 160, x: 100, y: 100, toJSON: () => ( {} ),
				} ) as DOMRect,
		} );

		const chrome = frame.card.querySelector< HTMLElement >(
			'.os-widgets__chrome',
		);
		expect( chrome ).not.toBeNull();

		// Stub pointer capture — jsdom lacks it on arbitrary elements.
		Object.defineProperty( chrome!, 'setPointerCapture', { value: () => undefined } );
		Object.defineProperty( chrome!, 'releasePointerCapture', { value: () => undefined } );

		function pointerEvent( type: string, clientX: number, clientY: number ): PointerEvent {
			const e = new Event( type, { bubbles: true } );
			Object.defineProperty( e, 'pointerId', { value: 1 } );
			Object.defineProperty( e, 'button', { value: 0 } );
			Object.defineProperty( e, 'clientX', { value: clientX } );
			Object.defineProperty( e, 'clientY', { value: clientY } );
			Object.defineProperty( e, 'target', { value: chrome } );
			return e as unknown as PointerEvent;
		}

		chrome!.dispatchEvent( pointerEvent( 'pointerdown', 200, 200 ) );
		// Move 3px — under the 5px threshold.
		chrome!.dispatchEvent( pointerEvent( 'pointermove', 203, 200 ) );
		chrome!.dispatchEvent( pointerEvent( 'pointerup', 203, 200 ) );

		expect( liberateCount ).toBe( 0 );
		expect(
			frame.card.classList.contains( 'os-widgets__card--floating' ),
		).toBe( false );
		expect(
			frame.card.classList.contains( 'os-widgets__card--dragging' ),
		).toBe( false );

		frame.dispose();
		parent.remove();
	} );

	test( 'moving past the threshold commits liberate + drag', async () => {
		const { buildFrame } = await import( '../../src/widgets/frame' );

		const parent = document.createElement( 'div' );
		Object.defineProperty( parent, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0, top: 0, right: 1200, bottom: 800,
					width: 1200, height: 800, x: 0, y: 0, toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		Object.defineProperty( parent, 'clientWidth', { value: 1200, configurable: true } );
		Object.defineProperty( parent, 'clientHeight', { value: 800, configurable: true } );
		document.body.appendChild( parent );

		let liberateCount = 0;
		const frame = buildFrame(
			{
				id: 'test2',
				label: 'Test 2',
				description: 'x',
				icon: 'dashicons-admin-generic',
				movable: true,
				mount: () => () => undefined,
			},
			{ floatingParent: parent, geometry: undefined },
			{
				onRemove: () => undefined,
				onGeometryChanged: () => undefined,
				onLiberate: () => {
					liberateCount++;
				},
				onRedock: () => undefined,
			},
		);
		document.body.appendChild( frame.card );
		Object.defineProperty( frame.card, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 100, top: 100, right: 420, bottom: 260,
					width: 320, height: 160, x: 100, y: 100, toJSON: () => ( {} ),
				} ) as DOMRect,
		} );

		const chrome = frame.card.querySelector< HTMLElement >(
			'.os-widgets__chrome',
		);
		Object.defineProperty( chrome!, 'setPointerCapture', { value: () => undefined } );
		Object.defineProperty( chrome!, 'releasePointerCapture', { value: () => undefined } );

		function pointerEvent( type: string, clientX: number, clientY: number ): PointerEvent {
			const e = new Event( type, { bubbles: true } );
			Object.defineProperty( e, 'pointerId', { value: 1 } );
			Object.defineProperty( e, 'button', { value: 0 } );
			Object.defineProperty( e, 'clientX', { value: clientX } );
			Object.defineProperty( e, 'clientY', { value: clientY } );
			Object.defineProperty( e, 'target', { value: chrome } );
			return e as unknown as PointerEvent;
		}

		chrome!.dispatchEvent( pointerEvent( 'pointerdown', 200, 200 ) );
		// Cross the 5 px threshold.
		chrome!.dispatchEvent( pointerEvent( 'pointermove', 210, 200 ) );

		expect( liberateCount ).toBe( 1 );
		expect(
			frame.card.classList.contains( 'os-widgets__card--floating' ),
		).toBe( true );
		expect(
			frame.card.classList.contains( 'os-widgets__card--dragging' ),
		).toBe( true );

		chrome!.dispatchEvent( pointerEvent( 'pointerup', 210, 200 ) );
		expect(
			frame.card.classList.contains( 'os-widgets__card--dragging' ),
		).toBe( false );

		frame.dispose();
		parent.remove();
	} );
} );

describe( 'Dock.appendSystemItem placement', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'vertical and horizontal Docks both accept system items', async () => {
		const { Dock } = await import( '../../src/dock' );
		const manager = {
			getFocused: () => null,
			getAllByBaseId: () => [],
		getAll: () => [],
			getById: () => undefined,
			getActiveDesktopId: () => 'default-1',
		} as unknown as ConstructorParameters< typeof Dock >[ 1 ];

		const dockEl = document.createElement( 'nav' );
		const taskbarEl = document.createElement( 'nav' );
		document.body.appendChild( dockEl );
		document.body.appendChild( taskbarEl );

		const dock = new Dock( dockEl, manager, [], 'http://x/wp-admin/', 'left' );
		const taskbar = new Dock( taskbarEl, manager, [], 'http://x/wp-admin/', 'bottom' );

		dock.appendSystemItem( {
			id: 'os-settings',
			title: 'OS Settings',
			icon: 'dashicons-admin-generic',
			onOpen: () => undefined,
		} );
		taskbar.appendSystemItem( {
			id: 'jorvy',
			title: 'Jorvy',
			icon: 'dashicons-star-filled',
			onOpen: () => undefined,
		} );

		const dockSys = dockEl.querySelector( '[data-system-id="os-settings"]' );
		const taskSys = taskbarEl.querySelector( '[data-system-id="jorvy"]' );
		expect( dockSys ).not.toBeNull();
		expect( taskSys ).not.toBeNull();

		// Separator renders on BOTH rails when a system item arrives.
		expect( dockEl.querySelector( '.os-dock__separator' ) ).not.toBeNull();
		expect( taskbarEl.querySelector( '.os-dock__separator' ) ).not.toBeNull();
	} );
} );

describe( 'WidgetLayer.ensureMounted', () => {
	beforeEach( () => {
		installHooksStub();
		localStorage.clear();
	} );
	afterEach( () => {
		clearHooksStub();
		localStorage.clear();
		document.body.innerHTML = '';
	} );

	test( 'returns false for an unregistered id', async () => {
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		const host = document.createElement( 'div' );
		host.id = 'desktop-mode-widgets';
		document.body.appendChild( host );
		const layer = new WidgetLayer( host, '' );
		expect( layer.ensureMounted( 'really-not-a-widget-id-xyz' ) ).toBe( false );
	} );

	test( 'adds the widget when not already enabled; idempotent when already on', async () => {
		const { WidgetLayer } = await import( '../../src/widgets/layer' );
		const { register, unregister } = await import( '../../src/widgets/registry' );
		unregister( 'boom' );
		unregister( 'ok' );
		register( {
			id: 'ok',
			label: 'OK',
			description: 'noop',
			icon: 'dashicons-yes',
			mount: () => () => undefined,
		} );

		const host = document.createElement( 'div' );
		host.id = 'desktop-mode-widgets';
		document.body.appendChild( host );
		const layer = new WidgetLayer( host, '' );

		expect( layer.getEnabledIds() ).not.toContain( 'ok' );
		expect( layer.ensureMounted( 'ok' ) ).toBe( true );
		expect( layer.getEnabledIds() ).toContain( 'ok' );

		// Second call — already enabled, should still return true,
		// not duplicate the entry.
		expect( layer.ensureMounted( 'ok' ) ).toBe( true );
		const count = layer.getEnabledIds().filter( ( id ) => id === 'ok' ).length;
		expect( count ).toBe( 1 );

		unregister( 'ok' );
	} );
} );
