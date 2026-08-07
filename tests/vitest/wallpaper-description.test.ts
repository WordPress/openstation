/**
 * Wallpaper `description` — the OS Settings card describing the active
 * wallpaper, and the PHP → JS overlay path that feeds it.
 *
 * Covers: the description card renders (label + text) for the selected
 * def, collapses when the selection has none, and the server-sync
 * bridges a server-registered `description` onto both CSS-entry defs
 * and script-published canvas defs that didn't set their own.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { createWallpaperRegistrySync } from '../../src/wallpapers/server-sync';
import * as registry from '../../src/wallpapers/registry';
import { syncWallpaperDescription } from '../../src/settings/sections/wallpaper';
import type { SettingsCtx } from '../../src/settings/types';
import type { DesktopWallpaperServerEntry } from '../../src/types';
import type { OsSettings } from '../../src/settings';

function ctxFor( wallpaper: string ): SettingsCtx {
	return { state: { wallpaper } } as unknown as SettingsCtx;
}

function slotElement(): HTMLElement {
	const slot = document.createElement( 'div' );
	slot.dataset.expanded = 'false';
	slot.appendChild( document.createElement( 'div' ) );
	document.body.appendChild( slot );
	return slot;
}

function serverEntry(
	overrides: Partial< DesktopWallpaperServerEntry >,
): DesktopWallpaperServerEntry {
	return {
		id: 'test-desc',
		label: 'Test',
		preview: '#123456',
		type: 'css',
		value: '#123456',
		scriptUrl: '',
		scriptHandle: '',
		...overrides,
	};
}

const osSettingsStub = { apply() {} } as unknown as OsSettings;

beforeEach( () => {
	installHooksStub();
} );

afterEach( () => {
	for ( const def of registry.all() ) {
		if ( def.id.startsWith( 'test-' ) ) {
			registry.unregister( def.id );
		}
	}
	document.body.innerHTML = '';
	delete ( window as { openStationWallpapers?: unknown } ).openStationWallpapers;
	clearHooksStub();
} );

describe( 'wallpaper description card', () => {
	test( 'renders the selected wallpaper’s label + description and expands', () => {
		registry.register( {
			id: 'test-desc',
			label: 'Dusk',
			type: 'css',
			value: '#112233',
			preview: '#112233',
			description: 'A quiet dusk gradient for late sessions.',
		} );
		const slot = slotElement();
		syncWallpaperDescription( ctxFor( 'test-desc' ), slot );

		expect( slot.dataset.expanded ).toBe( 'true' );
		expect( slot.textContent ).toContain( 'Dusk' );
		expect( slot.textContent ).toContain( 'A quiet dusk gradient' );
		expect( slot.querySelector( 'os-icon' ) ).not.toBeNull();
	} );

	test( 'collapses when the selected wallpaper has no description', () => {
		registry.register( {
			id: 'test-mute',
			label: 'Mute',
			type: 'css',
			value: '#111',
			preview: '#111',
		} );
		const slot = slotElement();
		slot.dataset.expanded = 'true';
		syncWallpaperDescription( ctxFor( 'test-mute' ), slot );
		expect( slot.dataset.expanded ).toBe( 'false' );
	} );

	test( 'renders plain text — markup in a description does not become DOM', () => {
		registry.register( {
			id: 'test-xss',
			label: 'Sneaky',
			type: 'css',
			value: '#111',
			preview: '#111',
			description: '<img src=x onerror=alert(1)>calm',
		} );
		const slot = slotElement();
		syncWallpaperDescription( ctxFor( 'test-xss' ), slot );
		expect( slot.querySelector( 'img' ) ).toBeNull();
		expect( slot.textContent ).toContain( 'calm' );
	} );
} );

describe( 'wallpaper description server overlay', () => {
	test( 'a CSS server entry carries its description into the registry def', async () => {
		const sync = createWallpaperRegistrySync( { osSettings: osSettingsStub } );
		await sync( [
			serverEntry( { description: 'Server-side story.' } ),
		] );
		expect( registry.get( 'test-desc' )?.description ).toBe(
			'Server-side story.',
		);
	} );

	test( 'a script-published canvas def inherits the server description when it has none', async () => {
		( window as {
			openStationWallpapers?: Record< string, unknown >;
		} ).openStationWallpapers = {
			'test-canvas': {
				id: 'test-canvas',
				label: 'Canvas',
				type: 'canvas',
				preview: '#000',
				mount: () => () => {},
			},
		};
		const sync = createWallpaperRegistrySync( { osSettings: osSettingsStub } );
		await sync( [
			serverEntry( {
				id: 'test-canvas',
				type: 'canvas',
				value: '',
				description: 'Told by PHP, translatable.',
			} ),
		] );
		expect( registry.get( 'test-canvas' )?.description ).toBe(
			'Told by PHP, translatable.',
		);
	} );

	test( 'a def that sets its own description wins over the server value', async () => {
		( window as {
			openStationWallpapers?: Record< string, unknown >;
		} ).openStationWallpapers = {
			'test-canvas': {
				id: 'test-canvas',
				label: 'Canvas',
				type: 'canvas',
				preview: '#000',
				description: 'JS knows best.',
				mount: () => () => {},
			},
		};
		const sync = createWallpaperRegistrySync( { osSettings: osSettingsStub } );
		await sync( [
			serverEntry( {
				id: 'test-canvas',
				type: 'canvas',
				value: '',
				description: 'Server fallback.',
			} ),
		] );
		expect( registry.get( 'test-canvas' )?.description ).toBe( 'JS knows best.' );
	} );
} );
