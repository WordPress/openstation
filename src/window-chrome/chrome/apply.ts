/**
 * Custom-chrome mounter — Layer 4 of the chrome framework.
 *
 * **Experimental.** The chrome render contract may change. Layers
 * 1-3 are the stable surface for theme / control / slot
 * customization; reach for Layer 4 only when nothing else fits.
 *
 * The framework owns the outer window element, the body, the
 * resize handles, drag, focus, lifecycle, and position persistence.
 * A registered chrome's `render()` callback owns the title-bar
 * tree (everything inside the host that ISN'T the body or the
 * resize handles).
 *
 * `'core/standard'` is the implicit default. Selecting it means
 * "don't run any chrome render" — the standard title bar painted
 * by `createWindowElement()` + Layers 1-3 stays put. Selecting any
 * other registered chrome calls its `render()` once, captures the
 * returned handle, and routes window-state updates through the
 * handle's `update()`.
 */

import { applyFilters, doAction, HOOKS } from '../../hooks';
import {
	getWindowChrome,
	type ChromeRenderHandle,
	type ChromeRenderState,
} from './registry';

import type { Window as DesktopWindow } from '../../window';

export const STANDARD_CHROME_ID = 'core/standard';

/**
 * Class added to the outer `.desktop-mode-window` element while a
 * non-standard chrome is mounted. The companion CSS rule in
 * `assets/css/window-chrome.css` hides every direct child of the
 * titlebar that carries `data-desktop-mode-default-chrome` — which
 * is the framework-shipped icon, title, controls, slots, etc.
 *
 * This is the load-bearing guarantee that the default chrome NEVER
 * peeks through a custom one. Plugins that follow the docs example
 * (`titlebar.innerHTML = ''`) wipe the default children at render
 * time; this class additionally protects plugins that DON'T clear
 * — they layer their UI alongside the default and rely on z-index
 * — from a flash of default chrome at any point in the window's
 * lifecycle.
 *
 * @internal
 */
export const CUSTOM_CHROME_CLASS = 'desktop-mode-window--custom-chrome';

/**
 * Resolve the chrome id for a window, passing it through the
 * `desktop-mode.window.chrome.render` filter. Defaults to
 * `'core/standard'` when no override / filter intervenes.
 *
 * @internal
 */
export function resolveChromeId( win: DesktopWindow ): string {
	const inline = win.config.appearance?.chrome ?? STANDARD_CHROME_ID;
	const id = applyFilters<
		string,
		[ { windowId: string; config: DesktopWindow[ 'config' ] } ]
	>(
		HOOKS.WINDOW_CHROME_RENDER,
		inline,
		{ windowId: win.id, config: win.config },
	);
	return id;
}

/**
 * Build the chrome render state from a window's current state.
 */
export function captureChromeState( win: DesktopWindow ): ChromeRenderState {
	return {
		title: win.config.title,
		icon: win.config.icon,
		focused: win.element.classList.contains( 'desktop-mode-window--focused' ),
		state: win.state,
	};
}

/**
 * Mount a registered chrome on a window, replacing whatever the
 * standard chrome painted. Returns the handle for `update()` /
 * `destroy()` calls. When the resolved chrome id is
 * `'core/standard'` or no chrome is registered under the resolved
 * id, returns `null` and leaves the standard chrome in place.
 *
 * @internal
 */
export function mountWindowChrome(
	win: DesktopWindow,
): { id: string; handle: ChromeRenderHandle } | null {
	const id = resolveChromeId( win );
	if ( id === STANDARD_CHROME_ID ) {
		return null;
	}
	const def = getWindowChrome( id );
	if ( ! def ) {
		// No registration matched — fall back to standard. Plugins
		// that register chromes lazily can rely on the chrome-registry
		// subscribe path to remount when their definition lands.
		return null;
	}
	try {
		if ( def.match && ! def.match( win ) ) {
			return null;
		}
	} catch {
		return null;
	}
	// Stamp the marker class BEFORE the plugin's render() runs.
	// Default chrome children get hidden by CSS the moment the
	// class lands, so the plugin paints onto a clean titlebar
	// without the user ever seeing a frame of double-chrome (the
	// shipped chrome briefly visible underneath the plugin's
	// painting). Class is removed only when the chrome is swapped
	// or destroyed — see `Window.remountWindowChrome` and the
	// chrome teardown path in `Window.close()`.
	win.element.classList.add( CUSTOM_CHROME_CLASS );
	let handle: ChromeRenderHandle;
	try {
		handle = def.render( win.element, {
			window: win,
			state: captureChromeState( win ),
		} );
	} catch ( err ) {
		// Plugin failed to render — pull the marker class so the
		// default chrome becomes visible again rather than leaving
		// the titlebar empty.
		win.element.classList.remove( CUSTOM_CHROME_CLASS );
		doAction( HOOKS.SHELL_ERROR, {
			scope: 'window-chrome-render',
			windowId: win.id,
			chromeId: id,
			error: err,
		} );
		return null;
	}
	doAction( HOOKS.WINDOW_CHROME_APPLIED, {
		windowId: win.id,
		layer: 'chrome',
		chromeId: id,
	} );
	return { id, handle };
}
