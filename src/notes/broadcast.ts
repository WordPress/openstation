/**
 * OpenStation — Pinned notes change broadcast.
 *
 * The Recycle Bin badge counts deltas off `os.<post-type>.changed`,
 * one topic per type the bin captures. Notes never published it, so
 * trashing one moved the server's count and left the badge stale.
 *
 * Payload matches `broadcastFilesChange` in
 * `src/desktop-files/trash.ts`, so one subscriber handles both.
 */

import { NOTES_POST_TYPE } from './types';

type NotesChangeAction = 'trashed' | 'untrashed' | 'deleted';

/** No-ops before `wp.os` exists (boot ordering, tests). */
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
