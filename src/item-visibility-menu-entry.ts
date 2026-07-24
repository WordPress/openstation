/**
 * Item-visibility-menu lazy bundle — entry.
 *
 * Builds to `assets/js/item-visibility-menu[.min].js`. The right-click
 * visibility menu (hide from dock / desktop, plugin provenance row,
 * deactivate action) is pure interaction UI that can never be on
 * screen at first paint, so it has no business shipping inside the
 * eager `desktop.min.js`. The main bundle keeps only the thin loader
 * shim (`src/item-visibility-menu-loader.ts`) that injects this
 * bundle on the first right-click and forwards the call.
 *
 * Publishes `window.desktopModeItemVisibilityMenu`. Cross-bundle
 * safety: the menu reads and writes OS-settings state exclusively
 * through the `wp.desktop` global shim (`getOsSettings` /
 * `updateOsSettings`), never through imported module state, so the
 * copy compiled here can't drift from the main bundle.
 *
 * @since 0.9.7
 */

import { openItemVisibilityMenu } from './item-visibility-menu';

( window as unknown as {
	desktopModeItemVisibilityMenu?: {
		openItemVisibilityMenu: typeof openItemVisibilityMenu;
	};
} ).desktopModeItemVisibilityMenu = { openItemVisibilityMenu };
