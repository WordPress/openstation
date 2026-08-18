/**
 * Accent color → the Custom swatch's colour wheel, and where it opens.
 *
 * The wheel is a browser popup and it anchors to the box of the
 * `<input type="color">` it belongs to. There is no argument to
 * `showPicker()` that says where to put it, so the only way to open it
 * on the Custom swatch is for the input to BE on the Custom swatch.
 *
 * It used to be a sibling of the swatch grid that JS measured and moved
 * with an inline `left`/`top` one line before calling `showPicker()`,
 * and the wheel opened under the FIRST swatch: a style written in the
 * same tick leaves layout dirty, and the popup is placed from the box
 * the browser has already computed: the input's static position, at
 * the start of the row. Nothing in the DOM looked wrong afterwards.
 *
 * jsdom has no layout, so these tests pin the two things that make the
 * CSS anchor work and that a refactor could quietly undo: the input
 * lives inside the Custom swatch's cell, and nothing writes inline
 * coordinates onto it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { buildAccentSection } from '../../src/settings/sections/accent';
import { CUSTOM_ACCENT_ID } from '../../src/settings/constants';
import type { SettingsCtx } from '../../src/settings/types';

const CELL = '.os-settings__accent-custom';
const PICKER = '.os-settings__accent-picker';

function ctxStub(): SettingsCtx {
	return {
		state: { accent: 'pulse', customAccent: '#f252fc' },
		save: vi.fn(),
		apply: vi.fn(),
	} as unknown as SettingsCtx;
}

/** Pick a swatch the way `<os-swatch>` does when a user clicks it. */
function pick( el: HTMLElement, value: string ): void {
	el.querySelector( 'os-swatch-grid' )!.dispatchEvent(
		new CustomEvent( 'os-pick', {
			detail: { value },
			bubbles: true,
			composed: true,
		} ),
	);
}

let showPicker: ReturnType< typeof vi.fn >;

beforeEach( () => {
	showPicker = vi.fn();
	// jsdom ships no showPicker; the section falls back to click()
	// without it, which would hide a broken call site.
	(
		HTMLInputElement.prototype as unknown as { showPicker: unknown }
	 ).showPicker = showPicker;
} );

describe( 'the picker sits in the Custom swatch cell', () => {
	test( 'the cell is the last item of the accent row', () => {
		const el = buildAccentSection( ctxStub() );
		const grid = el.querySelector( 'os-swatch-grid' )!;

		const last = grid.lastElementChild!;
		expect( last.matches( CELL ) ).toBe( true );
		expect(
			last.querySelector( 'os-swatch' )!.getAttribute( 'value' ),
		).toBe( CUSTOM_ACCENT_ID );
	} );

	test( 'the colour input is inside that cell, not beside the grid', () => {
		const el = buildAccentSection( ctxStub() );
		const input = el.querySelector< HTMLInputElement >( PICKER )!;

		expect( input.type ).toBe( 'color' );
		expect( input.closest( CELL ) ).not.toBeNull();
		// The old shape: a sibling of the grid, anchored to the section
		// wrapper. Anything positioned against the wrapper is one
		// reflow away from pointing at the wrong swatch.
		expect( input.parentElement!.matches( CELL ) ).toBe( true );
	} );

	test( 'the input stays out of the tab order and the a11y tree', () => {
		const el = buildAccentSection( ctxStub() );
		const input = el.querySelector< HTMLInputElement >( PICKER )!;

		// The Custom swatch is the control; the input is its anchor.
		expect( input.getAttribute( 'tabindex' ) ).toBe( '-1' );
		expect( input.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
	} );
} );

describe( 'picking Custom opens the wheel without moving anything', () => {
	test( 'showPicker() is called on the anchored input', () => {
		const el = buildAccentSection( ctxStub() );

		pick( el, CUSTOM_ACCENT_ID );

		expect( showPicker ).toHaveBeenCalledTimes( 1 );
		expect( showPicker.mock.instances[ 0 ] ).toBe(
			el.querySelector( PICKER ),
		);
	} );

	test( 'no inline coordinates are written on the input', () => {
		const el = buildAccentSection( ctxStub() );

		pick( el, CUSTOM_ACCENT_ID );

		const input = el.querySelector< HTMLInputElement >( PICKER )!;
		expect( input.style.left ).toBe( '' );
		expect( input.style.top ).toBe( '' );
	} );

	test( 'a preset leaves the wheel closed', () => {
		const el = buildAccentSection( ctxStub() );

		pick( el, 'teal' );

		expect( showPicker ).not.toHaveBeenCalled();
	} );
} );

describe( 'the stylesheet holds up its half', () => {
	const css = readFileSync(
		join( __dirname, '../../assets/css/os-settings.css' ),
		'utf8',
	);

	test( 'the cell is a containing block and the input fills it', () => {
		// Without `position` on the cell, the input resolves against
		// whatever ancestor is positioned instead and lands somewhere
		// arbitrary: the bug, back again, with the DOM still correct.
		expect( css ).toMatch(
			/\.os-settings__accent-custom\s*\{[^}]*position:\s*relative/,
		);
		expect( css ).toMatch(
			/\.os-settings__accent-picker\s*\{[^}]*position:\s*absolute/,
		);
		expect( css ).toMatch(
			/\.os-settings__accent-picker\s*\{[^}]*inset:\s*0/,
		);
	} );
} );
