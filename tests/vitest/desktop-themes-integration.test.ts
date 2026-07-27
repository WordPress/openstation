/**
 * Integration tests for the desktop-theme substitution points.
 *
 * `src/desktop-themes/` can be perfectly correct and the feature can
 * still do nothing visible, because the value only lands where a
 * render path actually consults a slot. These tests pin the seams:
 * `renderIcon`, `<wpd-window-button icon-src>`, the OS-settings state
 * parser, and the live-refresh payload forwarding.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import { renderIcon } from '../../src/icon';
import { setDesktopThemes } from '../../src/desktop-themes/registry';
import { applyDesktopTheme } from '../../src/desktop-themes/apply';
import { createApplyPayload } from '../../src/menu-refresh-apply';
import type { MenuRefreshDeps } from '../../src/menu-refresh-apply';
import type { DesktopConfig } from '../../src/types';
import '../../src/ui/components/wpd-window-button/wpd-window-button';

function rawTheme( icons: Record< string, string > ) {
	return {
		id: 'acme/neon',
		slug: 'acme-neon',
		name: 'Neon',
		version: '1.0.0',
		author: '',
		description: '',
		previewUrl: '',
		cssUrl: 'https://x.test/theme.css',
		cssText: '',
		tokens: {},
		icons,
		installedAt: 1,
		source: 'upload' as const,
	};
}

function activate( icons: Record< string, string > ) {
	const shell = document.createElement( 'div' );
	shell.id = 'desktop-mode-shell';
	document.body.appendChild( shell );
	setDesktopThemes( [ rawTheme( icons ) ] );
	applyDesktopTheme( 'acme-neon' );
}

beforeEach( () => {
	installHooksStub();
	document.body.innerHTML = '';
	document.body.className = '';
	document.head.innerHTML = '';
	_resetAllSharedStoresForTests();
} );

afterEach( () => {
	clearHooksStub();
	_resetAllSharedStoresForTests();
} );

// ---------------------------------------------------------------
// renderIcon.
// ---------------------------------------------------------------

describe( 'renderIcon — slot substitution', () => {
	test( 'without a slot, behaviour is unchanged', () => {
		activate( { OS_SETTINGS: 'dashicons-themed' } );
		const el = renderIcon( 'dashicons-original', { title: 'Settings' } );
		expect( el.className ).toContain( 'dashicons-original' );
	} );

	test( 'with a slot and no theme, behaviour is unchanged', () => {
		const el = renderIcon( 'dashicons-original', {
			title: 'Settings',
			slot: 'OS_SETTINGS',
		} );
		expect( el.className ).toContain( 'dashicons-original' );
	} );

	test( 'a themed dashicon replaces the original', () => {
		activate( { OS_SETTINGS: 'dashicons-themed' } );
		const el = renderIcon( 'dashicons-original', {
			title: 'Settings',
			slot: 'OS_SETTINGS',
		} );
		expect( el.className ).toContain( 'dashicons-themed' );
		expect( el.className ).not.toContain( 'dashicons-original' );
	} );

	test( 'substitution happens BEFORE the shape dispatcher', () => {
		// A theme swapping a dashicon for a URL must get the <img>
		// branch — that only works if substitution precedes dispatch.
		activate( { OS_SETTINGS: 'https://x.test/settings.svg' } );
		const el = renderIcon( 'dashicons-original', {
			title: 'Settings',
			slot: 'OS_SETTINGS',
		} );
		expect( el.tagName ).toBe( 'IMG' );
		expect( ( el as HTMLImageElement ).src ).toBe( 'https://x.test/settings.svg' );
	} );

	test( 'an un-overridden slot leaves the original alone', () => {
		activate( { RECYCLE_BIN: 'dashicons-themed' } );
		const el = renderIcon( 'dashicons-original', {
			title: 'Settings',
			slot: 'OS_SETTINGS',
		} );
		expect( el.className ).toContain( 'dashicons-original' );
	} );
} );

// ---------------------------------------------------------------
// <wpd-window-button icon-src>.
// ---------------------------------------------------------------

describe( '<wpd-window-button icon-src>', () => {
	/** The component paints on a microtask; flush it. */
	async function flush() {
		await Promise.resolve();
		await Promise.resolve();
	}

	test( 'renders a currentColor-tinted mask span', async () => {
		const btn = document.createElement( 'wpd-window-button' );
		btn.setAttribute( 'icon-src', 'https://x.test/close.svg' );
		document.body.appendChild( btn );
		await flush();

		const span = btn.shadowRoot?.querySelector( '.themed-icon' ) as HTMLElement;
		expect( span ).toBeTruthy();
		// The `mask` shorthand is what makes the glyph inherit
		// `--wpd-btn-color`; an <img> would ignore it entirely.
		expect( span.getAttribute( 'style' ) ).toContain( 'https://x.test/close.svg' );
		expect( btn.shadowRoot?.querySelector( 'svg' ) ).toBeNull();
	} );

	test( 'icon-src takes precedence over icon', async () => {
		const btn = document.createElement( 'wpd-window-button' );
		btn.setAttribute( 'icon', 'close' );
		btn.setAttribute( 'icon-src', 'https://x.test/close.svg' );
		document.body.appendChild( btn );
		await flush();

		expect( btn.shadowRoot?.querySelector( '.themed-icon' ) ).toBeTruthy();
		expect( btn.shadowRoot?.querySelector( 'svg' ) ).toBeNull();
	} );

	test( 'falls back to the built-in icon when icon-src is absent', async () => {
		const btn = document.createElement( 'wpd-window-button' );
		btn.setAttribute( 'icon', 'close' );
		document.body.appendChild( btn );
		await flush();

		expect( btn.shadowRoot?.querySelector( '.themed-icon' ) ).toBeNull();
		expect( btn.shadowRoot?.querySelector( 'svg' ) ).toBeTruthy();
	} );

	test.each( [
		[ 'javascript scheme', 'javascript:alert(1)' ],
		[ 'relative path', '/icons/close.svg' ],
		[ 'quote breakout', "https://x.test/a'),url(//evil" ],
		[ 'paren breakout', 'https://x.test/a)x' ],
		[ 'whitespace', 'https://x.test/a b.svg' ],
		[ 'non-image data uri', 'data:text/html,<script>x</script>' ],
	] )( 'rejects %s', async ( _label, src ) => {
		const btn = document.createElement( 'wpd-window-button' );
		btn.setAttribute( 'icon', 'close' );
		btn.setAttribute( 'icon-src', src );
		document.body.appendChild( btn );
		await flush();

		expect( btn.shadowRoot?.querySelector( '.themed-icon' ) ).toBeNull();
		// Rejected values fall through to the built-in glyph rather
		// than leaving a blank button.
		expect( btn.shadowRoot?.querySelector( 'svg' ) ).toBeTruthy();
	} );

	test( 'accepts an image data URI', async () => {
		const btn = document.createElement( 'wpd-window-button' );
		btn.setAttribute( 'icon-src', 'data:image/svg+xml;base64,AAAA' );
		document.body.appendChild( btn );
		await flush();

		expect( btn.shadowRoot?.querySelector( '.themed-icon' ) ).toBeTruthy();
	} );
} );

// ---------------------------------------------------------------
// Live-refresh forwarding.
// ---------------------------------------------------------------

describe( 'menu-refresh-apply — serverDesktopThemes', () => {
	function makeDeps(
		overrides: Partial< MenuRefreshDeps > = {},
	): MenuRefreshDeps {
		const noop = () => {};
		const asyncNoop = async () => {};
		return {
			applyDockItems: noop,
			desktopArea: document.createElement( 'div' ),
			config: { dockItems: [] } as unknown as DesktopConfig,
			syncNativeWindows: asyncNoop,
			syncServerWidgets: asyncNoop,
			syncServerWallpapers: asyncNoop,
			syncServerCommands: asyncNoop,
			syncServerSettingsTabs: asyncNoop,
			syncServerTitleBarButtons: asyncNoop,
			syncServerUnfocusEffects: asyncNoop,
			syncServerWindowLinkRenderers: asyncNoop,
			syncServerDockRailRenderers: asyncNoop,
			syncServerGames: asyncNoop,
			renderIcons: noop,
			...overrides,
		} as MenuRefreshDeps;
	}

	/** The applier bails on an empty dock list, so every payload needs one. */
	const DOCK = [ { id: 'index-php', title: 'Dashboard' } ];

	test( 'forwards the payload key and mirrors it onto config', () => {
		const sync = vi.fn();
		const deps = makeDeps( { syncServerDesktopThemes: sync } );
		const apply = createApplyPayload( deps );

		const themes = [ rawTheme( {} ) ];
		apply( { dockItems: DOCK, serverDesktopThemes: themes } );

		expect( sync ).toHaveBeenCalledTimes( 1 );
		expect( sync ).toHaveBeenCalledWith( themes );
		expect( deps.config.serverDesktopThemes ).toBe( themes );
	} );

	test( 'a missing key means "no change", not "empty library"', () => {
		const sync = vi.fn();
		const apply = createApplyPayload(
			makeDeps( { syncServerDesktopThemes: sync } ),
		);
		apply( { dockItems: DOCK } );
		expect( sync ).not.toHaveBeenCalled();
	} );

	test( 'a non-array value is ignored', () => {
		const sync = vi.fn();
		const apply = createApplyPayload(
			makeDeps( { syncServerDesktopThemes: sync } ),
		);
		apply( { dockItems: DOCK, serverDesktopThemes: 'nope' } );
		expect( sync ).not.toHaveBeenCalled();
	} );

	test( 'callers that predate desktop themes still work', () => {
		// The dep is optional so older wiring (and tests) keep passing.
		const apply = createApplyPayload( makeDeps() );
		expect( () =>
			apply( { dockItems: DOCK, serverDesktopThemes: [ rawTheme( {} ) ] } ),
		).not.toThrow();
	} );
} );
