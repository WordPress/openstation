export type {
	WorkspaceAppearance,
	WorkspaceAppearanceKey,
	WorkspaceApps,
	WorkspaceLaunch,
	WorkspaceLayoutId,
	WorkspacePreset,
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
	findWorkspacePreset,
	listWorkspacePresets,
	registerWorkspacePreset,
	unregisterWorkspacePreset,
	workspaceProfileFromPreset,
} from './presets';
export {
	captureWorkspaceAppearance,
	withWorkspaceApp,
	withWorkspaceWidget,
	workspaceAppearance,
	workspaceMayHide,
	workspacePlacements,
	workspaceWidgetIds,
} from './visibility';
export {
	absoluteAdminUrl,
	applyWorkspaceAppearance,
	applyWorkspaceLayout,
	applyWorkspaceView,
	applyWorkspaceWidgets,
	captureWorkspaceWindows,
	createWorkspace,
	getActiveWorkspaceProfile,
	getWorkspaceProfile,
	provisionWorkspace,
	reopenWorkspaceWindows,
	saveDeskToWorkspace,
	setWorkspaceProfile,
	type CreateWorkspaceOptions,
	type SaveDeskOptions,
	type WorkspaceDeps,
} from './manager';
export { registerWorkspaceCommand } from './command';
export {
	createWorkspaceFromOverview,
	editWorkspaceFromOverview,
	installWorkspaceOverviewControl,
	isWorkspaceOverviewInstalled,
	restoreWorkspace,
	workspaceCanRestore,
	type WorkspaceOverviewDeps,
} from './overview-control';
export { createWorkspacesApi, type WorkspacesApi } from './api';
export {
	applyServerWorkspacePresets,
	installWorkspacePresetSync,
	type WorkspacePresetServerEntry,
} from './server-sync';
