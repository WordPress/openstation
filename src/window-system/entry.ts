/**
 * Lazy `window-system` bundle entry.
 *
 * Compiled by Vite (target `window-system`) into
 * `assets/js/window-system[.min].js`. Bundles the `Window` class
 * (`src/window/index.ts`) plus its DOM / pointer / tab / chrome
 * helpers — the single largest module in the pre-0.8.4 main bundle
 * (~68 kB pre-min).
 *
 * Loaded by the main-bundle loader (`./loader.ts`) on demand —
 * triggered by the first call to `WindowManager.open()` or
 * `openNew()`. Publishes a factory on
 * `window.desktopModeWindowSystem` and main's loader reads it after
 * the `<script>` load event fires.
 *
 * @since 0.8.4
 */

import { Window } from '../window';
import type { WindowSystemApi } from './types';

// Side-effect-import every component the Window class instantiates
// via `document.createElement`. Without these the tags upgrade only
// when something else loads them (shell-overlays, etc.); a window
// opened before that other thing loads ships title-bar buttons as
// inert HTML. The bundle pays a few KB to make this race-free.
import '../ui/components/wpd-window-button/wpd-window-button';
import '../ui/components/wpd-save-status/wpd-save-status';
import '../ui/components/wpd-spinner/wpd-spinner';
import '../ui/components/wpd-menu/wpd-menu';
import '../ui/components/wpd-tab-chip/wpd-tab-chip';

const factory: WindowSystemApi = {
	createWindow( cfg ) {
		return new Window( cfg );
	},
};

window.desktopModeWindowSystem = factory;
