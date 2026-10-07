import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import {
	registerWindowSlot,
	_resetWindowSlotRegistryForTests,
} from '../../src/window-chrome/slots/registry';
import { paintWindowSlots } from '../../src/window-chrome/slots/render';

import type { WindowSlotName } from '../../src/types';

function buildWindowWithSlots( id: string ): {
	id: string;
	config: { id: string; native: boolean; appearance?: import( '../../src/types' ).WindowAppearance };
	element: HTMLElement;
} {
	const element = document.createElement( 'div' );
	element.className = 'os-window';
	const slots: WindowSlotName[] = [
		'before-titlebar',
		'before-icon',
		'icon',
		'title',
		'after-title',
		'before-controls',
		'after-controls',
		'after-titlebar',
	];
	for ( const name of slots ) {
		const host = document.createElement( 'span' );
		host.dataset.slot = name;
		host.className = `os-window__slot os-window__slot--${ name }`;
		element.appendChild( host );
	}

	const iconHost = element.querySelector< HTMLElement >( '[data-slot="icon"]' )!;
	const iconEl = document.createElement( 'span' );
	iconEl.className = 'os-window__icon dashicons dashicons-admin-generic';
	iconHost.appendChild( iconEl );
	const titleHost = element.querySelector< HTMLElement >( '[data-slot="title"]' )!;
	const titleEl = document.createElement( 'span' );
	titleEl.className = 'os-window__title';
	titleEl.textContent = id;
	titleHost.appendChild( titleEl );

	return {
		id,
		config: { id, native: false },
		element,
	};
}

beforeEach( () => {
	installHooksStub();
	_resetWindowSlotRegistryForTests();
} );

afterEach( () => {
	_resetWindowSlotRegistryForTests();
	clearHooksStub();
} );

describe( 'paintWindowSlots', () => {
	test( '{ html } override sandboxes via textContent (no innerHTML)', () => {
		const win = buildWindowWithSlots( 'edit-post' );
		win.config.appearance = {
			slots: {
				title: { html: '<script>alert(1)</script>Hello' },
			},
		};
		paintWindowSlots( win as Parameters< typeof paintWindowSlots >[ 0 ] );

		const titleHost = win.element.querySelector< HTMLElement >(
			'[data-slot="title"]',
		)!;

		expect( titleHost.textContent ).toBe( '<script>alert(1)</script>Hello' );
		expect( titleHost.querySelector( 'script' ) ).toBeNull();
	} );

	test( 'null override empties the slot (default content suppressed)', () => {
		const win = buildWindowWithSlots( 'edit-post' );
		win.config.appearance = { slots: { icon: null } };
		paintWindowSlots( win as Parameters< typeof paintWindowSlots >[ 0 ] );

		const iconHost = win.element.querySelector< HTMLElement >(
			'[data-slot="icon"]',
		)!;
		expect( iconHost.children.length ).toBe( 0 );
	} );

	test( '{ render } override invokes the callback and replaces content', () => {
		const win = buildWindowWithSlots( 'edit-post' );
		const renderSpy = vi.fn( ( host: HTMLElement ) => {
			const span = document.createElement( 'span' );
			span.textContent = 'CUSTOM';
			host.appendChild( span );
		} );
		win.config.appearance = {
			slots: { 'after-titlebar': { render: renderSpy } },
		};
		paintWindowSlots( win as Parameters< typeof paintWindowSlots >[ 0 ] );

		const host = win.element.querySelector< HTMLElement >(
			'[data-slot="after-titlebar"]',
		)!;
		expect( renderSpy ).toHaveBeenCalledTimes( 1 );
		expect( host.textContent ).toBe( 'CUSTOM' );
	} );

	test( 'render teardown is invoked on re-paint', () => {
		const win = buildWindowWithSlots( 'edit-post' );
		const teardown = vi.fn();
		const renderSpy = vi.fn( () => teardown );
		win.config.appearance = {
			slots: { 'after-title': { render: renderSpy } },
		};
		const t1 = paintWindowSlots( win as Parameters< typeof paintWindowSlots >[ 0 ] );

		t1();
		expect( teardown ).toHaveBeenCalledTimes( 1 );

		paintWindowSlots( win as Parameters< typeof paintWindowSlots >[ 0 ] );
		expect( renderSpy ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'global slot registry entries paint into matched windows', () => {
		registerWindowSlot( {
			id: 'plug/title-prefix',
			slot: 'title',
			match: () => true,
			replace: false,
			render: ( host ) => {
				const prefix = document.createElement( 'span' );
				prefix.className = 'plug-prefix';
				prefix.textContent = '★ ';
				host.insertBefore( prefix, host.firstChild );
			},
		} );

		const win = buildWindowWithSlots( 'edit-post' );
		paintWindowSlots( win as Parameters< typeof paintWindowSlots >[ 0 ] );
		const titleHost = win.element.querySelector< HTMLElement >(
			'[data-slot="title"]',
		)!;
		expect( titleHost.querySelector( '.plug-prefix' )?.textContent ).toBe(
			'★ ',
		);

		expect( titleHost.querySelector( '.os-window__title' ) ).not.toBeNull();
	} );

	test( 'os.window.chrome.slot filter receives the host', () => {
		const seen: string[] = [];
		window.wp!.hooks!.addFilter(
			'os.window.chrome.slot',
			'test/listener',
			( ( host: HTMLElement, ctx: { slot: string } ) => {
				seen.push( ctx.slot );
				return host;
			} ) as ( ...a: unknown[] ) => unknown,
		);
		const win = buildWindowWithSlots( 'edit-post' );
		paintWindowSlots( win as Parameters< typeof paintWindowSlots >[ 0 ] );
		expect( seen ).toContain( 'icon' );
		expect( seen ).toContain( 'title' );
		expect( seen ).toContain( 'before-titlebar' );
	} );

	test( 'clearing override restores the slot default content', () => {
		const win = buildWindowWithSlots( 'edit-post' );

		win.config.appearance = { slots: { icon: { html: 'X' } } };
		paintWindowSlots( win as Parameters< typeof paintWindowSlots >[ 0 ] );
		const iconHost = win.element.querySelector< HTMLElement >(
			'[data-slot="icon"]',
		)!;
		expect( iconHost.textContent ).toBe( 'X' );

		win.config.appearance = { slots: {} };
		paintWindowSlots( win as Parameters< typeof paintWindowSlots >[ 0 ] );
		expect( iconHost.querySelector( '.dashicons' ) ).not.toBeNull();
	} );
} );
