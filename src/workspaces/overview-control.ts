/**
 * What the overview top bar can do with workspaces.
 *
 * Overview is already the Spaces surface: it names every desk, renames
 * them, closes them, and adds new ones. What a workspace adds to that
 * lives under the tiles:
 *
 *   - **Save as new workspace**, a tile in the row — the one way a
 *     workspace is made: set the main desk up, save it, and a new desk
 *     carries it.
 *   - **Manage** under a workspace — the Workspaces app, where it is
 *     renamed, shared and deleted and where its recipients are listed.
 *   - **Restore** under a workspace with something to restore.
 *
 * The `+` makes a plain desk and nothing else. It used to open a
 * wizard that built a workspace from a form; a workspace is now
 * something you arrange and keep, never something you describe.
 *
 * ## The install seam
 *
 * `overview.ts` cannot construct workspace operations: it has a
 * `WindowManager` and nothing else. So the shell installs them once at
 * boot, and every export below answers `false` until it has — which is
 * what lets every existing overview test build the bar it always did.
 */

import type { Desktop } from '../types';
import type { WorkspaceDeps } from './manager';
import { applyWorkspaceView, provisionWorkspace } from './manager';

export interface WorkspaceOverviewDeps extends WorkspaceDeps {
	/**
	 * Clone a desk into a new workspace; null when nothing was saved.
	 * `announce: false` skips the "Saved as…" toast, for a caller that
	 * shows the new workspace itself.
	 */
	saveAsWorkspace: ( sourceId: string, opts?: { announce?: boolean } ) => { id: string } | null;
	/** Open the Workspaces app, on this desk. */
	openManager: ( desktopId: string ) => void;
	/** Put the main desk back the way a fresh install starts it. Asks first. */
	restoreMain?: () => void;
}

let installed: WorkspaceOverviewDeps | null = null;

/**
 * Give the overview bar the workspace operations it cannot build
 * itself. Called once from the shell boot; returns a teardown so a
 * discarded shell leaves nothing behind.
 */
export function installWorkspaceOverviewControl(
	deps: WorkspaceOverviewDeps,
): () => void {
	installed = deps;
	return () => {
		installed = null;
	};
}

/** Whether a shell has installed the operations. */
export function isWorkspaceOverviewInstalled(): boolean {
	return null !== installed;
}

/** Clone a desk into a new workspace. `false` when nothing is installed or saved. */
export function saveWorkspaceFromOverview( desktopId: string ): boolean {
	return !! installed?.saveAsWorkspace( desktopId );
}

/**
 * "Create a workspace" in Overview: save the main desk as a new
 * workspace, then open the Workspaces app on it — so the click visibly
 * made something, and the next step (name it, share it) is right there.
 * If nothing could be saved, the app opens on the main desk's card,
 * which says why. `false` when nothing is installed.
 */
export function createWorkspaceFromOverview( mainId: string ): boolean {
	if ( ! installed ) {
		return false;
	}
	const created = installed.saveAsWorkspace( mainId, { announce: false } );
	installed.openManager( created?.id ?? mainId );
	return null !== created;
}

/** Restore the main desk to its fresh-install state. `false` when nothing is installed. */
export function restoreMainFromOverview(): boolean {
	if ( ! installed?.restoreMain ) {
		return false;
	}
	installed.restoreMain();
	return true;
}

/** Open the Workspaces app on a desk. `false` when nothing is installed. */
export function manageWorkspaceFromOverview( desktopId: string ): boolean {
	if ( ! installed ) {
		return false;
	}
	installed.openManager( desktopId );
	return true;
}

/**
 * Whether this desk has a workspace worth restoring TO.
 *
 * A plain Space has nothing stored, and neither does a workspace whose
 * profile says nothing beyond its name and colour — offering "Restore"
 * on either would be a button that visibly does nothing, which is
 * worse than no button. So the affordance appears exactly where it has
 * work to do: windows to reopen, a column to remount, a look to
 * repaint, or an arrangement to re-run.
 */
export function workspaceCanRestore( desktop: Desktop ): boolean {
	const profile = desktop.profile;
	if ( ! profile ) {
		return false;
	}
	return (
		profile.windows.length > 0 ||
		'free' !== profile.layout ||
		'only' === profile.widgets?.mode ||
		Object.keys( profile.appearance ?? {} ).length > 0
	);
}

/**
 * Put a desk back the way its workspace defines it.
 *
 * The counterpart to the wizard's "Use the … I have now" captures: one
 * saves the desk into the workspace, this applies the workspace back
 * onto the desk. Reopens the windows it names, remounts its column,
 * repaints its look, re-runs its arrangement.
 *
 * Reopening is `force`d because the whole point is a desk the user has
 * since tidied — the once-per-workspace guard exists to stop the shell
 * reopening windows on its own, not to stop the user asking. Windows
 * still open reuse their existing instance rather than doubling, so
 * restoring a desk that is already intact just brings it to order.
 *
 * Returns whether it ran, so the caller can leave overview only on a
 * restore that happened.
 */
export function restoreWorkspace( desktopId: string ): boolean {
	const deps = installed;
	if ( ! deps ) {
		return false;
	}
	// Switch first: every step below acts on the active desk, and
	// restoring one the user is not standing on would repaint the desk
	// in front of them with another workspace's look.
	deps.manager.switchDesktop( desktopId );
	applyWorkspaceView( deps, desktopId );
	provisionWorkspace( deps, desktopId, { force: true } );
	return true;
}
