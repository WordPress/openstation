/**
 * OpenStation — `notes[.min].js` bundle entry.
 *
 * Pinned desktop notes are presence-gated: ~31 KB of minified layer,
 * motion and drop plumbing that only matters to users who HAVE notes
 * (or are about to create their first). `./sentinel.ts` (in the
 * shell bundle) loads this when the boot config says notes exist,
 * and on the gestures that would mint one — the wallpaper-menu "New
 * note", a note announced by the Note Pad widget, an internal drag
 * that could become a post→note conversion.
 */

import { bootNotes } from './index';

declare global {
	interface Window {
		openStationNotes?: {
			boot: typeof bootNotes;
		};
	}
}

window.openStationNotes = {
	boot: bootNotes,
};
