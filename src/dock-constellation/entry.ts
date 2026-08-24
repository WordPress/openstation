/**
 * OpenStation — `dock-constellation[.min].js` bundle entry.
 *
 * The dock's hover-submenu flyout (~11 KB minified) is pure hover
 * UI: nothing about it is needed until a pointer actually enters a
 * dock rail. The sentinel in `src/desktop.ts` loads this bundle on
 * that first pointerover and mounts through the API published here —
 * the flyout's own hover-intent delay covers the one-time fetch.
 */

import { mountDockConstellation } from './index';

declare global {
	interface Window {
		openStationDockConstellation?: {
			mount: typeof mountDockConstellation;
		};
	}
}

window.openStationDockConstellation = {
	mount: mountDockConstellation,
};
