import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createWindowElement, syncTabStripSemantics } from '../../src/window/dom';
import {
	_resetWindowChannelsForTests,
	markWindowContentLoading,
	markWindowContentReady,
} from '../../src/window-channels';
import {
	_resetWindowLoadingTransitionsForTests,
	installWindowLoadingTransitions,
} from '../../src/window/loading';
import { paintWindowControls } from '../../src/window-chrome/controls/render';
import { registerBuiltInControls } from '../../src/window-chrome/controls/built-ins';
import type { Window as DesktopWindow } from '../../src/window';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import '../../src/ui/components/os-window-button/os-window-button';

const tick = (): Promise< void > => Promise.resolve();

const BASE_CONFIG = {
	url: '#a11y',
	title: 'Posts',
	icon: 'dashicons-admin-post',
	x: 0,
	y: 0,
	width: 800,
	height: 600,
};

describe( 'window-control buttons — accessible names', () => {
	beforeEach( () => {
		installHooksStub();
		registerBuiltInControls();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetWindowChannelsForTests();
		document.body.innerHTML = '';
	} );

	test( 'every painted control names its focusable shadow button, uniquely', async () => {
		const el = createWindowElement( { ...BASE_CONFIG, id: 'a11y-controls' } );
		document.body.appendChild( el );
		const win = {
			id: 'a11y-controls',
			config: { ...BASE_CONFIG, id: 'a11y-controls' },
			element: el,
		} as unknown as DesktopWindow;

		const host = document.createElement( 'div' );
		el.appendChild( host );
		paintWindowControls( win, host );

		await tick();
		await tick();

		const buttons = Array.from(
			host.querySelectorAll( 'os-window-button' ),
		);
		expect( buttons.length ).toBeGreaterThan( 0 );

		const names = buttons.map( ( b ) => {
			const inner = b.shadowRoot!.querySelector( 'button' )!;
			return inner.getAttribute( 'aria-label' ) ?? '';
		} );

		for ( const name of names ) {
			expect( name.length ).toBeGreaterThan( 0 );
		}

		expect( new Set( names ).size ).toBe( names.length );
	} );
} );

describe( 'tab strip — no empty tablist', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetWindowChannelsForTests();
		document.body.innerHTML = '';
	} );

	test( 'a window with no submenu exposes no tablist and no nav landmark', () => {
		const el = createWindowElement( { ...BASE_CONFIG, id: 'a11y-no-subs' } );
		const strip = el.querySelector< HTMLElement >( '.os-window__tabs' )!;

		expect( strip.getAttribute( 'role' ) ).toBe( 'presentation' );
		expect( strip.hasAttribute( 'aria-label' ) ).toBe( false );
	} );

	test( 'a window with a submenu exposes a labelled tablist', () => {
		const el = createWindowElement( {
			...BASE_CONFIG,
			id: 'a11y-subs',
			submenu: [ { title: 'Categories', url: '#cats' } ],
		} );
		const strip = el.querySelector< HTMLElement >( '.os-window__tabs' )!;
		expect( strip.getAttribute( 'role' ) ).toBe( 'tablist' );
		expect( strip.getAttribute( 'aria-label' ) ).toBe( 'Posts sub-pages' );
		expect( strip.querySelectorAll( '[role="tab"]' ).length ).toBeGreaterThan( 0 );
	} );

	test( 'syncTabStripSemantics flips both ways as tabs come and go', () => {
		const el = createWindowElement( { ...BASE_CONFIG, id: 'a11y-flip' } );
		const strip = el.querySelector< HTMLElement >( '.os-window__tabs' )!;
		expect( strip.getAttribute( 'role' ) ).toBe( 'presentation' );

		const tab = document.createElement( 'button' );
		tab.className = 'os-window__tab';
		tab.setAttribute( 'role', 'tab' );
		strip.appendChild( tab );
		syncTabStripSemantics( strip );
		expect( strip.getAttribute( 'role' ) ).toBe( 'tablist' );
		expect( strip.getAttribute( 'aria-label' ) ).toBe( 'Posts sub-pages' );

		tab.remove();
		syncTabStripSemantics( strip );
		expect( strip.getAttribute( 'role' ) ).toBe( 'presentation' );
		expect( strip.hasAttribute( 'aria-label' ) ).toBe( false );
	} );
} );

describe( 'loading state — exposed, not hidden', () => {
	beforeEach( () => {
		installHooksStub();
		installWindowLoadingTransitions();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetWindowChannelsForTests();
		_resetWindowLoadingTransitionsForTests();
		document.body.innerHTML = '';
	} );

	test( 'the overlay is a polite status region, not aria-hidden', () => {
		const el = createWindowElement( { ...BASE_CONFIG, id: 'a11y-loading' } );
		const overlay = el.querySelector( '.os-window__loading' )!;
		expect( overlay.getAttribute( 'aria-hidden' ) ).toBeNull();
		expect( overlay.getAttribute( 'role' ) ).toBe( 'status' );
		expect( overlay.getAttribute( 'aria-live' ) ).toBe( 'polite' );

		expect(
			overlay.querySelector( 'os-spinner' )!.getAttribute( 'label' ),
		).toBe( 'Loading window content' );
	} );

	test( 'aria-busy tracks the loading → ready → loading cycle', () => {
		const el = createWindowElement( { ...BASE_CONFIG, id: 'a11y-busy' } );
		document.body.appendChild( el );

		expect( el.getAttribute( 'aria-busy' ) ).toBe( 'true' );

		markWindowContentReady( 'a11y-busy' );
		expect( el.hasAttribute( 'aria-busy' ) ).toBe( false );

		markWindowContentLoading( 'a11y-busy' );
		expect( el.getAttribute( 'aria-busy' ) ).toBe( 'true' );

		markWindowContentReady( 'a11y-busy' );
		expect( el.hasAttribute( 'aria-busy' ) ).toBe( false );
	} );
} );
