/**
 * OpenStation — Pinned notes change broadcast.
 *
 * The Recycle Bin's icon tracks deltas off `os.<post-type>.changed`,
 * one topic per type the bin captures, to know whether it is holding
 * anything. Notes never published it, so trashing one moved the
 * server's count while the bin still looked empty.
 *
 * Payload matches `broadcastFilesChange` in
 * `src/desktop-files/trash.ts`, so one subscriber handles both.
 */

import { announceContentChange } from '../broadcast';
import { NOTES_POST_TYPE } from './types';

type NotesChangeAction = 'trashed' | 'untrashed' | 'deleted';

/** Thin wrapper: one place owns the note type and the source tag. */
export function broadcastNotesChange(
	action: NotesChangeAction,
	ids: number[],
): void {
	announceContentChange( NOTES_POST_TYPE, action, ids, 'desktop-mode/notes' );
}
