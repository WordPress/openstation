/**
 * Item-visibility-menu lazy bundle — loader (main-bundle side).
 *
 * The right-click visibility menu used to ship statically inside
 * `desktop.min.js` even though it can only appear after a user
 * interaction. This shim keeps the eager bundle down to a few
 * lines: on the first right-click it `<script>`-injects
 * `assets/js/item-visibility-menu[.min].js` (URL from
 * `openStationConfig.itemVisibilityMenuBundleUrl`), then forwards
 * the call to the API the bundle published on
 * `window.openStationItemVisibilityMenu`.
 *
 * Mirrors the shell-overlays loader's generation guard: if the user
 * right-clicks several tiles while the bundle is still in flight,
 * only the most recent call opens (the menu itself also closes any
 * predecessor, so this only avoids a flicker).
 */

import type {
	OpenItemVisibilityMenuOpts,
	OpenRailMenuOpts,
} from './item-visibility-menu';
import { loadVendorScript } from './wallpapers/vendor-loader';

interface MenuApi {
	openItemVisibilityMenu: ( opts: OpenItemVisibilityMenuOpts ) => void;
	openRailMenu: ( opts: OpenRailMenuOpts ) => void;
}

let generation = 0;

function loadedApi(): MenuApi | null {
	const w = window as unknown as {
		openStationItemVisibilityMenu?: MenuApi;
	};
	return w.openStationItemVisibilityMenu ?? null;
}

function bundleUrl(): string {
	const cfg = ( window as unknown as {
		openStationConfig?: { itemVisibilityMenuBundleUrl?: string };
	} ).openStationConfig;
	return cfg?.itemVisibilityMenuBundleUrl ?? '';
}

/**
 * Run `open` against the bundle's API, loading the bundle on first use.
 * A newer call supersedes one still waiting on the load.
 */
function withMenuApi( open: ( api: MenuApi ) => void ): void {
	const api = loadedApi();
	if ( api ) {
		open( api );
		return;
	}
	const url = bundleUrl();
	if ( ! url ) {
		// No URL configured — vitest / jsdom (no PHP shell config) or
		// a misconfigured deploy. Nothing sane to inject; stay silent
		// like a context menu on an inert element.
		return;
	}
	const myGen = ++generation;
	void loadVendorScript( url )
		.then( () => {
			if ( myGen !== generation ) {
				return;
			}
			const loaded = loadedApi();
			if ( loaded ) {
				open( loaded );
			}
		} )
		.catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[openstation] item-visibility-menu bundle failed to load; menu suppressed:',
					err,
				);
			}
		} );
}

/**
 * Open the visibility menu, loading its bundle on first use.
 *
 * Same signature and fire-and-forget semantics as the real
 * `openItemVisibilityMenu` — call sites (dock tiles, desktop icons)
 * are unchanged apart from the import path.
 *
 * @param opts Menu options (position, item id, surface, …).
 */
export function openItemVisibilityMenu(
	opts: OpenItemVisibilityMenuOpts,
): void {
	withMenuApi( ( api ) => api.openItemVisibilityMenu( opts ) );
}

/**
 * Open the rail's own menu (a right-click on the dock's empty space),
 * loading the bundle on first use.
 *
 * @param opts Cursor position and which rail was clicked.
 */
export function openRailMenu( opts: OpenRailMenuOpts ): void {
	withMenuApi( ( api ) => api.openRailMenu( opts ) );
}
