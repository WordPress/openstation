/**
 * Cross-bundle contract between the main-bundle `WindowManager` and
 * the lazy `window-system[.min].js` bundle that owns the `Window`
 * class implementation.
 *
 * The lazy bundle's entry (`./entry.ts`) publishes
 * `window.desktopModeWindowSystem` with this shape. The main-bundle
 * loader (`./loader.ts`) awaits the `<script>` load and reads the
 * factory; `WindowManager.open()` / `openNew()` then call
 * `createWindow( … )` to construct a real `Window` instance.
 *
 * Keep `WindowSystemApi`'s surface minimal — adding fields here
 * widens the contract between main and the lazy bundle, and every
 * field becomes a cross-bundle call point that has to be kept in
 * sync.
 */

import type { Window as DesktopWindow } from '../window';
import type { WindowConfig } from '../types';

export interface WindowSystemApi {
	/**
	 * Construct a fresh `Window` instance. Same shape as the
	 * `new Window( cfg )` call previously inlined in
	 * `WindowManager.createWindow()` — just sourced from the lazy
	 * bundle.
	 */
	createWindow( cfg: WindowConfig ): DesktopWindow;
}

declare global {
	// Augment the DOM `Window` (the browser global, not our class).
	// eslint-disable-next-line @typescript-eslint/no-shadow
	interface Window {
		desktopModeWindowSystem?: WindowSystemApi;
	}
}
