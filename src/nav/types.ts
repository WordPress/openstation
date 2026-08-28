/**
 * Navigation model — the one description of everything the shell can
 * put on a rail or on the wallpaper.
 *
 * Four kinds of thing arrive from four registration paths (admin
 * menus, `openstation_register_icon()`, `openstation_register_window()`,
 * the shell's own tiles), and every one of them collapses into a
 * single {@link NavItem}. Where an item shows up is a function of its
 * KIND plus the user's stored override — never of the path it was
 * registered through. That is the whole point of the module: an app
 * that registers twice (a window with a dock tile AND a desktop icon)
 * used to get two answers to "where does this live?", one per surface,
 * and they disagreed until the user picked a value explicitly.
 *
 * See `docs/architecture.md` → Navigation.
 */

import type { DockItem, SystemDockItem } from '../dock';
import type { DesktopIconServerEntry } from '../types';

/**
 * What a navigable thing IS. Drives its default placement, which zone
 * it sits in, and which rail its `'rail'` placement resolves to.
 *
 * - `core`    — an admin menu WordPress itself registered.
 * - `plugin`  — an admin menu a plugin registered.
 * - `app`     — an installed app: WP Explorer, Corkboard, Games, a
 *               plugin's native window, a registered desktop icon.
 * - `control` — an OpenStation affordance: Mio, Overview, System,
 *               Trash, Exit.
 */
export type NavKind = 'core' | 'plugin' | 'app' | 'control';

/**
 * Where an item shows up, as a subset of the two regions any item can
 * occupy. `'rail'` is deliberately not called "dock": for a core menu
 * in the split layout it resolves to the sidebar. See
 * {@link railFor}.
 */
export type NavPlacement = 'rail' | 'desktop' | 'both' | 'hidden';

/** The two physical rails. Only the dock exists in the unified layout. */
export type NavRail = 'dock' | 'sidebar';

/**
 * A run of items on a rail, separated from its neighbours by a
 * divider. Membership is derived from {@link NavKind} and is never
 * stored, which is what makes "icons cannot be dragged to another
 * zone" structural rather than a rule someone has to enforce.
 */
export type NavZone = 'core' | 'apps' | 'controls';

/** The two desktop layouts. `'classic'` is the split layout's stored id. */
export type NavLayout = 'classic' | 'unified';

/**
 * One navigable thing, whatever registered it.
 *
 * The `menu` / `tile` / `entry` fields are the SOURCES that produced
 * it. An item can carry more than one — Games registers a native
 * window (which mints a system tile) and a desktop icon under the same
 * id — and the renderers each reach for the source they can paint.
 */
export interface NavItem {
	/** Canonical id. Keys the user's placement + order preferences. */
	id: string;
	kind: NavKind;
	title: string;
	/** Dashicon class, data: URI, or image URL. */
	icon: string;
	/**
	 * Cannot be moved, hidden, or reordered. For an item a user must
	 * always be able to reach — nothing built-in claims it now, and a
	 * plugin should claim it only for something whose absence would
	 * strand them.
	 */
	locked?: boolean;
	/**
	 * Placement proposed at registration time, overriding the kind's
	 * default but not the user's pick. A native window registered with
	 * `placement: 'none'` sets `'desktop'` here; nothing else uses it
	 * today.
	 */
	defaultPlacement?: NavPlacement;
	/** Native-window id this item opens, when it opens one. */
	windowId?: string;
	/**
	 * Other windows this item already stands in for.
	 *
	 * A tile with a submenu answers for whatever its rows open: the
	 * System tile carries OpenStation Preferences, so Preferences
	 * opening lights that tile rather than minting a second one beside
	 * it. Collected from the rows' own `windowId`s, which the flyout
	 * already needs in order to list a tile's live windows.
	 */
	answersFor?: readonly string[];
	/**
	 * Baseline sort key within the zone, ascending; ties keep
	 * registration order. Defaults to 0.
	 *
	 * Registration order cannot express the intended rail on its own:
	 * a native window's launcher arrives whenever its lazy script
	 * resolves, so a tile registered last in `desktop.ts` can still be
	 * overtaken. The shell's own cluster claims 10/20/30/35/40, which
	 * is what keeps Mio → Overview → System → Exit → Trash at the tail
	 * whatever order they happen to arrive in. Anything at the default
	 * 0 — every admin menu, every plugin launcher — sorts ahead of it.
	 *
	 * The user's own ordering wins over this: ids they have dragged
	 * lead the zone, and this only decides the rest.
	 */
	order?: number;
	/** Admin-menu source. */
	menu?: DockItem;
	/** System-tile source (a native window's launcher, a shell tile). */
	tile?: SystemDockItem;
	/** Registered desktop-icon source. */
	entry?: DesktopIconServerEntry;
	/**
	 * Synthesized from an open window that nothing registers a
	 * launcher for — OpenStation Preferences is the shipped case.
	 * It exists only while that window is open, so it has no
	 * placement to store and no row in Preferences.
	 */
	transient?: boolean;
}

/** An open window, as the navigation needs to see it. */
export interface OpenWindow {
	/** Window-manager key. Instances of one app share it. */
	id: string;
	title: string;
	icon: string;
	/**
	 * Whether this window is an admin page.
	 *
	 * An admin page is always reachable through the menu it belongs
	 * to — the menu's tile lights up for its child pages, and the
	 * hover peek fans out every instance — so it never needs a tile
	 * of its own. Everything else does: a native window nothing
	 * launches from a rail would otherwise be unswitchable, with
	 * nowhere to minimize back into.
	 */
	fromAdminUrl: boolean;
}

/** The user's stored navigation preferences. */
export interface NavConfig {
	/** Per-item override. Missing means "use the kind's default". */
	placement: Record< string, NavPlacement >;
	/**
	 * Flat ordering hint across every zone. Each zone renders its own
	 * members in this order; ids absent from the list render after the
	 * listed ones in registration order. Flat rather than per-zone so
	 * a core menu keeps its position when the layout switch moves it
	 * between the dock and the sidebar.
	 */
	order: string[];
}

/** Everything {@link computeNav} needs. Pure input, no globals. */
export interface NavInput {
	items: NavItem[];
	config: NavConfig;
	layout: NavLayout;
	/**
	 * Windows open on the active desktop. Drives the running
	 * indicator, and the transient dock tile an open window gets when
	 * it has no home on a rail.
	 */
	openWindows: readonly OpenWindow[];
}

/** What every navigation surface renders. */
export interface NavResult {
	/** The dock's three zones, in paint order. */
	dock: Record< NavZone, NavItem[] >;
	/** The sidebar's single zone. Empty in the unified layout. */
	sidebar: NavItem[];
	/** Wallpaper icons, in order. */
	desktop: NavItem[];
	/**
	 * Ids on the dock ONLY because their window is open. They leave
	 * the rail when it closes, and their context menu offers "Keep in
	 * dock" rather than "Hide from dock".
	 */
	ephemeral: ReadonlySet< string >;
}
