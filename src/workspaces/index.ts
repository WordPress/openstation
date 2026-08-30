/**
 * Workspaces — barrel.
 *
 * The wizard is deliberately NOT re-exported here: it lives in its own
 * lazy bundle and pulling it through the barrel would drag
 * `<os-modal>`, `<os-steps>`, `<os-card>` and the picker kit into
 * whatever imported "just the types". Reach for `./wizard-loader`
 * instead.
 */

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
