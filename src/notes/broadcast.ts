import { announceContentChange } from '../broadcast';
import { NOTES_POST_TYPE } from './types';

type NotesChangeAction = 'trashed' | 'untrashed' | 'deleted';

export function broadcastNotesChange(
	action: NotesChangeAction,
	ids: number[],
): void {
	announceContentChange( NOTES_POST_TYPE, action, ids, 'desktop-mode/notes' );
}
