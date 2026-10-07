import type { Desktop } from '../types';
import type { WorkspaceDeps } from './manager';
import { applyWorkspaceView, provisionWorkspace } from './manager';

export interface WorkspaceOverviewDeps extends WorkspaceDeps {

	openCreator: ( desktopId: string ) => void;

	openEditor: ( desktopId: string ) => void;
}

let installed: WorkspaceOverviewDeps | null = null;

export function installWorkspaceOverviewControl(
	deps: WorkspaceOverviewDeps,
): () => void {
	installed = deps;
	return () => {
		installed = null;
	};
}

export function isWorkspaceOverviewInstalled(): boolean {
	return null !== installed;
}

export function createWorkspaceFromOverview( desktopId: string ): boolean {
	if ( ! installed ) {
		return false;
	}
	installed.openCreator( desktopId );
	return true;
}

export function editWorkspaceFromOverview( desktopId: string ): boolean {
	if ( ! installed ) {
		return false;
	}
	installed.openEditor( desktopId );
	return true;
}

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

export function restoreWorkspace( desktopId: string ): boolean {
	const deps = installed;
	if ( ! deps ) {
		return false;
	}

	deps.manager.switchDesktop( desktopId );
	applyWorkspaceView( deps, desktopId );
	provisionWorkspace( deps, desktopId, { force: true } );
	return true;
}
