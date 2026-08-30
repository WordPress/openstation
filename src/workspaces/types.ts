/**
 * Workspaces — a desktop with a job.
 *
 * A virtual desktop ("Space") is a container for windows and nothing
 * else: it has an id and a name. A **workspace** is that container plus
 * the answer to "what is this desk FOR" — which apps belong on it,
 * which windows it opens with, and how those windows are laid out.
 *
 * That answer travels with the desktop, in {@link WorkspaceProfile},
 * and it is persisted alongside the desktop in the session. Nothing
 * here reaches into the shell: the profile is data, and the modules
 * that act on it (`visibility.ts`, `provision.ts`) are pure functions
 * over that data plus the live navigation.
 *
 * See `docs/workspaces.md`.
 */

/**
 * How a workspace arranges its windows when it is provisioned, and
 * what "Re-apply layout" does afterwards.
 *
 * - `free`    — nothing is moved. Windows land wherever the window
 *               manager's own cascade puts them.
 * - `cascade` — the classic stagger, every window the same size.
 * - `tile`    — a uniform grid covering the work area.
 * - `columns` — one full-height column per window, side by side. The
 *               commerce/dashboard shape: three lists you compare
 *               rather than one you read.
 * - `focus`   — one window takes the leading two-thirds, the rest
 *               stack down the trailing third. The writing shape: the
 *               page you are working on, and everything else in
 *               peripheral vision.
 */
export type WorkspaceLayoutId =
	| 'free'
	| 'cascade'
	| 'tile'
	| 'columns'
	| 'focus';

/** Every layout id, for validation and for the picker's option list. */
export const WORKSPACE_LAYOUTS: readonly WorkspaceLayoutId[] = [
	'free',
	'cascade',
	'tile',
	'columns',
	'focus',
] as const;

/**
 * Which apps a workspace shows.
 *
 * `'all'` is the neutral setting and the default for a blank
 * workspace: the rails look exactly as they do without workspaces at
 * all. `'only'` narrows them to {@link WorkspaceApps.ids}, which is
 * what makes a Commerce desk feel like a shop tool rather than a
 * WordPress admin with commerce in it.
 *
 * Narrowing never reaches OpenStation's own controls (Overview, the
 * System tile, Trash, Exit) — see `visibility.ts` for why that is a
 * structural rule rather than a default.
 */
export interface WorkspaceApps {
	mode: 'all' | 'only';
	/** Nav item ids kept visible under `'only'`. Ignored under `'all'`. */
	ids: string[];
}

/**
 * Which widgets a workspace puts on its desk.
 *
 * `'all'` leaves the user's own widget column alone — the default, and
 * what every plain Space does. `'only'` makes the column exactly
 * {@link WorkspaceWidgets.ids} while this desk is active.
 *
 * Deliberately not the same rule as {@link WorkspaceApps}. A narrowed
 * desk can only ever *hide* an app, because the placement map it
 * narrows is the user's own and adding to it would be editing their
 * settings. A widget column is not a filter over anything — it is a
 * layout, and "this desk has the clock and the sales chart" is a
 * complete statement. So `'only'` mounts what it names whether or not
 * the user enabled it globally, and unmounts everything else.
 *
 * It still writes nothing: switching away restores the user's column
 * untouched, and deleting the workspace leaves it exactly as it was.
 */
export interface WorkspaceWidgets {
	mode: 'all' | 'only';
	/** Widget ids mounted under `'only'`. Ignored under `'all'`. */
	ids: string[];
}

/**
 * Appearance settings a workspace may repaint the desk with.
 *
 * A deliberate allowlist rather than "any settings key". Two reasons:
 * a workspace has no business reaching `navPlacement` (the apps rule
 * already owns that) or `heartbeatRate` (a workspace is not a place to
 * hide a performance setting); and an allowlist is what lets the
 * persisted profile be validated on the server without the sanitizer
 * needing to know the whole settings schema.
 *
 * Everything here is visual and instantly reversible, which is the
 * test for belonging: switching desks must never leave the user
 * somewhere they cannot get back from.
 */
export const WORKSPACE_APPEARANCE_KEYS = [
	'wallpaper',
	'wallpaperSettings',
	'customGradient',
	'customImage',
	'accent',
	'customAccent',
	'desktopTheme',
	'desktopLayout',
	'dockPlacement',
	'dockSize',
	'dockBehavior',
	'sideDockBehavior',
	'windowRadius',
	'windowReveal',
	'unfocusEffect',
	'adminBarMode',
] as const;

/** One overridable appearance setting. */
export type WorkspaceAppearanceKey =
	( typeof WORKSPACE_APPEARANCE_KEYS )[ number ];

/**
 * A workspace's look, as a sparse patch over the user's settings.
 *
 * Only the keys present are overridden, and only while the workspace
 * is active — the user's own settings are restored the moment they
 * leave. `{}` (or absent) means "the desk looks the way the user set
 * it up", which is what every plain Space does.
 *
 * Typed loosely on purpose: `OsSettingsState` lives in the settings
 * module and importing it here would tie the workspace model to the
 * settings implementation for the sake of one field. The allowlist
 * above is the contract; `pickWorkspaceAppearance()` enforces it.
 */
export type WorkspaceAppearance = Partial<
	Record< WorkspaceAppearanceKey, unknown >
>;

/**
 * One window a workspace opens with.
 *
 * `match` is the load-bearing field: it is tested against the live
 * navigation, and an entry that matches nothing is skipped. That is
 * what lets the Woo preset ship on a site without WooCommerce and
 * simply open fewer windows instead of four "you do not have
 * permission" pages.
 *
 * `url` is the admin-relative URL to open once the match has proved
 * the app is installed — `edit.php?post_type=product` where the match
 * only found the Products menu. Omit it and the matched item opens
 * itself.
 */
export interface WorkspaceLaunch {
	/** Token tested against a nav item's id, URL, window id or title. */
	match: string;
	/** Admin-relative URL to open instead of the matched item's own. */
	url?: string;
	/** Title override for the opened window. */
	title?: string;
	/**
	 * Where the window goes, as a span of the grid — when it was
	 * grid-snapped at the moment the desk was saved. Cells, not
	 * pixels, so a 2×2 at (1,1) is a 2×2 at (1,1) on any display.
	 * Wins over `place`.
	 */
	gridSpan?: import( '../types' ).GridSpan;
	/**
	 * Where the window goes, as fractions of the work area — `x`, `y`,
	 * `width`, `height` each in `[0, 1]`. What a free (not grid-
	 * snapped) window's position becomes when the desk is saved, and
	 * for the same reason: a fraction survives a resized browser and
	 * a different display; pixels do not.
	 */
	place?: { x: number; y: number; width: number; height: number };
}

/**
 * Everything a desktop knows about being a workspace.
 *
 * Stored on the {@link import('../types').Desktop} itself and
 * round-tripped through the session, so a workspace survives a reload
 * and follows the user across devices through the portal.
 */
export interface WorkspaceProfile {
	/**
	 * Preset this workspace was minted from (`'commerce'`,
	 * `'learning'`, `'publishing'`), or `''` for one the user built
	 * themselves.
	 *
	 * Provenance only. A preset is a template read once at creation
	 * time; editing the workspace afterwards never writes back to it,
	 * and a preset that changes in a later release does not reach
	 * desks already created from it.
	 */
	preset: string;
	/** Dashicon class shown on the switcher and the overview tile. */
	icon: string;
	/**
	 * `#rrggbb` accent for the workspace's chip and its overview tile.
	 * Empty means "use the shell accent".
	 */
	color: string;
	apps: WorkspaceApps;
	/**
	 * Optional, and absent means `'all'`. Kept optional rather than
	 * defaulted into the shape so a profile written before workspaces
	 * had widgets keeps the user's own column instead of silently
	 * emptying it.
	 */
	widgets?: WorkspaceWidgets;
	/**
	 * How this desk looks — wallpaper, accent, theme, dock. A sparse
	 * patch; absent or empty means "the way the user set it up".
	 */
	appearance?: WorkspaceAppearance;
	windows: WorkspaceLaunch[];
	layout: WorkspaceLayoutId;
	/**
	 * Whether the launch list has already run.
	 *
	 * Provisioning is a once-per-workspace event, not a once-per-visit
	 * one. Without this, closing a window the workspace opened and
	 * switching away would reopen it on the way back — the desk would
	 * refuse to be tidied.
	 */
	provisioned?: boolean;
}

/**
 * A workspace template.
 *
 * Presets are resolved against the live navigation at creation time
 * and then discarded: what lands on the desktop is a
 * {@link WorkspaceProfile} of concrete ids. Plugins add their own
 * through `registerWorkspacePreset()` (JS) or the
 * `openstation_workspace_presets` filter (PHP).
 */
export interface WorkspacePreset {
	id: string;
	/** Name shown in the switcher's "New from template" group. */
	label: string;
	/** One line under the label in the editor. */
	description: string;
	icon: string;
	color: string;
	/**
	 * Tokens naming the apps this workspace is about. Each is tested
	 * against every nav item the same way {@link WorkspaceLaunch.match}
	 * is; everything that matches lands in `apps.ids`.
	 *
	 * An empty list means "show everything" — the profile is created
	 * with `mode: 'all'`.
	 */
	apps: string[];
	/**
	 * Widget ids this desk puts in its column. Omit — or leave
	 * empty — to keep the user's own column, which is what a template
	 * with no opinion about widgets should do.
	 */
	widgets?: string[];
	/** How a desk made from this template looks. Sparse; optional. */
	appearance?: WorkspaceAppearance;
	windows: WorkspaceLaunch[];
	layout: WorkspaceLayoutId;
	/**
	 * Default name for a desk created from this preset. Falls back to
	 * `label` when empty.
	 */
	defaultLabel?: string;
	/**
	 * Sort key in the switcher, ascending; ties keep registration
	 * order. The three shipped presets claim 10 / 20 / 30, so a plugin
	 * leaving this at the default 0 leads the list — which is the right
	 * default for a site that installed a workspace on purpose.
	 */
	order?: number;
}

/** The blank profile a workspace starts from when no preset is used. */
export function blankWorkspaceProfile(): WorkspaceProfile {
	return {
		preset: '',
		icon: 'dashicons-desktop',
		color: '',
		apps: { mode: 'all', ids: [] },
		widgets: { mode: 'all', ids: [] },
		appearance: {},
		windows: [],
		layout: 'free',
		provisioned: true,
	};
}
