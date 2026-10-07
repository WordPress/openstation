import { showToast } from '../toast';
import { FilesConflictError } from './rest';
import { folderFileById } from './folder-ref';
import { openFile } from './open';

export function isConflict( err: unknown ): err is FilesConflictError {
	return err instanceof FilesConflictError;
}

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

	if ( targetParentId > 0 ) {
		action = {
			label: 'View folder',

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
