/**
 * Unit tests for desktop-theme icon TINTING.
 *
 * A tint changes the rendering mode, not just the colour: an image
 * icon stops being an `<img>` and becomes a CSS mask filled with the
 * tint, so only its alpha survives. That is what makes a black
 * silhouette set legible on a dark dock instead of invisible — the
 * bug this feature exists to fix.
 *
 * The same cheap-path invariant as the icon resolver applies: with no
 * active theme, `resolveThemedIconColor()` returns `null` without
 * reaching the hook bus.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { FakeWpHooks } from './helpers/hooks-stub';
import { HOOKS } from '../../src/hooks';

import { getStore, normalizeEntry } from '../../src/desktop-themes/registry';
import { resolveThemedIconColor } from '../../src/desktop-themes/icons';
import { applyDesktopTheme } from '../../src/desktop-themes/apply';
import {
	applyIconMask,
	isMaskableIcon,
} from '../../src/desktop-themes/paint-tinted-icon';
import { renderIcon } from '../../src/icon';

let hooks: FakeWpHooks;

function seedTheme( iconColors: Record< string, string > ): void {
	const entry = normalizeEntry( {
		id: 'acme/neon',
		slug: 'acme-neon',
		name: 'Neon',
		version: '',
		author: '',
		description: '',
		previewUrl: '',
		cssUrl: '',
		cssText: ':root{}',
		tokens: {},
		fonts: [],
		icons: {
			OS_SETTINGS: 'https://x.test/settings.svg',
			RECYCLE_BIN: 'dashicons-trash',
		},
		iconColors,
		installedAt: 1,
		source: 'upload',
	} );
	getStore().setState( { themes: entry ? [ entry ] : [] } );
	applyDesktopTheme( 'acme-neon' );
}

beforeEach( () => {
	_resetAllSharedStoresForTests();
	hooks = installHooksStub();
	document.body.innerHTML = '';
	document.body.className = '';
} );

afterEach( () => {
	clearHooksStub();
	document.body.innerHTML = '';
} );

describe( 'resolveThemedIconColor', () => {
	test( 'returns null with no active theme, without touching the hook bus', () => {
		expect( resolveThemedIconColor( 'OS_SETTINGS' ) ).toBeNull();
		expect( hooks.didFilter( HOOKS.DESKTOP_THEME_ICON_COLOR ) ).toBe( 0 );
	} );

	test( 'returns the tint a theme declared for a slot', () => {
		seedTheme( { OS_SETTINGS: '#e9e7ff' } );
		expect( resolveThemedIconColor( 'OS_SETTINGS' ) ).toBe( '#e9e7ff' );
	} );

	test( 'returns null for a slot the theme left untinted', () => {
		seedTheme( { OS_SETTINGS: '#e9e7ff' } );
		expect( resolveThemedIconColor( 'RECYCLE_BIN' ) ).toBeNull();
	} );

	test( 'passes currentColor through — it is the adaptive value', () => {
		seedTheme( { OS_SETTINGS: 'currentColor' } );
		expect( resolveThemedIconColor( 'OS_SETTINGS' ) ).toBe( 'currentColor' );
	} );

	test( 'an empty slot name resolves to null', () => {
		seedTheme( { OS_SETTINGS: '#fff' } );
		expect( resolveThemedIconColor( '' ) ).toBeNull();
	} );

	test( 'deactivating the theme clears the tints', () => {
		seedTheme( { OS_SETTINGS: '#fff' } );
		applyDesktopTheme( '' );
		expect( resolveThemedIconColor( 'OS_SETTINGS' ) ).toBeNull();
	} );

	test( 'a filter may override the tint', () => {
		seedTheme( { OS_SETTINGS: '#fff' } );
		hooks.addFilter(
			HOOKS.DESKTOP_THEME_ICON_COLOR,
			'test',
			() => 'rgb( 1, 2, 3 )',
		);
		expect( resolveThemedIconColor( 'OS_SETTINGS' ) ).toBe( 'rgb( 1, 2, 3 )' );
	} );

	test( 'a filter cannot inject a second declaration', () => {
		seedTheme( { OS_SETTINGS: '#fff' } );
		hooks.addFilter(
			HOOKS.DESKTOP_THEME_ICON_COLOR,
			'test',
			() => '#fff; background: url( evil.png )',
		);
		expect( resolveThemedIconColor( 'OS_SETTINGS' ) ).toBeNull();
	} );

	test( 'a filter cannot return an unbalanced function', () => {
		seedTheme( { OS_SETTINGS: '#fff' } );
		hooks.addFilter( HOOKS.DESKTOP_THEME_ICON_COLOR, 'test', () => 'rgb( 1, 2' );
		expect( resolveThemedIconColor( 'OS_SETTINGS' ) ).toBeNull();
	} );
} );

describe( 'isMaskableIcon', () => {
	test( 'accepts http(s) and data image URLs', () => {
		expect( isMaskableIcon( 'https://x.test/a.svg' ) ).toBe( true );
		expect( isMaskableIcon( 'data:image/svg+xml;base64,AAAA' ) ).toBe( true );
	} );

	test( 'rejects anything that could close the url() string', () => {
		expect( isMaskableIcon( 'https://x.test/a".svg' ) ).toBe( false );
		expect( isMaskableIcon( 'https://x.test/a).svg' ) ).toBe( false );
		expect( isMaskableIcon( 'https://x.test/a b.svg' ) ).toBe( false );
	} );

	test( 'rejects non-image schemes and dashicons', () => {
		expect( isMaskableIcon( 'javascript:alert(1)' ) ).toBe( false );
		expect( isMaskableIcon( 'dashicons-trash' ) ).toBe( false );
		expect( isMaskableIcon( '' ) ).toBe( false );
	} );
} );

describe( 'applyIconMask', () => {
	test( 'paints the mask and the fill', () => {
		const el = document.createElement( 'span' );
		expect( applyIconMask( el, 'https://x.test/a.svg', '#e9e7ff' ) ).toBe( true );
		expect( el.style.backgroundColor ).toBeTruthy();
		expect( el.style.getPropertyValue( 'mask' ) ).toContain(
			'https://x.test/a.svg',
		);
		// A leftover background-image would show through the mask.
		expect( el.style.backgroundImage ).toBe( 'none' );
	} );

	test( 'refuses an unmaskable source and paints nothing', () => {
		const el = document.createElement( 'span' );
		expect( applyIconMask( el, 'dashicons-trash', '#fff' ) ).toBe( false );
		expect( el.style.getPropertyValue( 'mask' ) ).toBe( '' );
	} );
} );

describe( 'renderIcon with a tint', () => {
	test( 'paints an image slot as a mask, not an <img>', () => {
		seedTheme( { OS_SETTINGS: 'currentColor' } );
		const el = renderIcon( 'dashicons-admin-generic', {
			title: 'Settings',
			slot: 'OS_SETTINGS',
		} );

		expect( el.tagName ).toBe( 'SPAN' );
		expect( el.style.getPropertyValue( 'mask' ) ).toContain(
			'https://x.test/settings.svg',
		);
		expect( el.style.backgroundColor.toLowerCase() ).toBe( 'currentcolor' );
	} );

	test( 'tints a dashicon with plain color', () => {
		seedTheme( { RECYCLE_BIN: '#ff6b81' } );
		const el = renderIcon( 'dashicons-admin-generic', {
			title: 'Bin',
			slot: 'RECYCLE_BIN',
		} );

		expect( el.className ).toContain( 'dashicons-trash' );
		expect( el.style.color ).toBeTruthy();
		expect( el.style.getPropertyValue( 'mask' ) ).toBe( '' );
	} );

	test( 'an untinted slot still renders as an <img>', () => {
		seedTheme( {} );
		const el = renderIcon( 'x', { title: 'Settings', slot: 'OS_SETTINGS' } );
		expect( el.tagName ).toBe( 'IMG' );
	} );

	test( 'a tint with no glyph override recolours the shell own icon', () => {
		// The theme names a colour for a slot it does not replace —
		// "recolour every icon, replace none" is a legitimate theme.
		seedTheme( { FOLDER: '#3ae0ff' } );
		const el = renderIcon( 'https://x.test/folder.svg', {
			title: 'Folder',
			slot: 'FOLDER',
		} );

		expect( el.tagName ).toBe( 'SPAN' );
		expect( el.style.getPropertyValue( 'mask' ) ).toContain(
			'https://x.test/folder.svg',
		);
	} );

	test( 'an unmaskable icon falls through to its normal rendering', () => {
		seedTheme( { FOLDER: '#fff' } );
		// A letter-badge fallback value is not maskable; the tint must
		// not swallow the icon.
		const el = renderIcon( 'none', { title: 'My Plugin', slot: 'FOLDER' } );
		expect( el.className ).toContain( 'os-icon-letter' );
		expect( el.textContent ).toBe( 'MP' );
	} );

	test( 'costs nothing when no theme is active', () => {
		const el = renderIcon( 'dashicons-admin-generic', {
			title: 'Settings',
			slot: 'OS_SETTINGS',
		} );
		expect( el.className ).toContain( 'dashicons-admin-generic' );
		expect( hooks.didFilter( HOOKS.DESKTOP_THEME_ICON_COLOR ) ).toBe( 0 );
	} );
} );
