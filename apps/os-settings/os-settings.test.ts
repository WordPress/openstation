/**
 * The Preferences app's frame: the sidebar, its bands, the search, the
 * deep link, the reset, and the registry tabs.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from '../../tests/vitest/helpers/hooks-stub';
import { installOsSettingsStub, type OsSettingsStub } from '../../tests/vitest/helpers/os-settings-stub';
import { appData, appExtra } from '../../tests/vitest/helpers/os-settings-app';
import { mockViewContext } from '../../src/app-runtime/testing';
import {
	registerSettingsTab,
	unregisterSettingsTab,
	type SettingsTabRenderCtx,
} from '../../src/settings/registry';
import { clientAppFor } from '../../src/app-runtime/client';
import app from './os-settings.os';
import { mountRegistryTabs, pageRows } from './parts/pages';
import type { Ctx } from './parts/types';

let stub: OsSettingsStub;
let root: HTMLElement;
let ctx: Ctx;

const tabIds = (): string[] =>
	Array.from( root.querySelectorAll( '#os-settings-nav > os-tab' ) ).map( ( tab ) => tab.getAttribute( 'value' ) ?? '' );

const visibleTabIds = (): string[] =>
	Array.from( root.querySelectorAll( '#os-settings-nav > os-tab:not([data-search-hidden])' ) ).map(
		( tab ) => tab.getAttribute( 'value' ) ?? '',
	);

function paint( isAdmin = true ): void {
	root = document.createElement( 'div' );
	document.body.appendChild( root );
	ctx = mockViewContext( {
		state: { tab: 'appearance' },
		data: appData( { isAdmin } ),
		root,
		extra: appExtra(),
	} );
	ctx.repaint = () => app.render( ctx as never );
	app.render( ctx as never );
}

beforeEach( () => {
	installHooksStub();
	stub = installOsSettingsStub();
} );

afterEach( () => {
	unregisterSettingsTab( 'acme' );
	document.body.innerHTML = '';
	clearHooksStub();
} );

describe( 'OpenStation Preferences — the frame', () => {
	test( 'publishes itself under the frozen window id', () => {
		expect( app.id ).toBe( 'desktop-mode-os-settings' );
		expect( clientAppFor( 'desktop-mode-os-settings' ) ).toBe( app );
	} );

	test( 'wears the class the stylesheet is written for, as the mount root\'s first child', () => {
		paint();
		expect( root.firstElementChild?.classList.contains( 'os-settings' ) ).toBe( true );
	} );

	test( 'lists the built-in pages in order, Components for admins only, About last', () => {
		paint();
		expect( tabIds() ).toEqual( [ 'appearance', 'themes', 'windows', 'navigation', 'mobile', 'features', 'help', 'about' ] );
		paint( false );
		expect( tabIds() ).toEqual( [ 'appearance', 'themes', 'windows', 'navigation', 'mobile', 'features', 'about' ] );
	} );

	test( 'the strip and the panes are siblings, one pane per page', () => {
		paint();
		const strip = root.querySelector( '#os-settings-nav' )!;
		for ( const id of tabIds() ) {
			const pane = root.querySelector( `os-tabpanel[for="${ id }"]` );
			expect( pane?.parentElement ).toBe( strip.parentElement );
		}
	} );

	test( 'the pages are also a picker, bound to the same state as the strip', () => {
		paint();
		const select = root.querySelector( '.os-settings__page-select' )!;
		expect( select.localName ).toBe( 'os-select' );
		expect( select.getAttribute( 'os-bind' ) ).toBe( 'tab' );
		expect( select.getAttribute( 'value' ) ).toBe( 'appearance' );
		expect( Array.from( select.querySelectorAll( 'os-option' ) ).map( ( o ) => o.getAttribute( 'value' ) ) ).toEqual( tabIds() );
		// A sibling of the strip and the panes: the stylesheet lays the
		// column out from siblings, and swaps strip for picker by width.
		expect( select.parentElement ).toBe( root.querySelector( '#os-settings-nav' )!.parentElement );
		( ctx.state as { tab: string } ).tab = 'features';
		ctx.repaint();
		expect( root.querySelector( '.os-settings__page-select' )?.getAttribute( 'value' ) ).toBe( 'features' );
		expect( root.querySelector( '#os-settings-nav' )?.getAttribute( 'value' ) ).toBe( 'features' );
	} );

	test( 'the first row of each band opens a group', () => {
		paint();
		const starts = Array.from( root.querySelectorAll( '#os-settings-nav > os-tab[data-group-start="true"]' ) ).map(
			( tab ) => tab.getAttribute( 'value' ),
		);
		// Desktop (appearance, themes, windows) · running on it
		// (navigation, features) · the system (help, about).
		expect( starts ).toEqual( [ 'navigation', 'help' ] );
	} );

	test( 'a registry tab slots in by order and paints into its host once', () => {
		const render = vi.fn( ( host: HTMLElement, _tabCtx: SettingsTabRenderCtx ) => {
			host.textContent = 'acme body';
		} );
		registerSettingsTab( { id: 'acme', label: 'Acme', order: 15, render } );
		paint();
		expect( tabIds() ).toEqual( [ 'appearance', 'themes', 'ext-acme', 'windows', 'navigation', 'mobile', 'features', 'help', 'about' ] );
		mountRegistryTabs( ctx, pageRows( ctx ) );
		mountRegistryTabs( ctx, pageRows( ctx ) );
		expect( render ).toHaveBeenCalledTimes( 1 );
		expect( root.querySelector( 'os-tabpanel[for="ext-acme"]' )?.textContent ).toContain( 'acme body' );
		const tabCtx = render.mock.calls[ 0 ][ 1 ];
		expect( tabCtx.isAdmin ).toBe( true );
		expect( tabCtx.getOsSettings() ).toMatchObject( { accent: 'pulse' } );
	} );

	test( 'an admin-only registry tab is hidden from an editor', () => {
		registerSettingsTab( { id: 'acme', label: 'Acme', capability: 'manage_options', render: () => undefined } );
		paint( false );
		expect( tabIds() ).not.toContain( 'ext-acme' );
	} );

	test( 'the deep link is a local action, and an unknown page falls back', () => {
		paint();
		expect( app.hasLocal( 'tab' ) ).toBe( true );
		const next = app.runLocal( 'tab', { tab: 'appearance' }, { value: 'features' }, ctx.data );
		expect( next.tab ).toBe( 'features' );
		const same = app.runLocal( 'tab', { tab: 'themes' }, { value: '' }, ctx.data );
		expect( same.tab ).toBe( 'themes' );
		// A page that no longer exists selects the default rather than
		// deselecting every row.
		( ctx.state as { tab: string } ).tab = 'gone';
		ctx.repaint();
		expect( root.querySelector( '#os-settings-nav' )?.getAttribute( 'value' ) ).toBe( 'appearance' );
	} );

	test( 'search hides the pages that do not match, by their rendered text', () => {
		paint();
		const input = root.querySelector< HTMLInputElement >( '.os-settings__search-input' )!;
		input.value = 'corners';
		input.dispatchEvent( new Event( 'input' ) );
		expect( visibleTabIds() ).toEqual( [ 'windows' ] );
		expect( root.querySelector< HTMLElement >( '.os-settings__search-empty' )?.hidden ).toBe( true );
		input.value = 'zzzz-nothing';
		input.dispatchEvent( new Event( 'input' ) );
		expect( visibleTabIds() ).toEqual( [] );
		expect( root.querySelector< HTMLElement >( '.os-settings__search-empty' )?.hidden ).toBe( false );
		input.value = '';
		input.dispatchEvent( new Event( 'input' ) );
		expect( visibleTabIds() ).toHaveLength( 8 );
	} );

	test( 'Reset to defaults is the public reset', () => {
		paint();
		const button = root.querySelector< HTMLElement >( '.os-settings__footer os-button' )!;
		button.click();
		expect( stub.resetOsSettings ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'OpenStation Preferences — Appearance › Desktop layout', () => {
	const cards = (): HTMLElement[] => Array.from( root.querySelectorAll< HTMLElement >( '.os-settings__layout-card' ) );

	test( 'the whole card picks the layout, its control does not, and the radio does not pick twice', () => {
		paint();
		const split = cards()[ 1 ];
		// The band of card between the description and the control,
		// where a click used to land on nothing.
		split.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( stub.updateOsSettings ).toHaveBeenCalledTimes( 1 );
		expect( stub.updateOsSettings ).toHaveBeenLastCalledWith( { desktopLayout: 'classic' }, expect.anything() );
		// The padded row around the control is as blank as that band.
		split.querySelector< HTMLElement >( '.os-settings__dock-options' )!.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( stub.updateOsSettings ).toHaveBeenCalledTimes( 2 );

		// The control is the one part of the card that is not the
		// layout: picking Sidebar behavior must not also pick Split.
		for ( const sel of [ '.os-settings__dock-option', '.os-settings__dock-option-label', '.os-settings__dock-option os-segmented' ] ) {
			split.querySelector< HTMLElement >( sel )!.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		}
		expect( stub.updateOsSettings ).toHaveBeenCalledTimes( 2 );

		// The radio itself — pointer, or Enter and Space — is one
		// pick, through the card, not one of its own on top.
		const radio = cards()[ 0 ].querySelector< HTMLElement >( '.os-settings__layout-choice' )!;
		radio.click();
		expect( stub.updateOsSettings ).toHaveBeenCalledTimes( 3 );
		expect( stub.updateOsSettings ).toHaveBeenLastCalledWith( { desktopLayout: 'unified' }, expect.anything() );
	} );
} );
