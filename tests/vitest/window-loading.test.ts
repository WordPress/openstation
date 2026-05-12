/**
 * Loading-state lifecycle for windows — both the framework
 * primitives (`markWindowContentLoading` / `markWindowContentReady`,
 * `WINDOW_CONTENT_LOADING` / `WINDOW_CONTENT_LOADED` hooks +
 * matching CustomEvents) and the visual side (overlay element, body
 * `--loading` modifier, sync vs. Promise-returning native render).
 *
 * @since 0.6.0
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { HOOKS } from '../../src/hooks';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';
import {
	_resetWindowChannelsForTests,
	isWindowContentLoading,
	markWindowContentLoading,
	markWindowContentReady,
} from '../../src/window-channels';
import { createWindowElement } from '../../src/window/dom';
import {
	_resetWindowLoadingTransitionsForTests,
	installWindowLoadingTransitions,
	repaintLoadingOverlays,
} from '../../src/window/loading';

const tick = (): Promise< void > => Promise.resolve();
const raf = (): Promise< void > =>
	new Promise( ( r ) => requestAnimationFrame( () => r() ) );

function makeDesktop(): HTMLElement {
	const desktop = document.createElement( 'div' );
	Object.defineProperty( desktop, 'getBoundingClientRect', {
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
	Object.defineProperty( desktop, 'clientWidth', { value: 1600, configurable: true } );
	Object.defineProperty( desktop, 'clientHeight', { value: 900, configurable: true } );
	document.body.appendChild( desktop );
	return desktop;
}

describe( 'createWindowElement — loading overlay', async () => {
	beforeEach( async () => {
		installHooksStub();
	} );
	afterEach( async () => {
		clearHooksStub();
		_resetWindowChannelsForTests();
	} );

	test( 'iframe windows mount with the spinner overlay + loading modifier', async () => {
		const el = createWindowElement( {
			id: 'probe-iframe',
			url: '#probe-iframe',
			title: 'Probe',
			icon: 'dashicons-admin-post',
			x: 0,
			y: 0,
			width: 800,
			height: 600,
		} );
		const body = el.querySelector( '.desktop-mode-window__body' );
		expect( body ).not.toBeNull();
		expect( body!.classList.contains( 'desktop-mode-window__body--loading' ) ).toBe( true );
		const overlay = el.querySelector( '.desktop-mode-window__loading' );
		expect( overlay ).not.toBeNull();
		expect( overlay!.querySelector( 'wpd-spinner' ) ).not.toBeNull();
	} );

	test( 'native windows mount with the same overlay', async () => {
		const el = createWindowElement( {
			id: 'probe-native',
			title: 'Probe',
			icon: 'dashicons-admin-generic',
			native: true,
			render: () => undefined,
			x: 0,
			y: 0,
			width: 400,
			height: 320,
		} );
		const body = el.querySelector( '.desktop-mode-window__body' );
		expect( body ).not.toBeNull();
		expect( body!.classList.contains( 'desktop-mode-window__body--loading' ) ).toBe( true );
		expect( body!.classList.contains( 'desktop-mode-window__body--native' ) ).toBe( true );
		expect( el.querySelector( 'wpd-spinner' ) ).not.toBeNull();
	} );

	test( 'construction marks the window as loading', async () => {
		createWindowElement( {
			id: 'probe-loading',
			url: '#probe-loading',
			title: 'Probe',
			icon: 'dashicons-admin-post',
			x: 0,
			y: 0,
			width: 400,
			height: 320,
		} );
		expect( isWindowContentLoading( 'probe-loading' ) ).toBe( true );
	} );

	test( 'spinner uses the responsive size attribute', async () => {
		const el = createWindowElement( {
			id: 'probe-size',
			url: '#probe-size',
			title: 'Probe',
			icon: 'dashicons-admin-post',
			x: 0,
			y: 0,
			width: 400,
			height: 320,
		} );
		const spinner = el.querySelector( 'wpd-spinner' );
		expect( spinner!.getAttribute( 'size' ) ).toBe( 'clamp(96px, 14vw, 192px)' );
	} );
} );

describe( 'markWindowContentLoading / Ready — hook + CustomEvent firing', async () => {
	let hooks: FakeWpHooks;
	beforeEach( async () => {
		hooks = installHooksStub();
	} );
	afterEach( async () => {
		clearHooksStub();
		_resetWindowChannelsForTests();
	} );

	test( 'markWindowContentLoading fires WINDOW_CONTENT_LOADING action + CustomEvent', async () => {
		const seen: Array< { windowId: string } > = [];
		hooks.addAction(
			HOOKS.WINDOW_CONTENT_LOADING,
			'test',
			( ...args: unknown[] ) => {
				seen.push( args[ 0 ] as { windowId: string } );
			},
		);
		const eventSpy = vi.fn();
		document.addEventListener(
			'desktop-mode-window-content-loading',
			eventSpy as EventListener,
		);

		markWindowContentLoading( 'win-1' );

		expect( seen ).toEqual( [ { windowId: 'win-1' } ] );
		expect( eventSpy ).toHaveBeenCalledOnce();
		const detail = ( eventSpy.mock.calls[ 0 ][ 0 ] as CustomEvent ).detail;
		expect( detail ).toEqual( { windowId: 'win-1' } );

		document.removeEventListener(
			'desktop-mode-window-content-loading',
			eventSpy as EventListener,
		);
	} );

	test( 'markWindowContentLoading is edge-triggered — second call is a no-op', async () => {
		const seen: Array< { windowId: string } > = [];
		hooks.addAction(
			HOOKS.WINDOW_CONTENT_LOADING,
			'test',
			( ...args: unknown[] ) => {
				seen.push( args[ 0 ] as { windowId: string } );
			},
		);
		markWindowContentLoading( 'win-2' );
		markWindowContentLoading( 'win-2' );
		expect( seen ).toHaveLength( 1 );
	} );

	test( 'markWindowContentReady fires WINDOW_CONTENT_LOADED on loading → ready transition', async () => {
		const seen: Array< { windowId: string } > = [];
		hooks.addAction(
			HOOKS.WINDOW_CONTENT_LOADED,
			'test',
			( ...args: unknown[] ) => {
				seen.push( args[ 0 ] as { windowId: string } );
			},
		);
		const eventSpy = vi.fn();
		document.addEventListener(
			'desktop-mode-window-content-loaded',
			eventSpy as EventListener,
		);

		markWindowContentLoading( 'win-3' );
		markWindowContentReady( 'win-3' );

		expect( seen ).toEqual( [ { windowId: 'win-3' } ] );
		expect( eventSpy ).toHaveBeenCalledOnce();
		const detail = ( eventSpy.mock.calls[ 0 ][ 0 ] as CustomEvent ).detail;
		expect( detail ).toEqual( { windowId: 'win-3' } );

		document.removeEventListener(
			'desktop-mode-window-content-loaded',
			eventSpy as EventListener,
		);
	} );

	test( 'markWindowContentReady is a no-op when the window is not in loading state', async () => {
		const seen: Array< { windowId: string } > = [];
		hooks.addAction(
			HOOKS.WINDOW_CONTENT_LOADED,
			'test',
			( ...args: unknown[] ) => {
				seen.push( args[ 0 ] as { windowId: string } );
			},
		);
		// Never loaded — markReady from cold state should NOT fire
		// the loaded hook (no transition).
		markWindowContentReady( 'win-4' );
		expect( seen ).toEqual( [] );
	} );

	test( 'loading → ready → loading → ready fires LOADED twice', async () => {
		const seen: Array< { windowId: string } > = [];
		hooks.addAction(
			HOOKS.WINDOW_CONTENT_LOADED,
			'test',
			( ...args: unknown[] ) => {
				seen.push( args[ 0 ] as { windowId: string } );
			},
		);
		markWindowContentLoading( 'win-5' );
		markWindowContentReady( 'win-5' );
		markWindowContentLoading( 'win-5' );
		markWindowContentReady( 'win-5' );
		expect( seen ).toHaveLength( 2 );
	} );
} );

describe( 'installWindowLoadingTransitions — visual side', async () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		installHooksStub();
		desktop = makeDesktop();
		manager = new WindowManager( desktop );
		installWindowLoadingTransitions();
	} );
	afterEach( async () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
		_resetWindowChannelsForTests();
		_resetWindowLoadingTransitionsForTests();
		vi.useRealTimers();
	} );

	test( 'WINDOW_CONTENT_LOADED removes the body --loading modifier', async () => {
		await manager.open( {
			id: 'visual-1',
			url: '#visual-1',
			title: 'Visual 1',
		} );
		const body = document.querySelector(
			'#wp-window-visual-1 .desktop-mode-window__body',
		);
		expect( body!.classList.contains( 'desktop-mode-window__body--loading' ) ).toBe(
			true,
		);

		markWindowContentReady( 'visual-1' );

		expect( body!.classList.contains( 'desktop-mode-window__body--loading' ) ).toBe(
			false,
		);
	} );

	test( 'markContentLoading after ready re-arms the overlay + class', async () => {
		await manager.open( {
			id: 'visual-2',
			url: '#visual-2',
			title: 'Visual 2',
		} );
		markWindowContentReady( 'visual-2' );
		const body = document.querySelector(
			'#wp-window-visual-2 .desktop-mode-window__body',
		);
		expect( body!.classList.contains( 'desktop-mode-window__body--loading' ) ).toBe(
			false,
		);

		markWindowContentLoading( 'visual-2' );

		expect( body!.classList.contains( 'desktop-mode-window__body--loading' ) ).toBe(
			true,
		);
		// Overlay is still in the DOM at this moment — the
		// fade-out timer hasn't fired yet (default jsdom timing).
		// Either way, `ensureLoadingOverlay` paints a fresh one.
		const overlays = body!.querySelectorAll( '.desktop-mode-window__loading' );
		expect( overlays.length ).toBeGreaterThanOrEqual( 1 );
	} );
} );

describe( 'hydrateNative — sync render marks ready on next rAF', async () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		installHooksStub();
		desktop = makeDesktop();
		manager = new WindowManager( desktop );
		installWindowLoadingTransitions();
	} );
	afterEach( async () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
		_resetWindowChannelsForTests();
		_resetWindowLoadingTransitionsForTests();
	} );

	test( 'WINDOW_CONTENT_LOADED fires after one rAF for sync render', async () => {
		const seen: Array< { windowId: string } > = [];
		( window.wp!.hooks! ).addAction(
			HOOKS.WINDOW_CONTENT_LOADED,
			'test',
			( ...args: unknown[] ) => {
				seen.push( args[ 0 ] as { windowId: string } );
			},
		);

		await manager.open( {
			id: 'sync-render',
			url: '#sync-render',
			title: 'Sync',
			native: true,
			render: ( body ) => {
				body.textContent = 'rendered';
			},
		} );

		expect( seen ).toEqual( [] );
		await raf();

		expect( seen ).toEqual( [ { windowId: 'sync-render' } ] );
	} );
} );

describe( 'hydrateNative — Promise-returning render defers ready', async () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		installHooksStub();
		desktop = makeDesktop();
		manager = new WindowManager( desktop );
		installWindowLoadingTransitions();
	} );
	afterEach( async () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
		_resetWindowChannelsForTests();
		_resetWindowLoadingTransitionsForTests();
	} );

	test( 'WINDOW_CONTENT_LOADED waits for the Promise to resolve', async () => {
		const seen: Array< { windowId: string } > = [];
		( window.wp!.hooks! ).addAction(
			HOOKS.WINDOW_CONTENT_LOADED,
			'test',
			( ...args: unknown[] ) => {
				seen.push( args[ 0 ] as { windowId: string } );
			},
		);

		let resolveFetch!: () => void;
		const fakeFetch = new Promise< void >( ( r ) => {
			resolveFetch = r;
		} );

		await manager.open( {
			id: 'async-render',
			url: '#async-render',
			title: 'Async',
			native: true,
			render: async ( body ) => {
				await fakeFetch;
				body.textContent = 'data';
			},
		} );

		// rAF would fire markReady for sync renders — but a
		// Promise-returning render takes the await branch instead,
		// so the hook stays silent until the promise settles.
		await raf();
		expect( seen ).toEqual( [] );

		resolveFetch();
		// Microtask queue + the markReady inside the .then
		// handler. Two ticks is enough for the chain to settle.
		await tick();
		await tick();
		expect( seen ).toEqual( [ { windowId: 'async-render' } ] );
	} );

	test( 'WINDOW_CONTENT_LOADED still fires when the render Promise rejects', async () => {
		const seen: Array< { windowId: string } > = [];
		( window.wp!.hooks! ).addAction(
			HOOKS.WINDOW_CONTENT_LOADED,
			'test',
			( ...args: unknown[] ) => {
				seen.push( args[ 0 ] as { windowId: string } );
			},
		);
		// Silence the deliberate console.error from the Promise
		// rejection path so the test output stays clean.
		const errSpy = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		await manager.open( {
			id: 'reject-render',
			url: '#reject-render',
			title: 'Reject',
			native: true,
			render: async () => {
				throw new Error( 'simulated fetch failure' );
			},
		} );

		await tick();
		await tick();
		expect( seen ).toEqual( [ { windowId: 'reject-render' } ] );
		errSpy.mockRestore();
	} );
} );

describe( 'ctx.window.markLoading / markReady — plugin-driven toggling', async () => {
	// `ctx.window.markLoading/markReady` are only wired in the
	// `wp.desktop.registerWindow` path (createRegisterWindow). The
	// raw `manager.open` path tested above doesn't receive them —
	// plugins that want toggling there can call
	// `Window.markContentLoading()` / `Window.markContentLoaded()`
	// directly instead.
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		installHooksStub();
		desktop = makeDesktop();
		manager = new WindowManager( desktop );
		installWindowLoadingTransitions();
	} );
	afterEach( async () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
		_resetWindowChannelsForTests();
		_resetWindowLoadingTransitionsForTests();
	} );

	test( 'Window.markContentLoading + markContentLoaded toggle the loading state', async () => {
		const win = await manager.open( {
			id: 'toggle',
			url: '#toggle',
			title: 'Toggle',
			native: true,
			render: () => undefined,
		} );
		// Initial body class — every window starts in loading.
		const body = win.element.querySelector(
			'.desktop-mode-window__body',
		)!;
		expect( body.classList.contains( 'desktop-mode-window__body--loading' ) ).toBe(
			true,
		);

		// Manual fade-in.
		win.markContentLoaded();
		expect( body.classList.contains( 'desktop-mode-window__body--loading' ) ).toBe(
			false,
		);

		// Manual re-arm.
		win.markContentLoading();
		expect( body.classList.contains( 'desktop-mode-window__body--loading' ) ).toBe(
			true,
		);
	} );
} );

describe( 'Loading overlay customization', async () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		installHooksStub();
		desktop = makeDesktop();
		manager = new WindowManager( desktop );
		installWindowLoadingTransitions();
	} );
	afterEach( async () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
		_resetWindowChannelsForTests();
		_resetWindowLoadingTransitionsForTests();
	} );

	test( 'config.loading.render mutates the default overlay in-place', async () => {
		const win = await manager.open( {
			id: 'branded',
			url: '#branded',
			title: 'Branded',
			loading: {
				render: ( host ) => {
					const status = document.createElement( 'p' );
					status.className = 'my-loading-status';
					status.textContent = 'Fetching things…';
					host.appendChild( status );
				},
			},
		} );
		const overlay = win.element.querySelector(
			'.desktop-mode-window__loading',
		)!;
		expect( overlay.querySelector( 'wpd-spinner' ) ).not.toBeNull();
		expect( overlay.querySelector( '.my-loading-status' )!.textContent ).toBe(
			'Fetching things…',
		);
	} );

	test( 'config.loading.render can replace contents wholesale', async () => {
		const win = await manager.open( {
			id: 'replace',
			url: '#replace',
			title: 'Replace',
			loading: {
				render: ( host ) => {
					const customLoader = document.createElement( 'div' );
					customLoader.className = 'my-custom-loader';
					customLoader.textContent = 'BRAND LOADER';
					host.replaceChildren( customLoader );
				},
			},
		} );
		const overlay = win.element.querySelector(
			'.desktop-mode-window__loading',
		)!;
		expect( overlay.querySelector( 'wpd-spinner' ) ).toBeNull();
		expect( overlay.querySelector( '.my-custom-loader' )!.textContent ).toBe(
			'BRAND LOADER',
		);
	} );

	test( 'WINDOW_LOADING_OVERLAY filter receives the host + ctx', async () => {
		const seenCtx: Array< { windowId: string } > = [];
		( window.wp!.hooks! ).addFilter(
			HOOKS.WINDOW_LOADING_OVERLAY,
			'test/skin',
			( ...args: unknown[] ) => {
				const host = args[ 0 ] as HTMLElement;
				const ctx = args[ 1 ] as { windowId: string };
				seenCtx.push( { windowId: ctx.windowId } );
				host.dataset.skinned = 'true';
				return host;
			},
		);

		const win = await manager.open( {
			id: 'filtered',
			url: '#filtered',
			title: 'Filtered',
		} );

		expect( seenCtx ).toEqual( [ { windowId: 'filtered' } ] );
		const overlay = win.element.querySelector< HTMLElement >(
			'.desktop-mode-window__loading',
		)!;
		expect( overlay.dataset.skinned ).toBe( 'true' );
	} );

	test( 'WINDOW_LOADING_OVERLAY filter can replace the entire overlay element', async () => {
		( window.wp!.hooks! ).addFilter(
			HOOKS.WINDOW_LOADING_OVERLAY,
			'test/wholesale',
			() => {
				const replacement = document.createElement( 'div' );
				replacement.id = 'wholesale-replacement';
				replacement.textContent = 'CUSTOM';
				return replacement;
			},
		);

		const win = await manager.open( {
			id: 'wholesale',
			url: '#wholesale',
			title: 'Wholesale',
		} );

		const overlay = win.element.querySelector(
			'.desktop-mode-window__loading',
		);
		// Even when a filter returns a totally different element,
		// the framework re-adds the marker class so CSS positioning
		// + transition rules keep applying.
		expect( overlay ).not.toBeNull();
		expect( overlay!.id ).toBe( 'wholesale-replacement' );
		expect( overlay!.textContent ).toBe( 'CUSTOM' );
	} );

	test( 'config.loading.render runs BEFORE the global filter', async () => {
		const order: string[] = [];
		( window.wp!.hooks! ).addFilter(
			HOOKS.WINDOW_LOADING_OVERLAY,
			'test/order',
			( ...args: unknown[] ) => {
				order.push( 'filter' );
				return args[ 0 ] as HTMLElement;
			},
		);

		await manager.open( {
			id: 'order',
			url: '#order',
			title: 'Order',
			loading: {
				render: () => {
					order.push( 'inline' );
				},
			},
		} );

		expect( order ).toEqual( [ 'inline', 'filter' ] );
	} );

	test( 'a buggy config.loading.render is caught — overlay still paints', async () => {
		const errSpy = vi
			.spyOn( console, 'error' )
			.mockImplementation( () => undefined );

		const win = await manager.open( {
			id: 'bug-inline',
			url: '#bug-inline',
			title: 'Bug',
			loading: {
				render: () => {
					throw new Error( 'simulated buggy customizer' );
				},
			},
		} );

		const overlay = win.element.querySelector(
			'.desktop-mode-window__loading',
		);
		expect( overlay ).not.toBeNull();
		expect( overlay!.querySelector( 'wpd-spinner' ) ).not.toBeNull();
		errSpy.mockRestore();
	} );

	test( 'repaintLoadingOverlays() applies a late-registered filter to currently-loading windows', async () => {
		// First open the window WITHOUT a registered filter — the
		// overlay paints with default content.
		const win = await manager.open( {
			id: 'late-filter',
			url: '#late-filter',
			title: 'Late Filter',
		} );
		const overlay = () => win.element.querySelector< HTMLElement >(
			'.desktop-mode-window__loading',
		)!;
		expect( overlay().dataset.skinned ).toBeUndefined();

		// Plugin registers its filter post-construction.
		( window.wp!.hooks! ).addFilter(
			HOOKS.WINDOW_LOADING_OVERLAY,
			'late/skin',
			( ...args: unknown[] ) => {
				const host = args[ 0 ] as HTMLElement;
				host.dataset.skinned = 'late';
				return host;
			},
		);

		// Without repainting, the existing overlay still has the
		// pre-registration default. Sanity check.
		expect( overlay().dataset.skinned ).toBeUndefined();

		repaintLoadingOverlays();

		// After the explicit repaint, the late-registered filter
		// has applied to the still-loading window.
		expect( overlay().dataset.skinned ).toBe( 'late' );
	} );

	test( 'F5 boot-order race: HOOKS.INIT triggers an automatic sweep', async () => {
		// Construct the window first — simulates the F5 / session-
		// restore order where windows exist before plugins register
		// their filters.
		const win = await manager.open( {
			id: 'f5-restore',
			url: '#f5-restore',
			title: 'F5 Restore',
		} );

		// Plugin filter lands AFTER construction (typical
		// `wp.desktop.whenReady( () => addFilter(...) )` shape that
		// fires during HOOKS.INIT).
		( window.wp!.hooks! ).addFilter(
			HOOKS.WINDOW_LOADING_OVERLAY,
			'f5/skin',
			( ...args: unknown[] ) => {
				const host = args[ 0 ] as HTMLElement;
				host.dataset.skinned = 'f5';
				return host;
			},
		);

		// Fire HOOKS.INIT — the shell's post-init sweep is on a
		// `queueMicrotask`, so we wait one tick for it to drain.
		( window.wp!.hooks! ).doAction( HOOKS.INIT, { config: {} } );
		await Promise.resolve();

		const overlay = win.element.querySelector< HTMLElement >(
			'.desktop-mode-window__loading',
		)!;
		expect( overlay.dataset.skinned ).toBe( 'f5' );
	} );

	test( 'repaintLoadingOverlays() is a no-op for windows already loaded', async () => {
		const win = await manager.open( {
			id: 'already-loaded',
			url: '#already-loaded',
			title: 'Already Loaded',
		} );
		win.markContentLoaded();

		// No throw, no DOM thrash on a window that's no longer in
		// loading state.
		expect( () => repaintLoadingOverlays() ).not.toThrow();
	} );

	test( 'markContentLoading re-arm re-applies config.loading.render', async () => {
		let renderCalls = 0;
		const win = await manager.open( {
			id: 're-arm',
			url: '#re-arm',
			title: 'Re-arm',
			loading: {
				render: ( host ) => {
					renderCalls += 1;
					host.dataset.renderCount = String( renderCalls );
				},
			},
		} );

		expect( renderCalls ).toBe( 1 );

		// Mark ready, then loading again — overlay tears down + re-paints
		// via `ensureLoadingOverlay`, which must re-apply the same
		// customization path. (Note: in production the fade timer
		// removes the previous overlay; in tests we don't wait, so
		// `ensureLoadingOverlay` no-ops if an overlay is still present
		// — we simulate the after-fade state by manually removing.)
		win.markContentLoaded();
		win.element
			.querySelector( '.desktop-mode-window__loading' )
			?.remove();
		win.markContentLoading();

		expect( renderCalls ).toBe( 2 );
		const overlay = win.element.querySelector< HTMLElement >(
			'.desktop-mode-window__loading',
		)!;
		expect( overlay.dataset.renderCount ).toBe( '2' );
	} );
} );
