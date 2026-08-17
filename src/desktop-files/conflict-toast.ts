/**
 * OpenStation — File conflict toast helper.
 *
 * When a PATCH /placements or PATCH /folders returns 409, the REST
 * client throws `FilesConflictError` carrying the actor and the
 * row's current state. This helper surfaces that as a toast with
 * a "View folder" action that hops the breadcrumb stack to the
 * row's new parent.
 */

import { showToast } from '../toast';
import { FilesConflictError } from './rest';
import { folderFileById } from './folder-ref';
import { openFile } from './open';

export function isConflict( err: unknown ): err is FilesConflictError {
	return err instanceof FilesConflictError;
}

/**
 * Show a conflict toast. Generic — works for placements and folders.
 * The "View folder" action opens / focuses the target folder window
 * when the conflict's `current.parentId` resolves to a real folder.
 */
function buildReason( err: FilesConflictError ): string {
	const actor = err.detail.actor.name || 'Someone else';
	const where = err.detail.current.parentName || 'another folder';
	if ( err.detail.reason === 'trashed' ) {
		return 'This item is in the recycle bin.';
	}
	if ( err.detail.reason === 'forbidden' ) {
		return 'You no longer have access.';
	}
	if ( err.detail.reason === 'gone' ) {
		return 'This item was deleted.';
	}
	return `${ actor } moved this to "${ where }".`;
}

export function showConflictToast( err: FilesConflictError ): void {
	const reason = buildReason( err );
	const targetParentId = err.detail.current.parentId;
	let action: { label: string; onClick: () => void } | undefined;
	// Folder 0 is the desktop root — already on screen, nothing to
	// open, so no button. Every real folder gets one.
	if ( targetParentId > 0 ) {
		action = {
			label: 'View folder',
			// Dispatched through the ordinary opener registry, so the
			// folder window this builds is the same one a double-click
			// on the folder's tile builds — breadcrumb stack, split
			// preview pane, "· Shared" title cue and all. Reusing the
			// registered opener is also what makes an already-open
			// folder window focus rather than reopen: `openFile()` ends
			// at `windowManager.open()`, which reuses by id.
			//
			// `folderFileById` is the bridge from what a conflict knows
			// (an id and a name) to what an opener wants (a
			// DesktopFile).
			onClick: () => {
				void openFile(
					folderFileById(
						targetParentId,
						err.detail.current.parentName,
					),
				);
			},
		};
	}

	showToast( {
		message: reason,
		action,
		duration: 7000,
	} );
}
