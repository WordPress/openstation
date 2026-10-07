import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { HOOKS, doAction } from '../../src/hooks';
import type { NativeRenderContext } from '../../src/types';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

describe( 'native-window render ctx', async () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
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
		manager = new WindowManager( desktop );
	} );

	afterEach( async () => {

		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'render receives a ctx as second arg with the documented shape', async () => {
		let captured: NativeRenderContext | null = null;
		await manager.open( {
			id: 'ctx-shape',
			url: '#ctx-shape',
			title: 'Shape',
			native: true,
			render: ( _body, ctx ) => {
				captured = ctx ?? null;
			},
		} );
		expect( captured ).not.toBeNull();
		const c = captured!;
		expect( typeof c.window.send ).toBe( 'function' );
		expect( typeof c.window.on ).toBe( 'function' );
		expect( typeof c.window.markLoading ).toBe( 'function' );
		expect( typeof c.window.markReady ).toBe( 'function' );
		expect( typeof c.markLoading ).toBe( 'function' );
		expect( typeof c.markReady ).toBe( 'function' );
		expect( typeof c.onResize ).toBe( 'function' );
		expect( typeof c.onHide ).toBe( 'function' );
		expect( typeof c.onShow ).toBe( 'function' );
		expect( c.signal ).toBeInstanceOf( AbortSignal );
		expect( c.signal.aborted ).toBe( false );
	} );

	test( 'legacy unary render still works (no ctx, no breakage)', async () => {
		let renderRan = false;
		await manager.open( {
			id: 'unary',
			url: '#unary',
			title: 'Unary',
			native: true,
			render: ( body ) => {
				renderRan = true;
				body.dataset.legacyRender = '1';
			},
		} );
		expect( renderRan ).toBe( true );
	} );

	test( 'ctx.signal aborts when the window closes', async () => {
		let signal: AbortSignal | null = null;
		const win = await manager.open( {
			id: 'signal-test',
			url: '#signal-test',
			title: 'Signal',
			native: true,
			render: ( _body, ctx ) => {
				signal = ctx!.signal;
			},
		} );
		expect( signal!.aborted ).toBe( false );
		win.close();
		expect( signal!.aborted ).toBe( true );
	} );

	test( 'ctx.onResize fires for matching windowId only, with body dimensions', async () => {
		const got: Array< { w: number; h: number } > = [];
		await manager.open( {
			id: 'resize-test',
			url: '#resize-test',
			title: 'Resize',
			native: true,
			render: ( _body, ctx ) => {
				ctx!.onResize( ( w, h ) => got.push( { w, h } ) );
			},
		} );

		doAction( HOOKS.WINDOW_BODY_RESIZED, {
			windowId: 'someone-else',
			width: 999,
			height: 999,
		} );
		expect( got.length ).toBe( 0 );

		doAction( HOOKS.WINDOW_BODY_RESIZED, {
			windowId: 'resize-test',
			width: 800,
			height: 600,
		} );
		expect( got ).toEqual( [ { w: 800, h: 600 } ] );
	} );

	test( 'ctx.onHide / ctx.onShow fire on the matching lifecycle hooks', async () => {
		let hideCount = 0;
		let showCount = 0;
		await manager.open( {
			id: 'hide-show',
			url: '#hide-show',
			title: 'Hide / Show',
			native: true,
			render: ( _body, ctx ) => {
				ctx!.onHide( () => hideCount++ );
				ctx!.onShow( () => showCount++ );
			},
		} );
		doAction( HOOKS.WINDOW_MINIMIZED, { windowId: 'hide-show' } );
		expect( hideCount ).toBe( 1 );
		expect( showCount ).toBe( 0 );

		doAction( HOOKS.WINDOW_RESTORED, { windowId: 'hide-show' } );
		expect( hideCount ).toBe( 1 );
		expect( showCount ).toBe( 1 );

		doAction( HOOKS.WINDOW_MINIMIZED, { windowId: 'somebody-else' } );
		expect( hideCount ).toBe( 1 );
	} );

	test( 'returned unsubscribe handle from ctx.onResize detaches the listener', async () => {
		const got: Array< number > = [];
		await manager.open( {
			id: 'unsub',
			url: '#unsub',
			title: 'Unsub',
			native: true,
			render: ( _body, ctx ) => {
				const off = ctx!.onResize( ( w ) => got.push( w ) );

				off();
			},
		} );
		doAction( HOOKS.WINDOW_BODY_RESIZED, {
			windowId: 'unsub',
			width: 800,
			height: 600,
		} );
		expect( got ).toEqual( [] );
	} );

	test( 'closing the window detaches ctx subscriptions even if user did not unsubscribe', async () => {
		let resizeFired = 0;
		const win = await manager.open( {
			id: 'auto-detach',
			url: '#auto-detach',
			title: 'Auto Detach',
			native: true,
			render: ( _body, ctx ) => {
				ctx!.onResize( () => resizeFired++ );
			},
		} );

		doAction( HOOKS.WINDOW_BODY_RESIZED, {
			windowId: 'auto-detach',
			width: 100,
			height: 100,
		} );
		expect( resizeFired ).toBe( 1 );

		win.close();

		doAction( HOOKS.WINDOW_BODY_RESIZED, {
			windowId: 'auto-detach',
			width: 200,
			height: 200,
		} );
		expect( resizeFired ).toBe( 1 );
	} );

	test( 'destroy() runs cleanup synchronously, idempotent, cancels pending finalize', async () => {
		const teardownCalls: string[] = [];
		let signal: AbortSignal | null = null;
		const win = await manager.open( {
			id: 'destroy-sync',
			url: '#destroy-sync',
			title: 'Destroy Sync',
			native: true,
			render: ( _body, ctx ) => {
				signal = ctx!.signal;
				return () => teardownCalls.push( 'user-teardown' );
			},
		} );
		expect( signal!.aborted ).toBe( false );

		win.destroy();

		expect( signal!.aborted ).toBe( true );
		expect( teardownCalls ).toEqual( [ 'user-teardown' ] );

		expect( win.element.isConnected ).toBe( false );

		win.destroy();
		expect( teardownCalls ).toEqual( [ 'user-teardown' ] );
	} );

	test( 'destroy() after close() cancels the pending safety-net timer + finalize timing race', async () => {
		const teardownCalls: string[] = [];
		const win = await manager.open( {
			id: 'destroy-after-close',
			url: '#destroy-after-close',
			title: 'Destroy After Close',
			native: true,
			render: () => () => teardownCalls.push( 'user-teardown' ) as unknown as void,
		} );

		win.close();

		expect( win.element.isConnected ).toBe( true );
		expect( teardownCalls ).toEqual( [] );

		win.destroy();
		expect( win.element.isConnected ).toBe( false );
		expect( teardownCalls ).toEqual( [ 'user-teardown' ] );
	} );

	test( 'top-level markLoading / markReady fire WINDOW_CONTENT_LOADING / WINDOW_CONTENT_LOADED', async () => {
		let captured: NativeRenderContext | null = null;
		await manager.open( {
			id: 'mark',
			url: '#mark',
			title: 'Mark',
			native: true,
			render: ( _body, ctx ) => {
				captured = ctx ?? null;
			},
		} );

		await new Promise< void >( ( resolve ) =>
			requestAnimationFrame( () => resolve() ),
		);

		const stub = ( window as unknown as { wp: { hooks: { didAction( n: string ): number } } } ).wp.hooks;
		const baselineLoading = stub.didAction( HOOKS.WINDOW_CONTENT_LOADING );
		const baselineLoaded = stub.didAction( HOOKS.WINDOW_CONTENT_LOADED );

		captured!.markLoading();
		expect( stub.didAction( HOOKS.WINDOW_CONTENT_LOADING ) ).toBe( baselineLoading + 1 );

		captured!.markReady();
		expect( stub.didAction( HOOKS.WINDOW_CONTENT_LOADED ) ).toBe( baselineLoaded + 1 );
	} );
} );
