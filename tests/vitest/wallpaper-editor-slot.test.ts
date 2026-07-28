/**
 * Wallpaper editor slot — mounting `renderEditor` output into the OS
 * Settings panel.
 *
 * Covers the DESKMOD-51 regression: re-selecting a wallpaper with an
 * editor after having selected one without must re-render the editor
 * content, not just expand an empty slot. The original bug recycled
 * the slot's inner element across mounts; the framework `render()`
 * cache then took its update fast path against nodes a previous
 * `innerHTML = ''` had detached, and painted nothing.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { syncEditorSlot, teardownEditor } from '../../src/settings/sections/wallpaper';
import { html, render } from '../../src/ui/core';
import type { SettingsCtx } from '../../src/settings/types';
import type { WallpaperDef } from '../../src/wallpapers/types';

function ctxStub(): SettingsCtx {
	return {
		state: { wallpaper: 'test-editable' },
		activeEditorTeardown: null,
	} as unknown as SettingsCtx;
}

function slotElement(): HTMLElement {
	const slot = document.createElement( 'div' );
	slot.className = 'desktop-mode-os-settings__editor-slot';
	slot.dataset.expanded = 'false';
	const inner = document.createElement( 'div' );
	inner.className = 'desktop-mode-os-settings__editor-slot-inner';
	slot.appendChild( inner );
	document.body.appendChild( slot );
	return slot;
}

/**
 * Mirrors the custom-gradient editor: renders through the framework
 * templater with a stable call-site template, so repeated mounts into
 * a recycled container would hit the renderer's per-container cache.
 */
const paintEditor = ( container: HTMLElement, label: string ): void =>
	render( html`<span class="test-editor">${ label }</span>`, container );

function editableDef( teardown: () => void = () => {} ): WallpaperDef {
	return {
		id: 'test-editable',
		label: 'Editable',
		type: 'css',
		value: '#123',
		preview: '#123',
		renderEditor: ( container ) => {
			paintEditor( container, 'controls' );
			return teardown;
		},
	};
}

const plainDef: WallpaperDef = {
	id: 'test-plain',
	label: 'Plain',
	type: 'css',
	value: '#456',
	preview: '#456',
};

beforeEach( () => {
	installHooksStub();
} );

afterEach( () => {
	document.body.innerHTML = '';
	clearHooksStub();
} );

describe( 'wallpaper editor slot', () => {
	test( 'mounts the editor and expands the slot', () => {
		const ctx = ctxStub();
		const slot = slotElement();
		syncEditorSlot( ctx, slot, editableDef() );
		expect( slot.dataset.expanded ).toBe( 'true' );
		expect( slot.querySelector( '.test-editor' )?.textContent ).toBe(
			'controls',
		);
	} );

	test( 'collapses for a wallpaper without an editor', () => {
		const ctx = ctxStub();
		const slot = slotElement();
		syncEditorSlot( ctx, slot, editableDef() );
		syncEditorSlot( ctx, slot, plainDef );
		expect( slot.dataset.expanded ).toBe( 'false' );
		expect( slot.querySelector( '.test-editor' ) ).toBeNull();
	} );

	test( 're-selecting the editable wallpaper re-renders its content', () => {
		const ctx = ctxStub();
		const slot = slotElement();
		syncEditorSlot( ctx, slot, editableDef() );
		syncEditorSlot( ctx, slot, plainDef );
		// The regression: this third sync expanded the slot but left it
		// empty, because the recycled inner element still carried the
		// renderer's stale per-container cache.
		syncEditorSlot( ctx, slot, editableDef() );
		expect( slot.dataset.expanded ).toBe( 'true' );
		expect( slot.querySelector( '.test-editor' )?.textContent ).toBe(
			'controls',
		);
	} );

	test( 'tears down the previous editor before mounting the next', () => {
		const ctx = ctxStub();
		const slot = slotElement();
		const teardown = vi.fn();
		syncEditorSlot( ctx, slot, editableDef( teardown ) );
		expect( teardown ).not.toHaveBeenCalled();
		syncEditorSlot( ctx, slot, plainDef );
		expect( teardown ).toHaveBeenCalledTimes( 1 );
		// And the collapse path cleared the stored teardown — a later
		// explicit teardown must not double-invoke it.
		teardownEditor( ctx );
		expect( teardown ).toHaveBeenCalledTimes( 1 );
	} );
} );
