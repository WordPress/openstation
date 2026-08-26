/**
 * OpenStation — `window-link-visuals[.min].js` bundle entry.
 *
 * The window-link RENDER side: the render host, its geometry, and
 * the built-in `svg-splines` renderer — ~14 KB minified that only
 * matters once two windows actually share a relation group. The
 * relations ENGINE stays in the shell (it tracks per-window content
 * identity continuously); `src/desktop.ts` loads this bundle on the
 * first `os.window-links.groups-changed` that carries a group and
 * starts the host through the API published here.
 *
 * The renderer REGISTRY is `createSharedStore`-backed, so the
 * `svg-splines` registration this bundle performs on load is visible
 * to the shell and to plugin renderer bundles alike.
 */

import { startWindowLinkRenderHost } from './render-host';

declare global {
	interface Window {
		openStationWindowLinkVisuals?: {
			start: typeof startWindowLinkRenderHost;
		};
	}
}

window.openStationWindowLinkVisuals = {
	start: startWindowLinkRenderHost,
};
