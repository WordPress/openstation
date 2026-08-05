/**
 * OpenStation — Pinned notes change broadcast.
 *
 * The Recycle Bin badge keeps its count live by subscribing to
 * `os.<post-type>.changed` for every type the bin captures, and
 * `wpd_note` is one of them (it rides in `config.recycleBinPostTypes`
 * because the bin's capture list includes every non-builtin `show_ui`
 * type). Without this, trashing a note moved the server's count but
 * left the badge showing whatever it had at boot: the bin gained an
 * item and the dock never said so.
 *
 * Shape mirrors `broadcastFilesChange` in
 * `src/desktop-files/trash.ts` — same topic pattern, same
 * `{ source, action, ids }` payload, so the badge's one shared
 * subscriber handles both.
 */

import { NOTES_POST_TYPE } from './types';

type NotesChangeAction = 'trashed' | 'untrashed' | 'deleted';

/**
 * Announce a change to the bin-relevant state of one or more notes.
 * Safe before `wp.os` exists (boot ordering, tests) — no-ops.
 */
export function broadcastNotesChange(
	action: NotesChangeAction,
	ids: number[],
): void {
	if ( ids.length === 0 ) {
		return;
	}
	const api = (
		window as {
			wp?: { os?: { broadcast?: ( topic: string, payload: unknown ) => void } };
		}
	).wp?.os;
	api?.broadcast?.( `os.${ NOTES_POST_TYPE }.changed`, {
		source: 'desktop-mode/notes',
		action,
		ids,
	} );
}
