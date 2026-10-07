import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { HOOKS } from '../../src/hooks';
import {
	_resetWindowLoadingTransitionsForTests,
	installWindowLoadingTransitions,
} from '../../src/window/loading';
import type { NativeRenderContext } from '../../src/types';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

const settle = (): Promise< void > =>
	new Promise( ( resolve ) => {
		requestAnimationFrame( () => resolve() );
	} );

describe( 'native-window reload', async () => {
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
		Object.defineProperty( desktop, 'clientWidth', {
			value: 1600,
			configurable: true,
		} );
		Object.defineProperty( desktop, 'clientHeight', {
			value: 900,
			configurable: true,
		} );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );

		_resetWindowLoadingTransitionsForTests();
		installWindowLoadingTransitions();
	} );

	afterEach( async () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'the ⋯ menu carries a Reload row for a native window', async () => {
		const win = await manager.open( {
			id: 'reload-row',
			url: '#reload-row',
			title: 'Reload row',
			native: true,
			render: () => {},
		} );

		expect(
			win?.element.querySelector( '.os-window__menu-item--reload' ),
		).not.toBeNull();
	} );

	test( 'a native window with no render callback gets no Reload row', async () => {
		const win = await manager.open( {
			id: 'no-render',
			url: '#no-render',
			title: 'No render',
			native: true,
		} );

		expect(
			win?.element.querySelector( '.os-window__menu-item--reload' ),
		).toBeNull();
	} );

	test( 'iframe windows keep their Reload row', async () => {
		const win = await manager.open( {
			id: 'iframe-reload-row',
			url: '/wp-admin/edit.php',
			title: 'Posts',
		} );

		expect(
			win?.element.querySelector( '.os-window__menu-item--reload' ),
		).not.toBeNull();
	} );

	test( 'reload() re-runs the render callback into an emptied body', async () => {
		let renders = 0;
		const win = await manager.open( {
			id: 'rerender',
			url: '#rerender',
			title: 'Rerender',
			native: true,
			render: ( body ) => {
				renders += 1;
				const p = document.createElement( 'p' );
				p.className = 'probe';
				p.textContent = `render ${ renders }`;
				body.appendChild( p );
			},
		} );
		await settle();

		expect( renders ).toBe( 1 );

		win?.reload();
		await settle();

		expect( renders ).toBe( 2 );

		const probes = win?.element.querySelectorAll( '.probe' );
		expect( probes?.length ).toBe( 1 );
		expect( probes?.[ 0 ].textContent ).toBe( 'render 2' );
	} );

	test( 'the previous render’s teardown runs before the re-render, with its DOM still in place', async () => {
		const order: string[] = [];
		let sawOwnDomAtTeardown: boolean | null = null;

		const win = await manager.open( {
			id: 'teardown-order',
			url: '#teardown-order',
			title: 'Teardown order',
			native: true,
			render: ( body ) => {
				order.push( 'render' );
				const marker = document.createElement( 'span' );
				marker.className = 'marker';
				body.appendChild( marker );
				return () => {
					order.push( 'teardown' );
					sawOwnDomAtTeardown =
						body.querySelector( '.marker' ) !== null;
				};
			},
		} );
		await settle();

		win?.reload();
		await settle();

		expect( order ).toEqual( [ 'render', 'teardown', 'render' ] );
		expect( sawOwnDomAtTeardown ).toBe( true );
	} );

	test( 'the re-render gets a fresh ctx and the old signal aborts', async () => {
		const signals: AbortSignal[] = [];
		const win = await manager.open( {
			id: 'fresh-ctx',
			url: '#fresh-ctx',
			title: 'Fresh ctx',
			native: true,
			render: ( _body, ctx?: NativeRenderContext ) => {
				if ( ctx ) {
					signals.push( ctx.signal );
				}
			},
		} );
		await settle();

		win?.reload();
		await settle();

		expect( signals ).toHaveLength( 2 );
		expect( signals[ 1 ] ).not.toBe( signals[ 0 ] );

		expect( signals[ 0 ].aborted ).toBe( true );

		expect( signals[ 1 ].aborted ).toBe( false );
	} );

	test( 'a throwing teardown still lets the reload through', async () => {
		let renders = 0;
		const errors: unknown[] = [];
		window.wp?.hooks?.addAction(
			HOOKS.SHELL_ERROR,
			'test/native-reload',
			( payload: unknown ) => {
				errors.push( payload );
			},
		);

		const win = await manager.open( {
			id: 'bad-teardown',
			url: '#bad-teardown',
			title: 'Bad teardown',
			native: true,
			render: () => {
				renders += 1;
				return () => {
					throw new Error( 'teardown blew up' );
				};
			},
		} );
		await settle();

		win?.reload();
		await settle();

		expect( renders ).toBe( 2 );
		expect( errors.length ).toBeGreaterThan( 0 );
	} );

	test( 'reload() fires WINDOW_RELOADED for a native window', async () => {
		const payloads: Array< { windowId: string } > = [];
		window.wp?.hooks?.addAction(
			HOOKS.WINDOW_RELOADED,
			'test/native-reload',
			( payload: unknown ) => {
				payloads.push( payload as { windowId: string } );
			},
		);

		const win = await manager.open( {
			id: 'reload-hook',
			url: '#reload-hook',
			title: 'Reload hook',
			native: true,
			render: () => {},
		} );
		await settle();

		win?.reload();
		await settle();

		expect( payloads.map( ( p ) => p.windowId ) ).toContain(
			'reload-hook',
		);
	} );

	test( 'reload() does not close and reopen the window', async () => {
		let closes = 0;
		window.wp?.hooks?.addAction(
			HOOKS.WINDOW_CLOSED,
			'test/native-reload',
			() => {
				closes += 1;
			},
		);

		const win = await manager.open( {
			id: 'no-lifecycle',
			url: '#no-lifecycle',
			title: 'No lifecycle',
			native: true,
			render: () => {},
		} );
		await settle();
		const elementBefore = win?.element;

		win?.reload();
		await settle();

		expect( closes ).toBe( 0 );

		expect( manager.getById( 'no-lifecycle' ) ).toBe( win );
		expect( win?.element ).toBe( elementBefore );
	} );

	test( 'emptying the body does not cost the window its loading overlay', async () => {

		const win = await manager.open( {
			id: 'overlay-survives',
			url: '#overlay-survives',
			title: 'Overlay survives',
			native: true,
			render: () => {},
		} );
		await settle();

		win?.reload();

		const body = win?.element.querySelector( '.os-window__body' );
		expect( body?.querySelector( '.os-window__loading' ) ).not.toBeNull();
	} );

	test( 'reload() is ignored while a render is still in flight', async () => {
		let renders = 0;
		const win = await manager.open( {
			id: 'in-flight',
			url: '#in-flight',
			title: 'In flight',
			native: true,
			render: () => {
				renders += 1;
			},
		} );
		await settle();

		win?.markContentLoading();
		win?.reload();
		await settle();

		expect( renders ).toBe( 1 );
	} );
} );
