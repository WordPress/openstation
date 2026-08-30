/**
 * `wp.os.workspaces` — the public workspace surface.
 *
 * Thin on purpose: every method here is one of the operations in
 * `manager.ts` with the shell's dependencies already bound. Plugin
 * authors get "create a Woo desk", "narrow this desk to my app",
 * "open the editor" without having to hold a `WorkspaceDeps`.
 *
 * See `docs/workspaces.md` and `docs/javascript-reference.md`.
 */

import type { Desktop } from '../types';
import { openWorkspaceEditor } from './editor-loader';
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
	/** Every desktop, profile included. */
	list(): Desktop[];
	/** The desktop the user is on. */
	active(): Desktop | null;
	/** A desktop's profile, or `null` for a plain Space. */
	getProfile( desktopId: string ): WorkspaceProfile | null;
	/** Replace a desktop's profile. Pass `null` to make it a plain Space. */
	setProfile( desktopId: string, profile: WorkspaceProfile | null ): boolean;
	/** Create a workspace, optionally from a template. */
	create( options?: CreateWorkspaceOptions ): Desktop;
	/** Switch to a desktop by id. */
	switchTo( desktopId: string ): void;
	/** Re-run an arrangement on the active desktop. */
	arrange( layout: WorkspaceLayoutId ): void;
	/**
	 * Run a workspace's launch list now, if it has not run.
	 * A no-op on a workspace already provisioned — see
	 * `WorkspaceProfile.provisioned` for why that is once-ever rather
	 * than once-per-visit. Pass `{ force: true }` to run it anyway,
	 * which is what the editor's "Open them now" does.
	 */
	provision( desktopId: string, opts?: { force?: boolean } ): void;
	/**
	 * The windows open on a desktop, shaped as a launch list — "open
	 * with what I have now". Feed the result to `setProfile()`.
	 */
	capture( desktopId: string ): WorkspaceProfile[ 'windows' ];
	/**
	 * The shell's current appearance, shaped as a workspace patch —
	 * "use the look I have now". Only allowlisted keys are taken.
	 */
	captureAppearance(): WorkspaceProfile[ 'appearance' ];
	/** Open the editor on a desktop. Loads its bundle on first use. */
	edit( desktopId: string ): void;
	/** Every template offered in the switcher. */
	presets(): WorkspacePreset[];
	/** Add a template. Re-registering an id replaces it. */
	registerPreset( preset: WorkspacePreset ): void;
	/** Remove a registered template. Built-ins are not removable. */
	unregisterPreset( id: string ): void;
}

/**
 * Bind the workspace operations to the shell's dependencies.
 *
 * @param deps          Bound operations.
 * @param editWorkspace Open the editor on a desktop.
 * @param currentLook   The shell's appearance right now, for
 *                      `captureAppearance()`. Injected rather than
 *                      read from a settings import, because this
 *                      module ships in bundles that must not pull the
 *                      settings tree in.
 */
export function createWorkspacesApi(
	deps: WorkspaceDeps,
	editWorkspace: ( desktopId: string ) => void,
	currentLook: () => WorkspaceProfile[ 'appearance' ] = () => ( {} ),
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
		presets: listWorkspacePresets,
		registerPreset: registerWorkspacePreset,
		unregisterPreset: unregisterWorkspacePreset,
	};
}

/** Re-exported so the shell can wire the editor without a second import. */
export { getActiveWorkspaceProfile, openWorkspaceEditor };
