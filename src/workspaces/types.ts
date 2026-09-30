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

import { DEFAULTS } from '../settings/constants';

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

/**
 * Most windows one workspace opens with. Mirrors
 * `OPENSTATION_WORKSPACE_MAX_WINDOWS` in `includes/workspaces.php`,
 * where the session sanitizer silently drops entries past it — so a
 * capture has to stop here too, or the desk would be told it kept
 * fifteen windows and get back twelve.
 */
export const WORKSPACE_MAX_WINDOWS = 12;

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
 * The settings a workspace may carry: EVERY OpenStation setting, except
 * the shell's own theme-seeding ledger.
 *
 * Derived from `DEFAULTS`, so a setting added later is overridable the
 * day it ships — and the server derives its list the same way
 * (`openstation_workspace_setting_keys()`), so the two cannot drift.
 * The server sanitizes every value with the settings' own sanitizer.
 *
 * Every one is a view while the desk is on screen, restored the moment
 * the user leaves it. For a user a shared workspace PINS, the server
 * splits them: cosmetic ones are seeded into the user's own settings
 * (theirs to change), the rest are held by the workspace.
 */
export const WORKSPACE_APPEARANCE_KEYS: readonly string[] = Object.keys( DEFAULTS ).filter(
	( key ) => 'appliedThemeRecommendations' !== key,
);

/** One overridable setting. */
export type WorkspaceAppearanceKey = string;

/**
 * A workspace's look, as a sparse patch over the user's settings.
 *
 * Only the keys present are overridden, and only while the workspace
 * is active — the user's own settings are restored the moment they
 * leave. `{}` (or absent) means "the desk looks the way the user set
 * it up", which is what every plain Space does.
 *
 * Typed loosely on purpose: the key list above is the contract, and
 * `workspaceAppearance()` enforces it.
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
	/**
	 * "Hide settings": leave out Settings, OpenStation Preferences and
	 * the admin tools (plugins, themes, the Customizer, editors, tools,
	 * users, updates). The lists are the server's —
	 * `config.workspaceRestricted`, filterable in PHP. A view for the
	 * desk's owner; for a user pinned to it, the server refuses those
	 * screens and apps too.
	 */
	restricted?: boolean;
	/**
	 * Read-only notes the desk's author pinned on it; each can be
	 * dismissed by whoever uses the desk. See `WorkspaceNote`.
	 */
	notes?: WorkspaceNote[];
}

/**
 * A note the author pins on a workspace's desk. Read-only to everyone
 * using the desk — they can only dismiss it — and editable only while
 * the workspace is being edited.
 */
export interface WorkspaceNote {
	/** Stable id: a dismissal is remembered against it. */
	id: string;
	/** Plain text, never markup. Up to 1000 characters (2000 for XL). */
	text: string;
	/** An XL note is twice the size, for a longer, nicer write-up. */
	size: 'normal' | 'xl';
	/** One of the sticky-note colours (`NOTE_COLORS`). */
	color: string;
	/** Where it hangs, as fractions of the work area. */
	x: number;
	y: number;
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
