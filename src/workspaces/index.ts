/**
 * Workspaces — barrel.
 *
 * Managing workspaces is an app (`apps/workspaces/`), not a module of
 * the shell: nothing here renders a form.
 */

export type {
	WorkspaceAppearance,
	WorkspaceAppearanceKey,
	WorkspaceApps,
	WorkspaceLaunch,
	WorkspaceLayoutId,
	WorkspaceNote,
	WorkspaceProfile,
	WorkspaceWidgets,
} from './types';
export {
	WORKSPACE_APPEARANCE_KEYS,
	WORKSPACE_LAYOUTS,
	WORKSPACE_MAX_WINDOWS,
	blankWorkspaceProfile,
} from './types';
export {
	itemMatchesToken,
	resolveAppIds,
	resolveLaunches,
	type ResolvedLaunch,
} from './match';
export {
	captureWorkspaceAppearance,
	withWorkspaceApp,
	withWorkspaceWidget,
	workspaceAppearance,
	workspaceMayHide,
	workspacePlacements,
	workspaceRestrictions,
	workspaceRestrictsItem,
	workspaceWidgetIds,
	type WorkspaceRestrictions,
} from './visibility';
export {
	absoluteAdminUrl,
	applyWorkspaceAppearance,
	applyWorkspaceLayout,
	applyWorkspaceView,
	applyWorkspaceWidgets,
	captureWorkspaceWindows,
	cloneDeskAsWorkspace,
	createWorkspace,
	getActiveWorkspaceProfile,
	getWorkspaceProfile,
	provisionWorkspace,
	reopenWorkspaceWindows,
	saveDeskToWorkspace,
	setWorkspaceProfile,
	type CloneDeskOptions,
	type CreateWorkspaceOptions,
	type SaveDeskOptions,
	type WorkspaceDeps,
} from './manager';
export { registerWorkspaceCommand } from './command';
export {
	installWorkspaceOverviewControl,
	isWorkspaceOverviewInstalled,
	manageWorkspaceFromOverview,
	restoreMainFromOverview,
	restoreWorkspace,
	createWorkspaceFromOverview,
	saveWorkspaceFromOverview,
	workspaceCanRestore,
	type WorkspaceOverviewDeps,
} from './overview-control';
export { isWorkspacePinned, workspacePin, type WorkspacePin } from './pin';
export {
	createWorkspacesApi,
	type WorkspacesApi,
	type WorkspacesApiOps,
} from './api';

export {
	registeredNativeWindows,
	workspaceAppCatalog,
	type NativeWindowRef,
	type WorkspaceApp,
} from './match';
