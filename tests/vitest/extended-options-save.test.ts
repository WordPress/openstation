/**
 * Extended Options — the site-wide toggles are an app ACTION.
 *
 * A toggle dispatches `extended` with the full option set (the server
 * merges over what it holds), the controls stay live while the
 * request is in flight (the framework serialises dispatches, so a
 * second toggle lands after the first with the newest set), and a
 * successful save announces the saved set so windows already on
 * screen reconcile without an F5.
 */
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

/** The options the nth `extended` dispatch carried, in call order. */
function optionsOf( call: number ): Record< string, boolean > {
	return ( dispatch.mock.calls[ call ][ 1 ] as { options: Record< string, boolean > } ).options;
}

/** Drive a checkbox the way the component does when a user clicks it. */
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
	// The server merges and echoes the saved set — mirror that.
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
	test( 'a toggle dispatches the full option set', async () => {
		toggle( 'Enable games', true );
		await flush();
		expect( dispatch ).toHaveBeenCalledTimes( 1 );
		expect( dispatch.mock.calls[ 0 ][ 0 ] ).toBe( 'extended' );
		expect( optionsOf( 0 ) ).toEqual( { media_library_enhanced: true, games: true, agents: false } );
	} );

	test( 'a second toggle carries the newest values', async () => {
		toggle( 'Enable games', true );
		await flush();
		toggle( 'Enable AI agents', true );
		await flush();
		expect( dispatch ).toHaveBeenCalledTimes( 2 );
		expect( optionsOf( 1 ) ).toEqual( { media_library_enhanced: true, games: true, agents: true } );
	} );

	test( 'a successful save announces the saved set', async () => {
		const heard: unknown[] = [];
		window.wp!.hooks!.addAction( HOOKS.EXTENDED_OPTIONS_CHANGED, 'test/extended', ( payload ) =>
			heard.push( payload ),
		);
		toggle( 'Enable games', true );
		await flush();
		expect( heard ).toEqual( [ { options: { media_library_enhanced: true, games: true, agents: false } } ] );
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
		expect( el.textContent ).not.toContain( 'Extended options' );
	} );
} );
