/**
 * What the overview top bar can do with workspaces.
 *
 * Overview is already the Spaces surface: it names every desk, renames
 * them, closes them, and adds new ones. Everything a workspace adds to
 * that — creating one, editing one, restoring one — belongs there and
 * nowhere else. The desk itself is the user's, and a shell affordance
 * parked on it is one more thing floating over their windows.
 *
 * There used to be a dropdown here as well as the `+`. Two doors to
 * the same room: the dropdown created desks from templates, the `+`
 * created a blank one without asking, and a user had to know which
 * did what. Now there is the `+`, and it opens the wizard — whose
 * first step is a blank desktop, preselected, one Enter away.
 *
 * ## The install seam
 *
 * `overview.ts` cannot construct workspace operations: it has a
 * `WindowManager` and nothing else. So the shell installs them once at
 * boot, and every export below answers `false` until it has — which is
 * what lets every existing overview test build the bar it always did,
 * and lets the `+` fall back to a plain new desk in a shell that never
 * wired the wizard.
 */

import type { Desktop } from '../types';
import type { WorkspaceDeps } from './manager';
import { applyWorkspaceView, provisionWorkspace } from './manager';

export interface WorkspaceOverviewDeps extends WorkspaceDeps {
	/** Open the wizard to create a desk. */
	openCreator: () => void;
	/** Open the wizard on an existing desk. */
	openEditor: ( desktopId: string ) => void;
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

/**
 * Open the wizard to create a desk. `false` when no shell has
 * installed it, which is the bar's cue to create a plain desk itself.
 */
export function createWorkspaceFromOverview(): boolean {
	if ( ! installed ) {
		return false;
	}
	installed.openCreator();
	return true;
}

/** Open the wizard on a desk. `false` when nothing is installed. */
export function editWorkspaceFromOverview( desktopId: string ): boolean {
	if ( ! installed ) {
		return false;
	}
	installed.openEditor( desktopId );
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
