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

/**
 * Structural slice of the public window manager, read off `wp.os`.
 *
 * `window.openStation` — which an earlier version of this module
 * declared and reached for — is not a global the shell ever defines;
 * the public namespace is `wp.os`. The optional chaining meant the
 * mismatch never threw, it just made "View folder" a button that did
 * nothing.
 */
interface WindowManagerSlice {
	getById?: ( id: string ) => { id: string } | undefined;
	focus?: ( winOrId: string ) => void;
}

function windowManager(): WindowManagerSlice | undefined {
	return (
		window.wp as { os?: { windowManager?: WindowManagerSlice } } | undefined
	)?.os?.windowManager;
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
	const winId = `os-folder-${ targetParentId }`;
	const mgr = windowManager();
	// Only offer the action when that folder's window is actually
	// open, so the button always does something. Opening a folder
	// window from scratch needs the full native render config that
	// `built-in-openers` owns, and that isn't reachable from a
	// `parentId` alone — the toast's message already names the
	// folder for that case.
	if (
		targetParentId > 0 &&
		typeof mgr?.focus === 'function' &&
		mgr.getById?.( winId )
	) {
		action = {
			label: 'View folder',
			onClick: () => mgr.focus?.( winId ),
		};
	}

	showToast( {
		message: reason,
		action,
		duration: 7000,
	} );
}
