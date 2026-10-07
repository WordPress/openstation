import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { HOOKS } from '../../src/hooks';
import { render } from '../../src/ui/core';
import { mockViewContext } from '../../src/app-runtime/testing';
import { renderFeatures } from '../../apps/os-settings/parts/features';
import type { Ctx } from '../../apps/os-settings/parts/types';
import { installOsSettingsStub, type OsSettingsStub } from './helpers/os-settings-stub';
import { appData } from './helpers/os-settings-app';

let stub: OsSettingsStub;
let ctx: Ctx;
let el: HTMLElement;
let dispatch: ReturnType< typeof vi.fn >;

function optionsOf( call: number ): Record< string, boolean > {
	return ( dispatch.mock.calls[ call ][ 1 ] as { options: Record< string, boolean > } ).options;
}

function toggle( label: string, checked: boolean ): void {
	const box = Array.from( el.querySelectorAll( 'os-checkbox-label' ) ).find(
		( node ) => node.getAttribute( 'label' ) === label,
	);
	if ( ! box ) {
		throw new Error( `no checkbox labelled "${ label }"` );
	}
	box.dispatchEvent(
		new CustomEvent( 'os-checkbox-change', { detail: { checked }, bubbles: true, composed: true } ),
	);
}

const flush = (): Promise< void > => new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

beforeEach( () => {
	installHooksStub();
	stub = installOsSettingsStub();
	el = document.createElement( 'div' );
	document.body.appendChild( el );
	const data = appData();

	dispatch = vi.fn( async ( action: string, args?: Record< string, unknown > ) => {
		if ( action === 'extended' ) {
			Object.assign( data.extendedOptions!, ( args as { options: Record< string, boolean > } ).options );
		}
		return true;
	} );
	ctx = mockViewContext( { state: { tab: 'features' }, data, root: el, dispatch } );
	const paint = (): void => render( renderFeatures( stub.state, ctx ), el );
	ctx.repaint = paint;
	paint();
} );

afterEach( () => {
	document.body.innerHTML = '';
	clearHooksStub();
} );

describe( 'Extended Options — saving', () => {
	test.each( [
		[ 'Preload windows on hover', 'window_prewarm' ],
		[ 'Shared asset cache', 'admin_asset_cache' ],
	] )( '%s is enabled in Extended options and can be opted out', async ( label, key ) => {
		const box = Array.from( el.querySelectorAll( 'os-checkbox-label' ) ).find(
			( node ) => node.getAttribute( 'label' ) === label,
		)!;
		expect( box.closest( 'os-section' )?.getAttribute( 'heading' ) ).toBe( 'Extended options' );
		expect( box.hasAttribute( 'checked' ) ).toBe( true );
		toggle( label, false );
		await flush();
		expect( optionsOf( 0 )[ key ] ).toBe( false );
		expect( stub.updateOsSettings ).not.toHaveBeenCalled();
		expect( box.hasAttribute( 'checked' ) ).toBe( false );
		toggle( label, true );
		await flush();
		expect( optionsOf( 1 )[ key ] ).toBe( true );
	} );

	test( 'a toggle dispatches the full option set', async () => {
		toggle( 'Enable games', true );
		await flush();
		expect( dispatch ).toHaveBeenCalledTimes( 1 );
		expect( dispatch.mock.calls[ 0 ][ 0 ] ).toBe( 'extended' );
		expect( optionsOf( 0 ) ).toEqual( { window_prewarm: true, admin_asset_cache: true, media_library_enhanced: true, games: true, agents: false, network: false } );
	} );

	test( 'a second toggle carries the newest values', async () => {
		toggle( 'Enable games', true );
		await flush();
		toggle( 'Enable AI agents', true );
		await flush();
		expect( dispatch ).toHaveBeenCalledTimes( 2 );
		expect( optionsOf( 1 ) ).toEqual( { window_prewarm: true, admin_asset_cache: true, media_library_enhanced: true, games: true, agents: true, network: false } );
	} );

	test( 'rapid toggles while a save is in flight carry the newest values and do not drop prior toggles', async () => {
		dispatch.mockImplementation( async ( action: string, args?: Record< string, unknown > ) => {
			await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
			if ( action === 'extended' ) {
				Object.assign( ctx.data.extendedOptions!, ( args as { options: Record< string, boolean > } ).options );
			}
			return true;
		} );

		toggle( 'Enable drag-and-drop in the Media Library', false );
		toggle( 'Enable games', true );

		expect( el.querySelector( '.os-ext__saving' ) ).not.toBeNull();

		await new Promise( ( resolve ) => setTimeout( resolve, 150 ) );

		expect( dispatch ).toHaveBeenCalledTimes( 2 );
		expect( optionsOf( 0 ) ).toEqual( { window_prewarm: true, admin_asset_cache: true, media_library_enhanced: false, games: false, agents: false, network: false } );
		expect( optionsOf( 1 ) ).toEqual( { window_prewarm: true, admin_asset_cache: true, media_library_enhanced: false, games: true, agents: false, network: false } );
		expect( el.querySelector( '.os-ext__saving' ) ).toBeNull();
	} );

	test( 'a successful save announces the saved set', async () => {
		const heard: unknown[] = [];
		window.wp!.hooks!.addAction( HOOKS.EXTENDED_OPTIONS_CHANGED, 'test/extended', ( payload ) =>
			heard.push( payload ),
		);
		toggle( 'Enable games', true );
		await flush();
		expect( heard ).toEqual( [ { options: { window_prewarm: true, admin_asset_cache: true, media_library_enhanced: true, games: true, agents: false, network: false } } ] );
	} );

	test( 'a failed save says so inline and announces nothing', async () => {
		dispatch.mockResolvedValueOnce( false );
		const heard: unknown[] = [];
		window.wp!.hooks!.addAction( HOOKS.EXTENDED_OPTIONS_CHANGED, 'test/extended', ( payload ) =>
			heard.push( payload ),
		);
		toggle( 'Enable games', true );
		await flush();
		expect( heard ).toEqual( [] );
		expect( el.querySelector( '.os-ext__error' ) ).not.toBeNull();
	} );

	test( 'the section is never painted for a non-admin', () => {
		ctx.data.isAdmin = false;
		ctx.data.extendedOptions = null;
		ctx.repaint();
		expect( el.querySelector( 'os-section[heading="Extended options"]' ) ).toBeNull();
		expect( el.querySelector( 'os-checkbox-label[label="Preload windows on hover"]' ) ).toBeNull();
		expect( el.querySelector( 'os-checkbox-label[label="Shared asset cache"]' ) ).toBeNull();
	} );
} );
