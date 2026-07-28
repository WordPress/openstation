/**
 * Desktop Mode — File conflict toast helper.
 *
 * When a PATCH /placements or PATCH /folders returns 409, the REST
 * client throws `FilesConflictError` carrying the actor and the
 * row's current state. This helper surfaces that as a toast with
 * a "View folder" action that hops the breadcrumb stack to the
 * row's new parent.
 */

import { showToast } from '../toast';
import { FilesConflictError } from './rest';
import type { Window as DesktopWindow } from '../window';

declare global {
	interface Window {
		desktopMode?: {
			windowManager?: {
				focus?: ( id: string ) => DesktopWindow | null;
				open?: ( id: string ) => Promise< DesktopWindow | null >;
			};
		};
	}
}

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
	if ( targetParentId > 0 ) {
		action = {
			label: 'View folder',
			onClick: () => {
				const winId = `desktop-mode-folder-${ targetParentId }`;
				const mgr = window.desktopMode?.windowManager;
				if ( mgr?.focus ) {
					const w = mgr.focus( winId );
					if ( w ) {
						return;
					}
				}
				if ( mgr?.open ) {
					void mgr.open( winId );
				}
			},
		};
	}

	showToast( {
		message: reason,
		action,
		duration: 7000,
	} );
}
