/**
 * OpenStation — `file-drop[.min].js` bundle entry.
 *
 * The OS-file-drop machinery (confirmation dialog, progress HUD,
 * upload pipeline, media-library refresher) used to ride the main
 * shell bundle to every boot — ~28 KB of minified code for a gesture
 * most sessions never make. It now loads on the first dragenter that
 * carries files: `./sentinel.ts` (compiled into the shell) watches
 * for that, injects this bundle, boots it, and replays any drop that
 * landed while the fetch was in flight.
 *
 * The readiness contract mirrors the other lazy bundles: this entry
 * publishes the API on `window.openStationFileDrop`, and the
 * sentinel reads it after `loadVendorScript()` resolves. A flag the
 * bundle sets — never a tag or global sniff of someone else's making.
 */

import { bootOsFileDrop, replayCapturedDrop, routePickedFiles } from './index';
import type { CapturedDrop } from './index';

declare global {
	interface Window {
		openStationFileDrop?: {
			boot: typeof bootOsFileDrop;
			replayCapturedDrop: ( drop: CapturedDrop ) => void;
			routePickedFiles: typeof routePickedFiles;
		};
	}
}

window.openStationFileDrop = {
	boot: bootOsFileDrop,
	replayCapturedDrop,
	routePickedFiles,
};
