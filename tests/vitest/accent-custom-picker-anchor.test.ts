/**
 * The Custom accent swatch opens the native colour wheel IN PLACE.
 *
 * Where the wheel appears is not something `showPicker()` takes an
 * argument for: it is a browser popup anchored to the box of the
 * `<input type="color">` it belongs to. So the input has to live in
 * the Custom swatch's cell and fill it through CSS — measured and
 * moved by hand, the wheel opened under the FIRST swatch, because an
 * inline position written in the same tick leaves layout dirty and
 * the popup is placed from the box the browser already computed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from '../../src/ui/core';
import { mockViewContext } from '../../src/app-runtime/testing';
import { accentSection } from '../../apps/os-settings/parts/appearance';
import { CUSTOM_ACCENT_ID } from '../../src/settings/constants';
import { installOsSettingsStub, type OsSettingsStub } from './helpers/os-settings-stub';
import { appData } from './helpers/os-settings-app';

const CELL = '.os-settings__accent-custom';
const PICKER = '.os-settings__accent-picker';

let stub: OsSettingsStub;

function build(): HTMLElement {
	const el = document.createElement( 'div' );
	const ctx = mockViewContext( { state: { tab: 'appearance' }, data: appData(), root: el } );
	render( accentSection( stub.state, ctx ), el );
	return el;
}

/** Pick a swatch the way `<os-swatch>` does when a user clicks it. */
function pick( el: HTMLElement, value: string ): void {
	el.querySelector( 'os-swatch-grid' )!.dispatchEvent(
		new CustomEvent( 'os-pick', { detail: { value }, bubbles: true, composed: true } ),
	);
}

let showPicker: ReturnType< typeof vi.fn >;

beforeEach( () => {
	stub = installOsSettingsStub( { accent: 'pulse', customAccent: '#f252fc' } );
	showPicker = vi.fn();
	// jsdom ships no showPicker; the section falls back to click()
	// without it, which would hide a broken call site.
	( HTMLInputElement.prototype as unknown as { showPicker: unknown } ).showPicker = showPicker;
} );

describe( 'the picker sits in the Custom swatch cell', () => {
	test( 'the cell is the last item of the accent row', () => {
		const grid = build().querySelector( 'os-swatch-grid' )!;
		const last = grid.lastElementChild!;
		expect( last.matches( CELL ) ).toBe( true );
		expect( last.querySelector( 'os-swatch' )!.getAttribute( 'value' ) ).toBe( CUSTOM_ACCENT_ID );
	} );

	test( 'the colour input is inside that cell, not beside the grid', () => {
		const input = build().querySelector< HTMLInputElement >( PICKER )!;
		expect( input.type ).toBe( 'color' );
		expect( input.closest( CELL ) ).not.toBeNull();
		expect( input.parentElement!.matches( CELL ) ).toBe( true );
	} );

	test( 'the input stays out of the tab order and the a11y tree', () => {
		const input = build().querySelector< HTMLInputElement >( PICKER )!;
		expect( input.getAttribute( 'tabindex' ) ).toBe( '-1' );
		expect( input.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
	} );
} );

describe( 'picking Custom opens the wheel without moving anything', () => {
	test( 'showPicker() is called on the anchored input, and the pick is written', () => {
		const el = build();
		pick( el, CUSTOM_ACCENT_ID );
		expect( showPicker ).toHaveBeenCalledTimes( 1 );
		expect( showPicker.mock.instances[ 0 ] ).toBe( el.querySelector( PICKER ) );
		expect( stub.updateOsSettings ).toHaveBeenCalledWith( { accent: CUSTOM_ACCENT_ID }, expect.anything() );
	} );

	test( 'no inline coordinates are written on the input', () => {
		const el = build();
		pick( el, CUSTOM_ACCENT_ID );
		const input = el.querySelector< HTMLInputElement >( PICKER )!;
		expect( input.style.left ).toBe( '' );
		expect( input.style.top ).toBe( '' );
	} );

	test( 'a preset leaves the wheel closed', () => {
		pick( build(), 'teal' );
		expect( showPicker ).not.toHaveBeenCalled();
		expect( stub.updateOsSettings ).toHaveBeenCalledWith( { accent: 'teal' }, expect.anything() );
	} );

	test( 'choosing a colour IS choosing the custom accent', () => {
		const input = build().querySelector< HTMLInputElement >( PICKER )!;
		input.value = '#123456';
		input.dispatchEvent( new Event( 'input' ) );
		expect( stub.updateOsSettings ).toHaveBeenCalledWith(
			{ customAccent: '#123456', accent: CUSTOM_ACCENT_ID },
			expect.anything(),
		);
	} );
} );

describe( 'the stylesheet holds up its half', () => {
	const css = readFileSync( join( __dirname, '../../apps/os-settings/os-settings.css' ), 'utf8' );

	test( 'the cell is a containing block and the input fills it', () => {
		expect( css ).toMatch( /\.os-settings__accent-custom\s*\{[^}]*position:\s*relative/ );
		expect( css ).toMatch( /\.os-settings__accent-picker\s*\{[^}]*position:\s*absolute/ );
		expect( css ).toMatch( /\.os-settings__accent-picker\s*\{[^}]*inset:\s*0/ );
	} );
} );
