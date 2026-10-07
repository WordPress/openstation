import type { Desktop } from '../types';
import { openWorkspaceWizard } from './wizard-loader';
import {
	captureWorkspaceWindows,
	createWorkspace,
	getActiveWorkspaceProfile,
	getWorkspaceProfile,
	provisionWorkspace,
	setWorkspaceProfile,
	applyWorkspaceLayout,
	type CreateWorkspaceOptions,
	type WorkspaceDeps,
} from './manager';
import {
	listWorkspacePresets,
	registerWorkspacePreset,
	unregisterWorkspacePreset,
} from './presets';
import type {
	WorkspaceLayoutId,
	WorkspacePreset,
	WorkspaceProfile,
} from './types';

export interface WorkspacesApi {

	list(): Desktop[];

	active(): Desktop | null;

	getProfile( desktopId: string ): WorkspaceProfile | null;

	setProfile( desktopId: string, profile: WorkspaceProfile | null ): boolean;

	create( options?: CreateWorkspaceOptions ): Desktop;

	switchTo( desktopId: string ): void;

	arrange( layout: WorkspaceLayoutId ): void;

	provision( desktopId: string, opts?: { force?: boolean } ): void;

	capture( desktopId: string ): WorkspaceProfile[ 'windows' ];

	captureAppearance(): WorkspaceProfile[ 'appearance' ];

	edit( desktopId: string ): void;

	openCreator(): void;

	saveDesk( desktopId?: string ): boolean;

	presets(): WorkspacePreset[];

	registerPreset( preset: WorkspacePreset ): void;

	unregisterPreset( id: string ): void;
}

export function createWorkspacesApi(
	deps: WorkspaceDeps,
	editWorkspace: ( desktopId: string ) => void,
	currentLook: () => WorkspaceProfile[ 'appearance' ] = () => ( {} ),
	openCreator: () => void = () => undefined,
	saveDesk: ( desktopId?: string ) => boolean = () => false,
): WorkspacesApi {
	return {
		list: () => deps.manager.getDesktops(),
		active: () => {
			const id = deps.manager.getActiveDesktopId();
			return deps.manager.getDesktops().find( ( d ) => d.id === id ) ?? null;
		},
		getProfile: ( desktopId ) =>
			getWorkspaceProfile( deps.manager, desktopId ),
		setProfile: ( desktopId, profile ) =>
			setWorkspaceProfile( deps, desktopId, profile ),
		create: ( options ) => createWorkspace( deps, options ),
		switchTo: ( desktopId ) => deps.manager.switchDesktop( desktopId ),
		arrange: ( layout ) => applyWorkspaceLayout( deps.manager, layout ),
		provision: ( desktopId, opts ) =>
			provisionWorkspace( deps, desktopId, opts ),
		capture: ( desktopId ) =>
			captureWorkspaceWindows( deps.manager, desktopId ),
		captureAppearance: currentLook,
		edit: editWorkspace,
		openCreator,
		saveDesk,
		presets: listWorkspacePresets,
		registerPreset: registerWorkspacePreset,
		unregisterPreset: unregisterWorkspacePreset,
	};
}

export { getActiveWorkspaceProfile, openWorkspaceWizard };
