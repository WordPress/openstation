/**
 * The wallpaper editor island — the one region of the Preferences
 * app its renderer never paints. `syncEditor()` mounts the selected
 * wallpaper's `renderEditor` into a fresh inner element after every
 * paint, and tears the previous one down first.
 *
 * A fresh element every time is the point: the framework's own
 * `render()` caches its mounted parts per container, so a
 * cleared-then-reused element takes the update fast path against
 * detached nodes and paints nothing — the "custom gradient can't be
 * edited after switching away and back" bug.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import * as registry from '../../src/wallpapers/registry';
import { html, render } from '../../src/ui/core';
import { mockViewContext } from '../../src/app-runtime/testing';
import { syncEditor, teardownEditor } from '../../apps/os-settings/parts/wallpaper';
import type { WallpaperDef } from '../../src/wallpapers/types';
import type { Ctx } from '../../apps/os-settings/parts/types';
import { installOsSettingsStub, type OsSettingsStub } from './helpers/os-settings-stub';
import { appData } from './helpers/os-settings-app';

let stub: OsSettingsStub;
let root: HTMLElement;
let ctx: Ctx;

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

const slot = (): HTMLElement => root.querySelector< HTMLElement >( '[data-os-editor-slot]' )!;

/** The user picks a wallpaper: the store changes, the app repaints. */
function select( id: string ): void {
	stub.state.wallpaper = id;
	syncEditor( ctx );
}

beforeEach( () => {
	installHooksStub();
	stub = installOsSettingsStub( { wallpaper: 'test-editable' } );
	root = document.createElement( 'div' );
	root.innerHTML = '<div class="os-settings__editor-slot" data-os-editor-slot></div>';
	document.body.appendChild( root );
	ctx = mockViewContext( { state: { tab: 'appearance' }, data: appData(), root } );
	registry.register( plainDef );
} );

afterEach( () => {
	for ( const def of registry.all() ) {
		if ( def.id.startsWith( 'test-' ) ) {
			registry.unregister( def.id );
		}
	}
	document.body.innerHTML = '';
	clearHooksStub();
} );

describe( 'wallpaper editor slot', () => {
	test( 'mounts the selected wallpaper\'s editor into a fresh inner element', () => {
		registry.register( editableDef() );
		syncEditor( ctx );
		expect( slot().querySelector( '.os-settings__editor-slot-inner' ) ).not.toBeNull();
		expect( slot().querySelector( '.test-editor' )?.textContent ).toBe( 'controls' );
	} );

	test( 'a wallpaper without an editor leaves the island empty', () => {
		registry.register( editableDef() );
		syncEditor( ctx );
		select( 'test-plain' );
		expect( slot().querySelector( '.test-editor' ) ).toBeNull();
	} );

	test( 're-selecting the editable wallpaper re-renders its content', () => {
		registry.register( editableDef() );
		syncEditor( ctx );
		select( 'test-plain' );
		// The regression: this third sync recycled the inner element,
		// which still carried the renderer's stale per-container cache,
		// and painted nothing.
		select( 'test-editable' );
		expect( slot().querySelector( '.test-editor' )?.textContent ).toBe( 'controls' );
	} );

	test( 'a repaint with the same selection leaves the editor alone', () => {
		const spy = vi.fn();
		registry.register( { ...editableDef(), renderEditor: ( c ) => {
			spy();
			paintEditor( c, 'controls' );
			return () => {};
		} } );
		syncEditor( ctx );
		syncEditor( ctx );
		expect( spy ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'tears down the previous editor before mounting the next', () => {
		const teardown = vi.fn();
		registry.register( editableDef( teardown ) );
		syncEditor( ctx );
		expect( teardown ).not.toHaveBeenCalled();
		select( 'test-plain' );
		expect( teardown ).toHaveBeenCalledTimes( 1 );
		// And the switch cleared the stored teardown — the window's own
		// teardown must not double-invoke it.
		teardownEditor( ctx );
		expect( teardown ).toHaveBeenCalledTimes( 1 );
	} );
} );
