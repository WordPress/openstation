/**
 * Regression: opening a second My WordPress window while the first
 * is still open should still load. Pre-fix the module-level
 * `closeHandler` matched on the base `WINDOW_ID`, so closing instance 1
 * tore down instance 2's state mid-render; `asRenderState` then
 * rejected any kind-registry navigation in the still-alive instance
 * because the singleton `activeState` no longer pointed at it.
 *
 * Test pattern: load the my-wordpress module (it registers a callback
 * on `window.desktopModeNativeWindows[WINDOW_ID]`), call that callback
 * against two distinct bodies, and confirm both ended up with the
 * root tile grid painted.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { cloneTemplate } from '../../src/native-windows';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

const WINDOW_ID = 'desktop-mode-my-wordpress';

interface NativeWindowsGlobal {
	desktopModeNativeWindows?: Record<
		string,
		( ( body: HTMLElement ) => void | ( () => void ) ) | undefined
	>;
	desktopModeWindowConfig?: Record< string, unknown >;
}

function installTemplateMarkup( host: HTMLElement ): void {
	host.innerHTML = `
		<div class="desktop-mode-my-wordpress" data-desktop-mode-my-wordpress-root>
			<header data-desktop-mode-my-wordpress-breadcrumbs></header>
			<div class="desktop-mode-my-wordpress__body" data-desktop-mode-my-wordpress-body>
				<div class="desktop-mode-my-wordpress__loading" data-desktop-mode-my-wordpress-loading hidden></div>
			</div>
			<div class="desktop-mode-folder-status-bar" data-desktop-mode-my-wordpress-status></div>
		</div>
	`;
}

describe( 'my-wordpress — multi-instance render', () => {
	beforeEach( async () => {
		installHooksStub();
		// Stub the shell config the bundle reads via `getConfig()`.
		( window as unknown as NativeWindowsGlobal ).desktopModeWindowConfig = {
			[ WINDOW_ID ]: {
				restRoot: 'http://example.test/wp-json/',
				restNonce: 'nonce',
				editPostUrlBase: 'http://example.test/wp-admin/post.php',
				editUserUrlBase: 'http://example.test/wp-admin/user-edit.php',
				entities: [
					{
						id: 'posts',
						label: 'Posts',
						icon: 'dashicons-admin-post',
						restPath: 'wp/v2/posts',
						kind: 'post',
					},
				],
				perPage: 24,
				mediaPerPage: 48,
				previewActions: [],
			},
		};
		// `fetchEntityTotal` runs as soon as the root view paints — stub
		// fetch so the test doesn't hit the network.
		vi.stubGlobal(
			'fetch',
			vi.fn( () =>
				Promise.resolve(
					new Response( '[]', {
						status: 200,
						headers: { 'X-WP-Total': '0' },
					} ),
				),
			),
		);
		// Side-effect import installs the render callback.
		await import( '../../src/my-wordpress/index' );
	} );

	afterEach( () => {
		// Don't wipe `desktopModeNativeWindows` — Vitest caches the
		// side-effect import, so the bundle's registration only runs
		// once across the whole file. Clearing the global between
		// tests strands every subsequent test without a callback.
		document.body.innerHTML = '';
		clearHooksStub();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	test( 'callback paints content into a single body', async () => {
		const cb = ( window as unknown as NativeWindowsGlobal )
			.desktopModeNativeWindows?.[ WINDOW_ID ];
		expect( typeof cb ).toBe( 'function' );

		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-window__body';
		installTemplateMarkup( body );
		document.body.appendChild( body );

		cb!( body );

		const grid = body.querySelector( '.desktop-mode-my-wordpress__grid' );
		expect( grid ).not.toBeNull();
		expect( grid!.children.length ).toBeGreaterThan( 0 );
	} );

	test( 'callback paints content into BOTH bodies when invoked twice', async () => {
		const cb = ( window as unknown as NativeWindowsGlobal )
			.desktopModeNativeWindows?.[ WINDOW_ID ];
		expect( typeof cb ).toBe( 'function' );

		const body1 = document.createElement( 'div' );
		body1.className = 'desktop-mode-window__body';
		body1.dataset.instance = '1';
		installTemplateMarkup( body1 );
		document.body.appendChild( body1 );

		const body2 = document.createElement( 'div' );
		body2.className = 'desktop-mode-window__body';
		body2.dataset.instance = '2';
		installTemplateMarkup( body2 );
		document.body.appendChild( body2 );

		const teardown1 = cb!( body1 );
		const teardown2 = cb!( body2 );

		const grid1 = body1.querySelector( '.desktop-mode-my-wordpress__grid' );
		const grid2 = body2.querySelector( '.desktop-mode-my-wordpress__grid' );
		expect( grid1, 'first body grid' ).not.toBeNull();
		expect( grid2, 'second body grid' ).not.toBeNull();

		// Pre-fix regression: tearing down instance 1 also fired
		// instance 2's `closeHandler` (both compared the closed event's
		// `windowId` against the base `WINDOW_ID` constant), so instance
		// 2's teardown ran while it was still alive — content stayed,
		// but the drop-target registration leaked AND the singleton
		// `activeState` flipped to `null`, leaving every kind-registry
		// render in instance 2 to throw "host body does not match
		// active state."
		if ( typeof teardown1 === 'function' ) {
			teardown1();
		}
		const grid2After = body2.querySelector(
			'.desktop-mode-my-wordpress__grid',
		);
		expect( grid2After, 'instance 2 grid after instance 1 teardown' )
			.not.toBeNull();

		if ( typeof teardown2 === 'function' ) {
			teardown2();
		}
	} );

	test( 'callback returns a per-instance teardown function', async () => {
		const cb = ( window as unknown as NativeWindowsGlobal )
			.desktopModeNativeWindows?.[ WINDOW_ID ];
		expect( typeof cb ).toBe( 'function' );

		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-window__body';
		installTemplateMarkup( body );
		document.body.appendChild( body );

		const teardown = cb!( body );
		// The framework's `Window.hydrateNative` captures this teardown
		// and invokes it on `close()`. Without a function here the per-
		// instance close cleanup would be missing entirely.
		expect( typeof teardown ).toBe( 'function' );

		// Idempotent: teardown shouldn't throw if invoked.
		( teardown as () => void )();
	} );

	test( 'opening a second window via manager.openNew with the my-wordpress finalRender shape renders content in the second window', async () => {
		// This mirrors what `openNewFromEntry` does for native windows
		// — the user-reported scenario: an open My WordPress window,
		// then `wp.desktop.openNewWindow( 'desktop-mode-my-wordpress' )`
		// (or any path that routes through `manager.openNew`).
		const TEMPLATE_ID = `desktop-mode-native-window-${ WINDOW_ID }`;
		const tpl = document.createElement( 'template' );
		tpl.id = TEMPLATE_ID;
		tpl.innerHTML = `
			<div class="desktop-mode-my-wordpress" data-desktop-mode-my-wordpress-root>
				<header data-desktop-mode-my-wordpress-breadcrumbs></header>
				<div class="desktop-mode-my-wordpress__body" data-desktop-mode-my-wordpress-body>
					<div class="desktop-mode-my-wordpress__loading" data-desktop-mode-my-wordpress-loading hidden></div>
				</div>
				<div class="desktop-mode-folder-status-bar" data-desktop-mode-my-wordpress-status></div>
			</div>
		`;
		document.body.appendChild( tpl );

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
		const manager = new WindowManager( desktop );

		const render = ( window as unknown as NativeWindowsGlobal )
			.desktopModeNativeWindows?.[ WINDOW_ID ];
		expect( typeof render ).toBe( 'function' );

		// Same shape as `openNewFromEntry`'s `finalRender`.
		const finalRender = ( body: HTMLElement, ctx?: unknown ): unknown => {
			body.appendChild( cloneTemplate( TEMPLATE_ID ) );
			return ( render as ( b: HTMLElement, c?: unknown ) => unknown )( body, ctx );
		};

		await manager.open( {
			id: WINDOW_ID,
			baseId: WINDOW_ID,
			url: `#${ WINDOW_ID }`,
			title: 'MW',
			native: true,
			render: finalRender as never,
		} );

		await manager.openNew( {
			id: WINDOW_ID,
			baseId: WINDOW_ID,
			url: `#${ WINDOW_ID }`,
			title: 'MW',
			native: true,
			render: finalRender as never,
		} );

		const wins = manager.getAll();
		expect( wins.length ).toBe( 2 );

		for ( const win of wins ) {
			const body = win.element.querySelector< HTMLElement >(
				'.desktop-mode-window__body',
			);
			expect( body, `body for ${ win.id }` ).not.toBeNull();
			const grid = body!.querySelector( '.desktop-mode-my-wordpress__grid' );
			expect(
				grid,
				`grid for ${ win.id } — pre-fix only the FIRST window had a grid; the second one's renderInto silently bailed because module-level state was stale`,
			).not.toBeNull();
		}

		for ( const win of wins ) {
			win.destroy();
		}
		desktop.remove();
		document.getElementById( TEMPLATE_ID )?.remove();
	} );
} );
