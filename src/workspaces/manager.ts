/**
 * Workspace operations — create, edit, provision.
 *
 * The window manager owns desktops; this module owns the profile a
 * desktop carries. It reaches into `WindowManager` for the desktop
 * list and for opening windows, and it fires the hooks the session
 * saver listens on, but it holds no state of its own — the workspace
 * IS the desktop, and there is nowhere else for it to live.
 *
 * Provisioning is the one piece with real ordering to it, and
 * {@link provisionWorkspace} explains why.
 */

import { applyFilters, doAction, HOOKS } from '../hooks';
import type { Desktop } from '../types';
import type { NavItem } from '../nav/types';
import type { WindowManager } from '../window-manager';
import { resolveLaunches } from './match';
import { findWorkspacePreset, workspaceProfileFromPreset } from './presets';
import type {
	WorkspaceLaunch,
	WorkspaceLayoutId,
	WorkspaceProfile,
} from './types';
import { workspaceAppearance, workspaceWidgetIds } from './visibility';

/** External wiring the workspace operations need from the shell. */
export interface WorkspaceDeps {
	manager: WindowManager;
	/** Every navigable thing, for resolving a preset's tokens. */
	getNavItems: () => NavItem[];
	/** Absolute wp-admin URL, for resolving a launch entry's relative URL. */
	adminUrl: string;
	/** The window-manager key an admin URL opens under. */
	deriveWindowId: ( url: string ) => string;
	/** Open a native window by id. */
	openNative: ( id: string ) => void;
	/** Repaint the rails — a profile change moves apps on and off them. */
	refreshLayout: () => void;
	/**
	 * Show exactly these widgets, or `null` for the user's own column.
	 *
	 * A push rather than a pull, unlike the rails: the navigation is
	 * recomputed from scratch on every window event and can simply read
	 * the active profile each time, but the widget column is mounted
	 * state that only changes when something tells it to.
	 */
	setVisibleWidgets?: ( ids: readonly string[] | null ) => void;
	/**
	 * Paint the desk with this appearance patch, or `null` to hand the
	 * user's own settings back. A view, never a write — see
	 * `OsSettings.setWorkspaceAppearance()`.
	 */
	setAppearance?: ( patch: Record< string, unknown > | null ) => void;
}

/** The profile on a desktop, or `null` for a plain Space. */
export function getWorkspaceProfile(
	mgr: WindowManager,
	desktopId: string,
): WorkspaceProfile | null {
	return (
		mgr.getDesktops().find( ( d ) => d.id === desktopId )?.profile ?? null
	);
}

/** The active desktop's profile, or `null`. */
export function getActiveWorkspaceProfile(
	mgr: WindowManager,
): WorkspaceProfile | null {
	return getWorkspaceProfile( mgr, mgr.getActiveDesktopId() );
}

/**
 * Replace a desktop's profile.
 *
 * Writes through the live desktop object rather than the copy
 * `getDesktops()` hands out — that method returns a shallow clone of
 * the array, so mutating an entry from it would update nothing.
 * Reaching for `_desktops` is the same access `desktops.ts` uses.
 */
export function setWorkspaceProfile(
	deps: WorkspaceDeps,
	desktopId: string,
	profile: WorkspaceProfile | null,
): boolean {
	const desktop = deps.manager._desktops.find(
		( d: Desktop ) => d.id === desktopId,
	);
	if ( ! desktop ) {
		return false;
	}
	if ( profile ) {
		desktop.profile = profile;
	} else {
		delete desktop.profile;
	}
	// The rails answer to the profile, so a write that did not repaint
	// would leave the desk showing the apps of the workspace it used to
	// be until some unrelated event happened along.
	deps.refreshLayout();
	// Same for the widget column — but only when the desk being written
	// is the one on screen. Editing a workspace from another desk (the
	// editor can be opened on any of them) must not repaint the column
	// in front of the user with the widgets of a desk they are not on.
	if ( desktopId === deps.manager.getActiveDesktopId() ) {
		applyWorkspaceView( deps, desktopId );
	}
	doAction( HOOKS.WORKSPACE_UPDATED, { desktopId, profile } );
	return true;
}

/**
 * Bring the widget column in line with a desk's profile.
 *
 * Silent when the shell has not wired a widget layer — the column is
 * optional chrome, and a shell without one should not be a shell that
 * throws.
 */
export function applyWorkspaceWidgets(
	deps: WorkspaceDeps,
	desktopId: string,
): void {
	deps.setVisibleWidgets?.(
		workspaceWidgetIds( getWorkspaceProfile( deps.manager, desktopId ) ),
	);
}

/**
 * Bring the desk's look in line with its profile — wallpaper, accent,
 * theme, dock. A view over the user's settings, restored on the way
 * out; see `OsSettings.setWorkspaceAppearance()`.
 */
export function applyWorkspaceAppearance(
	deps: WorkspaceDeps,
	desktopId: string,
): void {
	deps.setAppearance?.(
		workspaceAppearance( getWorkspaceProfile( deps.manager, desktopId ) ),
	);
}

/**
 * Everything about a desk that is a VIEW rather than a window: its
 * look and its widget column.
 *
 * One call because the two always move together — every switch, and
 * every profile write to the desk on screen. Appearance first: the
 * widget column reads the accent and the dock placement the appearance
 * just set, and doing it the other way round paints the column once in
 * the old look and again in the new one.
 */
export function applyWorkspaceView(
	deps: WorkspaceDeps,
	desktopId: string,
): void {
	applyWorkspaceAppearance( deps, desktopId );
	applyWorkspaceWidgets( deps, desktopId );
}

/** What {@link createWorkspace} needs to know. */
export interface CreateWorkspaceOptions {
	/** Preset id to read the profile from. Omit for a blank desk. */
	preset?: string;
	/** Name. Falls back to the preset's, then to the auto-numbered one. */
	label?: string;
	/** Explicit profile, overriding whatever the preset would produce. */
	profile?: WorkspaceProfile;
	/** Switch to the new workspace once it exists. Default true. */
	activate?: boolean;
}

/**
 * Create a desktop carrying a workspace profile.
 *
 * Order matters: the desktop is created first so the profile write and
 * the switch both have something to name, and the switch comes last so
 * provisioning — which the switch triggers — runs against a desk that
 * already knows what it is.
 */
export function createWorkspace(
	deps: WorkspaceDeps,
	options: CreateWorkspaceOptions = {},
): Desktop {
	const preset = options.preset ? findWorkspacePreset( options.preset ) : null;

	let profile = options.profile ?? null;
	if ( ! profile && preset ) {
		profile = applyFilters< WorkspaceProfile, [ typeof preset ] >(
			HOOKS.WORKSPACE_PROFILE,
			workspaceProfileFromPreset( preset, deps.getNavItems() ),
			preset,
		);
	}

	const desktop = deps.manager.createDesktop();
	const label = options.label ?? preset?.defaultLabel ?? preset?.label ?? '';
	if ( label ) {
		deps.manager.renameDesktop( desktop.id, label );
	}
	if ( profile ) {
		setWorkspaceProfile( deps, desktop.id, profile );
	}
	if ( options.activate !== false ) {
		deps.manager.switchDesktop( desktop.id );
	}
	return desktop;
}

/** The manager method each layout id maps to. `free` maps to nothing. */
export function applyWorkspaceLayout(
	mgr: WindowManager,
	layout: WorkspaceLayoutId,
): void {
	switch ( layout ) {
		case 'cascade':
			mgr.cascade();
			break;
		case 'tile':
			mgr.tile();
			break;
		case 'columns':
			mgr.columns();
			break;
		case 'focus':
			mgr.focusLayout();
			break;
		case 'free':
		default:
			break;
	}
}

/**
 * Open a workspace's launch list and arrange the result.
 *
 * Runs once per workspace, guarded by `profile.provisioned`. That flag
 * is set BEFORE the windows open, not after: opening a window is
 * asynchronous (an iframe window resolves its own load), and a second
 * switch landing while the first pass is still opening would otherwise
 * run the whole list again and leave the desk with two of everything.
 *
 * The layout is applied on the next frame rather than inline. Every
 * arrangement reads the work area and the windows' own boxes, and a
 * window created in this tick has neither until the browser has laid
 * it out — arranging inline puts every window at the same coordinates.
 */
export function provisionWorkspace(
	deps: WorkspaceDeps,
	desktopId: string,
	opts: { force?: boolean } = {},
): void {
	const profile = getWorkspaceProfile( deps.manager, desktopId );
	// `force` is the editor's "Open these windows" button — the user
	// asking on purpose, which is a different question from the shell
	// deciding on its own. Every automatic caller leaves it off.
	if ( ! profile || ( profile.provisioned && ! opts.force ) ) {
		return;
	}

	// Claim it first — see above.
	setWorkspaceProfile( deps, desktopId, { ...profile, provisioned: true } );

	const launches = resolveLaunches( deps.getNavItems(), profile.windows );
	let opened = 0;
	for ( const launch of launches ) {
		if ( launch.url ) {
			const url = absoluteAdminUrl( launch.url, deps.adminUrl );
			opened++;
			// Not awaited: an iframe window resolves when its document
			// loads, and a workspace with three windows would otherwise
			// open them one page-load apart. A rejection is a window that
			// did not open, which is exactly what a missing plugin looks
			// like — the rest of the desk still comes up.
			void deps.manager
				.open( {
					id: deps.deriveWindowId( url ),
					url,
					title: launch.title,
					icon: launch.item.icon,
					desktopId,
				} )
				.catch( () => {
					/* One window short is not a failed workspace. */
				} );
			continue;
		}
		if ( launch.item.windowId ) {
			opened++;
			deps.openNative( launch.item.windowId );
		}
	}

	const settle = (): void => {
		applyWorkspaceLayout( deps.manager, profile.layout );
		doAction( HOOKS.WORKSPACE_PROVISIONED, {
			desktopId,
			opened,
			layout: profile.layout,
		} );
	};
	if ( 'undefined' !== typeof requestAnimationFrame ) {
		requestAnimationFrame( () => requestAnimationFrame( settle ) );
	} else {
		settle();
	}
}

/**
 * The windows open on a desktop, as a launch list.
 *
 * "Open with what I have now" — the desktop-OS gesture of saving an
 * arrangement you arrived at by working rather than by planning. Far
 * more useful than a repeater the user has to fill in by hand, and it
 * is the only way to capture a window opened from somewhere the
 * navigation cannot name.
 *
 * `match` is the item's own id: a captured list is about THIS install,
 * so there is nothing to degrade gracefully against and an id is the
 * exact answer. Native windows carry no URL, which is what tells
 * `provisionWorkspace` to reopen them through the registry.
 */
export function captureWorkspaceWindows(
	mgr: WindowManager,
	desktopId: string,
): WorkspaceLaunch[] {
	const out: WorkspaceLaunch[] = [];
	const seen = new Set< string >();
	for ( const win of mgr.getAll() ) {
		if ( ( win.config.desktopId || mgr.getActiveDesktopId() ) !== desktopId ) {
			continue;
		}
		const id = win.config.baseId || win.id;
		if ( seen.has( id ) ) {
			continue;
		}
		seen.add( id );
		const entry: WorkspaceLaunch = {
			match: id,
			title: win.config.title || id,
		};
		// A native window's `url` is a `#slug` marker, never something
		// to navigate to.
		if ( true !== win.config.native && win.config.url ) {
			entry.url = win.config.url;
		}
		out.push( entry );
	}
	return out;
}

/**
 * Resolve a launch entry's URL against wp-admin.
 *
 * Entries are written relative (`edit.php?post_type=product`) so a
 * preset is portable across installs, subdirectory ones included. An
 * entry that already carries a scheme is passed through — a plugin's
 * preset is allowed to name a full URL — and anything that fails to
 * parse falls back to the admin root rather than throwing mid-launch.
 */
export function absoluteAdminUrl( url: string, adminUrl: string ): string {
	if ( /^https?:\/\//i.test( url ) ) {
		return url;
	}
	try {
		return new URL( url, adminUrl ).href;
	} catch {
		return adminUrl;
	}
}
