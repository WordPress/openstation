/**
 * `wp.os.workspaces` — the public workspace surface.
 *
 * Thin on purpose: every method here is one of the operations in
 * `manager.ts` with the shell's dependencies already bound. Plugin
 * authors get "save the main desk as a workspace", "narrow this desk
 * to my app", "open the Workspaces app" without having to hold a
 * `WorkspaceDeps`.
 *
 * See `docs/workspaces.md` and `docs/javascript-reference.md`.
 */

import type { Desktop } from '../types';
import { isWorkspacePinned } from './pin';
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
import type { WorkspaceApp } from './match';
import type {
	WorkspaceLayoutId,
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
	/** Create a desk carrying a profile. Prefer `saveAs()`: a workspace is saved, not described. */
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
	/**
	 * Save a desk — the main one by default — as a NEW workspace: its
	 * windows where they are, its widgets, its apps and its look. The
	 * one way a workspace is made. Returns the new desk, or `null`
	 * when nothing was saved (a pinned user has nothing to save).
	 */
	saveAs( sourceId?: string ): Desktop | null;
	/**
	 * Put the MAIN desk back the way a fresh install starts it — its
	 * windows closed, the Dashboard opened, settings and widgets at
	 * their defaults. Asks first; resolves whether it ran. Other
	 * workspaces, shared links and desktop files are untouched.
	 */
	restoreMain(): Promise< boolean >;
	/** Rename a desktop. Returns whether the name changed. */
	rename( desktopId: string, label: string ): boolean;
	/**
	 * Delete a desktop. Never the last one, and never while pinned.
	 * Deleting a shared workspace leaves its link and everyone using
	 * it untouched — those belong to the share.
	 */
	remove( desktopId: string ): boolean;
	/** Open the Workspaces app, on a desktop when one is named. */
	manage( desktopId?: string ): void;
	/** Whether the user is pinned to a shared workspace. */
	isPinned(): boolean;
	/**
	 * Every app a workspace can use on this site, native or not: each
	 * with its screens (main page first, then its tabs) and whether it
	 * has a dock icon. A launch entry's `match` is an app's `id`.
	 */
	apps(): WorkspaceApp[];
	/**
	 * Edit a workspace where it lives: switch to its desk, with a
	 * Save changes toast that keeps the desk as it is then (the
	 * Workspaces app opens after, to publish the change to a shared
	 * workspace's recipients).
	 */
	edit( desktopId: string ): void;
	/** Alias of `saveAs()`, kept for existing callers. */
	openCreator(): void;
	/**
	 * Make a workspace open the way its desk is now — the open windows
	 * where they are, the mounted widgets, the visible apps. Defaults
	 * to the active desk. A plain Space becomes a workspace by being
	 * saved. Returns whether anything was saved.
	 */
	saveDesk( desktopId?: string ): boolean;
}

/** The operations the shell binds, beyond the deps bag. */
export interface WorkspacesApiOps {
	/** Open the Workspaces app, on a desktop when one is named. */
	manage?: ( desktopId?: string ) => void;
	/**
	 * The shell's appearance right now, for `captureAppearance()`.
	 * Injected rather than read from a settings import, because this
	 * module ships in bundles that must not pull the settings tree in.
	 */
	currentLook?: () => WorkspaceProfile[ 'appearance' ];
	/** Clone a desk into a new workspace. */
	saveAs?: ( sourceId?: string ) => Desktop | null;
	/** Put the main desk back the way a fresh install starts it. */
	restoreMain?: () => Promise< boolean >;
	/** Switch to a workspace's desk to edit it. */
	edit?: ( desktopId: string ) => void;
	/**
	 * Save a desk into its workspace. Bound in the shell, which is
	 * where the visible apps and the mounted widgets can be read from.
	 */
	saveDesk?: ( desktopId?: string ) => boolean;
	/** The app catalogue — bound in the shell, which holds the URL remaps. */
	apps?: () => WorkspaceApp[];
}

/**
 * Bind the workspace operations to the shell's dependencies.
 *
 * @param deps Bound operations.
 * @param ops  What only the shell can provide — see {@link WorkspacesApiOps}.
 */
export function createWorkspacesApi(
	deps: WorkspaceDeps,
	ops: WorkspacesApiOps = {},
): WorkspacesApi {
	const manage = ops.manage ?? ( () => undefined );
	const saveAs = ops.saveAs ?? ( () => null );
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
		captureAppearance: ops.currentLook ?? ( () => ( {} ) ),
		saveAs,
		restoreMain: ops.restoreMain ?? ( () => Promise.resolve( false ) ),
		rename: ( desktopId, label ) =>
			deps.manager.renameDesktop( desktopId, label ),
		remove: ( desktopId ) => {
			const before = deps.manager.getDesktops().length;
			deps.manager.closeDesktop( desktopId );
			return deps.manager.getDesktops().length < before;
		},
		manage,
		isPinned: isWorkspacePinned,
		apps: ops.apps ?? ( () => [] ),
		edit: ops.edit ?? ( ( desktopId ) => manage( desktopId ) ),
		openCreator: () => {
			saveAs();
		},
		saveDesk: ops.saveDesk ?? ( () => false ),
	};
}

/** Re-exported so the shell can wire the provisioner without a second import. */
export { getActiveWorkspaceProfile };
