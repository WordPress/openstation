/**
 * Phase C tests for the controls cluster pipeline:
 *
 *   - `resolveWindowControls` honors `appearance.controls.hide`,
 *     `.custom`, and `.order` overrides on top of the registry.
 *   - `paintWindowControls` populates the cluster with the resolved
 *     buttons, attaches click handlers, and tears them down on
 *     repaint.
 *   - The `desktop-mode.window.chrome.controls` filter mutates the
 *     resolved list per-placement.
 *   - The `desktop-mode.window.chrome.applied` action fires after
 *     each paint with `layer: 'controls'`.
 *   - Built-in controls (`core/*`) and `appearance.controls.hide`
 *     interact correctly: a plugin can hide `core/close` for one
 *     window without unregistering it globally.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import {
	registerWindowControl,
	listWindowControls,
	_resetWindowControlRegistryForTests,
} from '../../src/window-chrome/controls/registry';
import { registerBuiltInControls } from '../../src/window-chrome/controls/built-ins';
import {
	resolveWindowControls,
	paintWindowControls,
} from '../../src/window-chrome/controls/render';

import type { WindowControlsConfig } from '../../src/types';

/**
 * Ducktyped Window — render only inspects `id`, `config`, and the
 * methods we exercise via onClick (`minimize`, etc.). We attach
 * spies on those methods so tests can verify the click handler
 * dispatches.
 */
function fakeWin(
	id: string,
	opts: { native?: boolean } = {},
): {
	id: string;
	config: { id: string; native: boolean; appearance?: { controls?: WindowControlsConfig } };
	element: HTMLElement;
	minimize: ReturnType< typeof vi.fn >;
	toggleMaximize: ReturnType< typeof vi.fn >;
	toggleFullscreen: ReturnType< typeof vi.fn >;
	detach: ReturnType< typeof vi.fn >;
	reload: ReturnType< typeof vi.fn >;
	close: ReturnType< typeof vi.fn >;
} {
	return {
		id,
		config: { id, native: opts.native ?? false },
		element: document.createElement( 'div' ),
		minimize: vi.fn(),
		toggleMaximize: vi.fn(),
		toggleFullscreen: vi.fn(),
		detach: vi.fn(),
		reload: vi.fn(),
		close: vi.fn(),
	};
}

beforeEach( () => {
	installHooksStub();
	_resetWindowControlRegistryForTests();
} );

afterEach( () => {
	_resetWindowControlRegistryForTests();
	clearHooksStub();
} );

describe( 'resolveWindowControls', () => {
	test( 'returns built-ins in registered order for an iframe window', () => {
		// `core/detach` + `core/reload` used to live here — they
		// moved into the title-bar three-dots menu (see
		// `src/window/dom.ts`). The cluster now ships four entries.
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const resolved = resolveWindowControls(
			win as unknown as Parameters< typeof resolveWindowControls >[ 0 ],
		);
		expect( resolved.controls.map( ( c ) => c.id ) ).toEqual( [
			'core/minimize',
			'core/maximize',
			'core/focus-tab',
			'core/close',
		] );
	} );

	test( 'native windows still get the basic control cluster', () => {
		// Pre-0.6.2 this test asserted that `core/detach` /
		// `core/reload` were skipped for native windows. Both are
		// gone from the cluster entirely now (relocated to the
		// menu), so the assertion collapses to "native windows
		// render the same minimize/maximize/focus/close set as
		// iframe windows."
		registerBuiltInControls();
		const win = fakeWin( 'os-settings', { native: true } );
		const resolved = resolveWindowControls(
			win as unknown as Parameters< typeof resolveWindowControls >[ 0 ],
		);
		expect( resolved.controls.map( ( c ) => c.id ) ).toContain(
			'core/close',
		);
		expect( resolved.controls.map( ( c ) => c.id ) ).not.toContain(
			'core/detach',
		);
		expect( resolved.controls.map( ( c ) => c.id ) ).not.toContain(
			'core/reload',
		);
	} );

	test( 'appearance.controls.hide drops specific built-ins', () => {
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const resolved = resolveWindowControls(
			win as unknown as Parameters< typeof resolveWindowControls >[ 0 ],
			{ hide: [ 'core/focus-tab' ] },
		);
		expect( resolved.controls.map( ( c ) => c.id ) ).toEqual( [
			'core/minimize',
			'core/maximize',
			'core/close',
		] );
	} );

	test( 'appearance.controls.order rearranges the cluster', () => {
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const resolved = resolveWindowControls(
			win as unknown as Parameters< typeof resolveWindowControls >[ 0 ],
			{
				order: [ 'core/close', 'core/minimize', 'core/maximize' ],
			},
		);
		expect( resolved.controls.map( ( c ) => c.id ).slice( 0, 3 ) ).toEqual( [
			'core/close',
			'core/minimize',
			'core/maximize',
		] );
		// Whatever isn't named in `order` keeps registry order — for
		// the post-0.6.2 cluster that's just `core/focus-tab`. The
		// detach + reload built-ins moved to the title-bar menu.
		expect( resolved.controls.map( ( c ) => c.id ).slice( 3 ) ).toEqual( [
			'core/focus-tab',
		] );
	} );

	test( 'appearance.controls.custom inserts inline window-scoped buttons', () => {
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const resolved = resolveWindowControls(
			win as unknown as Parameters< typeof resolveWindowControls >[ 0 ],
			{
				custom: [
					{
						id: 'plug/star',
						label: 'Star',
						icon: 'dashicons-star-filled',
						placement: 'controls',
						order: 5, // before core/minimize (10)
						onClick: () => {},
					},
				],
			},
		);
		expect( resolved.controls.map( ( c ) => c.id )[ 0 ] ).toBe( 'plug/star' );
	} );

	test( 'desktop-mode.window.chrome.controls filter mutates the resolved list', () => {
		registerBuiltInControls();
		window.wp!.hooks!.addFilter(
			'desktop-mode.window.chrome.controls',
			'test/dropper',
			( ( list: { id: string }[], ctx: { placement: string } ) => {
				if ( ctx.placement !== 'controls' ) {
					return list;
				}
				return list.filter( ( c ) => c.id !== 'core/maximize' );
			} ) as ( ...a: unknown[] ) => unknown,
		);
		const win = fakeWin( 'edit-post' );
		const resolved = resolveWindowControls(
			win as unknown as Parameters< typeof resolveWindowControls >[ 0 ],
		);
		expect( resolved.controls.map( ( c ) => c.id ) ).not.toContain(
			'core/maximize',
		);
	} );
} );

describe( 'paintWindowControls', () => {
	test( 'populates the controls host with built-in buttons', () => {
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const host = document.createElement( 'div' );
		host.className = 'desktop-mode-window__controls';
		win.element.appendChild( host );

		paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);

		// minimize / maximize / focus-tab / close — detach + reload
		// moved to the three-dots menu.
		expect( host.children.length ).toBe( 4 );
		expect( host.querySelector( '.desktop-mode-window__btn--close' ) ).not.toBeNull();
		expect( host.querySelector( '.desktop-mode-window__btn--minimize' ) ).not.toBeNull();
		expect( host.querySelector( '.desktop-mode-window__btn--reload' ) ).toBeNull();
	} );

	test( 'click on core/close button dispatches win.close()', () => {
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const host = document.createElement( 'div' );
		paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);
		const closeBtn = host.querySelector(
			'.desktop-mode-window__btn--close',
		) as HTMLElement;
		closeBtn.dispatchEvent(
			new CustomEvent( 'wpd-button-activate', { bubbles: true } ),
		);
		expect( win.close ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'core/reload + core/detach are no longer registered', () => {
		// In 0.6.2 these moved from the controls cluster to the
		// title-bar three-dots menu (see `src/window/dom.ts`). Lock
		// that the registry no longer carries them so a regression
		// that re-adds them surfaces here.
		registerBuiltInControls();
		const ids = listWindowControls().map( ( c ) => c.id );
		expect( ids ).not.toContain( 'core/reload' );
		expect( ids ).not.toContain( 'core/detach' );
	} );

	test( 'Window class still exposes reload() + detach() (menu click targets)', async () => {
		// The menu items wire to `win.reload()` / `win.detach()`. Lock
		// that the Window class still ships both methods — a rename
		// or removal would otherwise leave the menu items no-oping at
		// runtime with no static error.
		const mod = await import( '../../src/window' );
		expect( typeof mod.Window.prototype.reload ).toBe( 'function' );
		expect( typeof mod.Window.prototype.detach ).toBe( 'function' );
	} );

	test( 'repaint replaces previous buttons; teardown drops listeners', () => {
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const host = document.createElement( 'div' );
		const teardown1 = paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);
		const firstClose = host.querySelector(
			'.desktop-mode-window__btn--close',
		) as HTMLElement;

		// Repaint — old buttons gone, new buttons in.
		teardown1();
		const teardown2 = paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);
		const secondClose = host.querySelector(
			'.desktop-mode-window__btn--close',
		) as HTMLElement;
		expect( firstClose ).not.toBe( secondClose );

		// Click on the OLD button after teardown shouldn't fire the
		// handler — it's been dropped.
		firstClose.dispatchEvent(
			new CustomEvent( 'wpd-button-activate', { bubbles: true } ),
		);
		// New button still works.
		secondClose.dispatchEvent(
			new CustomEvent( 'wpd-button-activate', { bubbles: true } ),
		);
		expect( win.close ).toHaveBeenCalledTimes( 1 );
		teardown2();
	} );

	test( 'fires desktop-mode.window.chrome.applied with layer: controls', () => {
		registerBuiltInControls();
		const layers: string[] = [];
		window.wp!.hooks!.addAction(
			'desktop-mode.window.chrome.applied',
			'test/applied',
			( ( payload: { layer: string } ) => {
				layers.push( payload.layer );
			} ) as ( ...a: unknown[] ) => void,
		);
		const win = fakeWin( 'edit-post' );
		const host = document.createElement( 'div' );
		paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);
		expect( layers.at( -1 ) ).toBe( 'controls' );
	} );

	test( 'plugin custom control with onClick fires window-scoped handler', () => {
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const host = document.createElement( 'div' );
		const handler = vi.fn();
		win.config.appearance = {
			controls: {
				custom: [
					{
						id: 'plug/star',
						label: 'Star',
						icon: 'dashicons-star-filled',
						placement: 'controls',
						onClick: handler,
					},
				],
			},
		};
		paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);
		const star = host.querySelector(
			'.desktop-mode-window__btn--plug-star',
		) as HTMLElement;
		expect( star ).not.toBeNull();
		star.dispatchEvent(
			new CustomEvent( 'wpd-button-activate', { bubbles: true } ),
		);
		expect( handler ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'placement:left sets the controls--left class on the host', () => {
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const host = document.createElement( 'div' );
		win.config.appearance = { controls: { placement: 'left' } };
		paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);
		expect(
			host.classList.contains( 'desktop-mode-window__controls--left' ),
		).toBe( true );
	} );

	// Regression: between 0.6.0 and 0.6.2 the renderer bound the
	// onClick handler to BOTH `click` and `wpd-button-activate`. The
	// component's internal `<button>` fires a native click that
	// bubbles `composed: true` up to the host AND dispatches a
	// follow-up `wpd-button-activate` CustomEvent, so the handler
	// fired twice per user gesture. Maximize / fullscreen toggled
	// on then off in one click and silently appeared broken across
	// every window in the shell.
	//
	// The original test (above) only dispatched `wpd-button-activate`
	// directly, never the native click that the component itself
	// emits — which is exactly why it didn't catch the regression.
	// This test simulates both events the way they actually fire in
	// the browser, and asserts the handler runs exactly ONCE.
	test( 'click on a control fires the handler exactly once (no double-fire from click + wpd-button-activate)', () => {
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const host = document.createElement( 'div' );
		paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);
		const maximizeBtn = host.querySelector(
			'.desktop-mode-window__btn--maximize',
		) as HTMLElement;

		// Sequence the real `<wpd-window-button>` produces on a single
		// pointer click: native `click` bubbles `composed: true` from
		// the shadow `<button>` up to the host, then the component
		// dispatches `wpd-button-activate` from the host.
		maximizeBtn.dispatchEvent(
			new MouseEvent( 'click', { bubbles: true, composed: true } ),
		);
		maximizeBtn.dispatchEvent(
			new CustomEvent( 'wpd-button-activate', {
				bubbles: true,
				composed: true,
			} ),
		);

		// One user click → one toggleMaximize call. Two would silently
		// re-toggle, which is what bit us before.
		expect( win.toggleMaximize ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'plugin can register a control via registerWindowControl and it appears', () => {
		registerBuiltInControls();
		registerWindowControl( {
			id: 'plug/info',
			label: 'Info',
			icon: 'dashicons-info',
			placement: 'controls',
			order: 5,
			match: () => true,
			onClick: () => {},
			owner: 'plug',
		} );
		const win = fakeWin( 'edit-post' );
		const host = document.createElement( 'div' );
		paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);
		// First button is the order-5 plugin entry, before core/minimize (order 10).
		expect( ( host.children[ 0 ] as HTMLElement ).className ).toContain(
			'desktop-mode-window__btn--plug-info',
		);
	} );
} );
