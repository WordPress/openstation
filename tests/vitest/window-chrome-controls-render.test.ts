/**
 * Phase C tests for the controls cluster pipeline:
 *
 *   - `resolveWindowControls` honors `appearance.controls.hide`,
 *     `.custom`, and `.order` overrides on top of the registry.
 *   - `paintWindowControls` populates the cluster with the resolved
 *     buttons, attaches click handlers, and tears them down on
 *     repaint.
 *   - The `wp-desktop.window.chrome.controls` filter mutates the
 *     resolved list per-placement.
 *   - The `wp-desktop.window.chrome.applied` action fires after
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
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const resolved = resolveWindowControls(
			win as unknown as Parameters< typeof resolveWindowControls >[ 0 ],
		);
		expect( resolved.controls.map( ( c ) => c.id ) ).toEqual( [
			'core/minimize',
			'core/maximize',
			'core/focus-tab',
			'core/detach',
			'core/reload',
			'core/close',
		] );
	} );

	test( 'native windows skip core/detach (match predicate)', () => {
		registerBuiltInControls();
		const win = fakeWin( 'os-settings', { native: true } );
		const resolved = resolveWindowControls(
			win as unknown as Parameters< typeof resolveWindowControls >[ 0 ],
		);
		expect( resolved.controls.map( ( c ) => c.id ) ).not.toContain(
			'core/detach',
		);
		// Native windows also skip core/reload — they own their DOM
		// directly, so there's no iframe to reload.
		expect( resolved.controls.map( ( c ) => c.id ) ).not.toContain(
			'core/reload',
		);
		expect( resolved.controls.map( ( c ) => c.id ) ).toContain( 'core/close' );
	} );

	test( 'appearance.controls.hide drops specific built-ins', () => {
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const resolved = resolveWindowControls(
			win as unknown as Parameters< typeof resolveWindowControls >[ 0 ],
			{ hide: [ 'core/detach', 'core/focus-tab' ] },
		);
		expect( resolved.controls.map( ( c ) => c.id ) ).toEqual( [
			'core/minimize',
			'core/maximize',
			'core/reload',
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
		// First three follow the explicit order, then everything not
		// mentioned in `order` keeps registry order.
		expect( resolved.controls.map( ( c ) => c.id ).slice( 0, 3 ) ).toEqual( [
			'core/close',
			'core/minimize',
			'core/maximize',
		] );
		// The remainder is appended in registry order.
		expect( resolved.controls.map( ( c ) => c.id ).slice( 3 ) ).toEqual( [
			'core/focus-tab',
			'core/detach',
			'core/reload',
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

	test( 'wp-desktop.window.chrome.controls filter mutates the resolved list', () => {
		registerBuiltInControls();
		window.wp!.hooks!.addFilter(
			'wp-desktop.window.chrome.controls',
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
		host.className = 'wp-desktop-window__controls';
		win.element.appendChild( host );

		paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);

		expect( host.children.length ).toBe( 6 );
		expect( host.querySelector( '.wp-desktop-window__btn--close' ) ).not.toBeNull();
		expect( host.querySelector( '.wp-desktop-window__btn--minimize' ) ).not.toBeNull();
		expect( host.querySelector( '.wp-desktop-window__btn--reload' ) ).not.toBeNull();
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
			'.wp-desktop-window__btn--close',
		) as HTMLElement;
		closeBtn.dispatchEvent(
			new CustomEvent( 'wpd-button-activate', { bubbles: true } ),
		);
		expect( win.close ).toHaveBeenCalledTimes( 1 );
	} );

	// Regression net for the title-bar Reload button. We've already had
	// one merge silently drop pieces of this wiring; lock the full
	// contract — registration, icon, label, click target — so a future
	// regression fails loudly instead of vanishing the button.
	test( 'core/reload registration locks icon, label, and click target', () => {
		registerBuiltInControls();
		const def = listWindowControls().find( ( c ) => c.id === 'core/reload' );
		expect( def ).toBeDefined();
		expect( def?.icon ).toBe( 'reload' );
		expect( def?.label ).toBe( 'Reload' );
		expect( def?.placement ).toBe( 'controls' );
		expect( def?.core ).toBe( true );
	} );

	test( 'Window class exposes a reload() method (click-target contract)', async () => {
		// The reload control's onClick calls `win.reload()`. Lock that
		// the real Window class still ships that method — a rename or
		// removal would otherwise leave the button click no-oping at
		// runtime with no static error.
		const mod = await import( '../../src/window' );
		expect( typeof mod.Window.prototype.reload ).toBe( 'function' );
	} );

	test( 'click on core/reload button dispatches win.reload()', () => {
		registerBuiltInControls();
		const win = fakeWin( 'edit-post' );
		const host = document.createElement( 'div' );
		paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);
		const reloadBtn = host.querySelector(
			'.wp-desktop-window__btn--reload',
		) as HTMLElement;
		expect( reloadBtn ).not.toBeNull();
		reloadBtn.dispatchEvent(
			new CustomEvent( 'wpd-button-activate', { bubbles: true } ),
		);
		expect( win.reload ).toHaveBeenCalledTimes( 1 );
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
			'.wp-desktop-window__btn--close',
		) as HTMLElement;

		// Repaint — old buttons gone, new buttons in.
		teardown1();
		const teardown2 = paintWindowControls(
			win as unknown as Parameters< typeof paintWindowControls >[ 0 ],
			host,
		);
		const secondClose = host.querySelector(
			'.wp-desktop-window__btn--close',
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

	test( 'fires wp-desktop.window.chrome.applied with layer: controls', () => {
		registerBuiltInControls();
		const layers: string[] = [];
		window.wp!.hooks!.addAction(
			'wp-desktop.window.chrome.applied',
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
			'.wp-desktop-window__btn--plug-star',
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
			host.classList.contains( 'wp-desktop-window__controls--left' ),
		).toBe( true );
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
			'wp-desktop-window__btn--plug-info',
		);
	} );
} );
