/**
 * OpenStation — Dock.
 *
 * Renders the icon-only dock on the left edge of the desktop.
 * Icons come from the admin menu data passed via openStationConfig.dockItems.
 * The dock always starts with a WordPress logo "Show Desktop" button
 * that minimizes all open windows.
 */

import { activity } from './activity';
import { applyFilters, doAction, HOOKS } from './hooks';
import type { WindowManager } from './window-manager';
import { deriveWindowId } from './utils';
import { __, _n, sprintf } from './i18n';
import { hashTitleToHue } from './ui/util/hash-hue';
import {
	resolveThemedIcon,
	resolveThemedIconColor,
} from './desktop-themes/icons';
import { applyIconMask } from './desktop-themes/paint-tinted-icon';
import { slotForTileId } from './desktop-themes/slots';
import { attachDockPeek } from './dock-peek';
import { tryOpenExternalUrl } from './external-url';
import { openItemVisibilityMenu } from './item-visibility-menu-loader';
import {
	resolveNativeUrlRemap,
	tryNativeUrlRemap,
} from './native-url-remap';
import { persistZoneOrder as persistNavZoneOrder } from './nav/config';
import { zoneFor } from './nav/defaults';
import type { NavPlacement } from './nav/types';
// The zones in paint order. One list, shared with the model that
// decides what goes in them — two copies of an ordered enum is two
// places to forget when a zone is added.
import { NAV_ZONES as DOCK_ZONE_ORDER } from './nav/compute';
import { urlActs } from './pwa/acting-url';
import { isShellDocumentUrl } from './shell-url';

/**
 * A JS-registered dock tile appended below the admin-menu items.
 *
 * System items don't come from the PHP `$menu` globals — they're shell-
 * level affordances (OS Settings, future: Jorvy, desktop widgets) that
 * know how to open themselves. The dock doesn't call into WindowManager
 * for these; it just invokes the supplied `onOpen` handler, which is
 * free to open a native window, route to a URL, or anything else.
 *
 * Kept visually separated from menu items by a dividing line so users
 * distinguish "admin pages" from "shell affordances".
 */
export interface SystemDockItem {
	/** Unique dock-internal id (for active-state tracking). */
	id: string;
	/** Display label (tooltip). */
	title: string;
	/** Icon — dashicons class, data URI, or URL. */
	icon: string;
	/**
	 * Handler invoked on click. The originating mouse event, when there
	 * is one, rides along so a tile that navigates can honour the
	 * browser-tab gestures (cmd/ctrl/shift and middle click) — the
	 * Network Admin tile's workspace hop is the shipped example.
	 * Keyboard activation and programmatic opens pass nothing.
	 */
	onOpen: ( event?: MouseEvent ) => void;
	/**
	 * Optional predicate: returns true when the system item currently
	 * has an open window. Drives the active-dot indicator on the tile.
	 */
	isOpen?: () => boolean;
	/**
	 * Whether this system tile supports multiple open windows. When
	 * true, the hover-peek surfaces a trailing Ghost Card ("+ open
	 * another") next to any open instance — matching the menu-tile
	 * peek's affordance so the dock reads consistently regardless of
	 * which rail a tile lives on.
	 */
	multi?: boolean;
	/**
	 * Optional override for the "open another" action when `multi` is
	 * set. Defaults to {@link onOpen}; native-window tiles whose
	 * `onOpen` would just focus an already-open singleton supply this
	 * callback to spawn a fresh instance.
	 */
	onOpenNew?: () => void;
	/**
	 * Whether the tile appears in OpenStation Preferences → Navigation,
	 * so the user can move or hide it.
	 *
	 * Opt-in rather than the default, because most system tiles are
	 * load-bearing: OS Settings is how you reach the very screen that
	 * would hide it. Set this on tiles that are genuinely optional
	 * decoration — Mio's toggle is the canonical case.
	 *
	 * The visibility override is honoured whether or not this is set;
	 * all it controls is whether a row is offered.
	 */
	placeable?: boolean;
	/**
	 * Rows to fan out of this tile on hover, through the same
	 * constellation flyout the admin menus use.
	 *
	 * The panel is the same three sections an admin menu's gets: a head
	 * naming the tile, the live windows the rows have open (resolved
	 * from each row's {@link SubmenuItem.windowId}), and the rows.
	 *
	 * **The head runs `submenu[0]` on click**, standing in for the
	 * landing page the tile does not have — so put nothing destructive
	 * first. `onOpen` runs on a click on the TILE, which is also the
	 * only thing keyboards and touch get, since neither fans the flyout
	 * open. Give every submenu-bearing tile an `onOpen` that does
	 * something defensible on its own.
	 */
	submenu?: SubmenuItem[];
	/**
	 * Sort key among system tiles, ascending. Defaults to 0, and ties
	 * keep registration order.
	 *
	 * Registration order alone cannot express the intended rail:
	 * native-window tiles (Trash, and every plugin's) register on the
	 * lazy-script path and land whenever their bundle resolves, so a
	 * tile registered last in `desktop.ts` is not last on the dock.
	 */
	order?: number;
	/**
	 * The native-window id this tile opens, when it opens one.
	 *
	 * Set by the native-window sync; a shell tile that toggles
	 * something rather than opening a window (Mio's) leaves it unset.
	 * Drives the running indicator and the transient tile a running
	 * window gets when its item lives nowhere on a rail.
	 */
	windowId?: string;
	/**
	 * What the tile IS — which decides its default placement and the
	 * dock zone it sits in. `'app'` (the default) for a launcher,
	 * `'control'` for an OpenStation affordance: Mio, Overview,
	 * System, Trash, Exit. `'core'` for a tile standing in for a
	 * WordPress menu that cannot arrive through `$menu` — the Network
	 * Admin one, which lives on another domain.
	 *
	 * See `src/nav/defaults.ts`. A plugin's launcher wants `'app'`
	 * and gets it by saying nothing.
	 */
	navKind?: 'core' | 'app' | 'control';
	/**
	 * Cannot be moved, hidden, or reordered. Exit OpenStation is the
	 * only one: it is the way out of the shell.
	 */
	locked?: boolean;
	/**
	 * Where this tile should sit when the user has said nothing,
	 * overriding the default for its {@link SystemDockItem.navKind}.
	 *
	 * A native window registered with `'placement' => 'dock'` sets
	 * `'rail'` here, which is what keeps a plugin's launcher on the
	 * dock where it has always been: apps otherwise default to the
	 * wallpaper. The user's own pick still wins over it.
	 */
	defaultPlacement?: NavPlacement;
}

/**
 * One thing painted on a rail, whatever produced it. The dock's zones
 * mix the two cohorts — the apps zone holds plugin admin menus and
 * app launchers side by side — so they travel as a union rather than
 * in two parallel lists.
 */
export type DockEntry =
	| { type: 'menu'; item: DockItem }
	| { type: 'system'; item: SystemDockItem };

/**
 * A rail's contents, in paint order, with a divider drawn between
 * each pair of non-empty zones.
 *
 * Zone membership comes from `computeNav` and is derived from what
 * each item IS. A tile therefore cannot be dragged into another zone,
 * because there is no value a drag could write that would move it.
 */
export interface DockZones {
	/** WordPress's own admin menus. Empty on the dock in the split layout. */
	core: DockEntry[];
	/** Plugin admin menus, app launchers, and running windows with no home. */
	apps: DockEntry[];
	/** OpenStation's own affordances. */
	controls: DockEntry[];
}

/**
 * Which zone a system tile belongs to. Derived from what the tile IS,
 * never from where it happened to be appended.
 */
export function zoneForSystemTile(
	item: SystemDockItem,
): keyof DockZones {
	return zoneFor( item.navKind ?? 'app' );
}

/**
 * A single dock item from the PHP menu data.
 */
/**
 * A single child link of a parent admin menu — what arrives in
 * `DockItem.submenu`. Custom rail renderers that surface submenus
 * with their own UI receive this shape via the `openSubmenuPick`
 * mount-deps callback.
 *
 * @public
 */
export interface SubmenuItem {
	title: string;
	url: string;
	/**
	 * Run this instead of navigating to `url`.
	 *
	 * Client-side only, and deliberately so: the server builds submenu
	 * entries as JSON (`openstation_build_dock_items()`), and a function
	 * cannot survive that trip. Set it from JS on the submenus of
	 * {@link SystemDockItem}, whose rows are shell actions — "Log out",
	 * "Fullscreen" — rather than admin pages. `url` stays the fallback
	 * for anything that can express itself as one.
	 */
	onSelect?: ( event?: MouseEvent ) => void;
	/**
	 * The window this row opens, when it opens one.
	 *
	 * Only needed alongside {@link onSelect}: a row with a real `url`
	 * already yields its window id through `deriveWindowId()`, but a
	 * callback is opaque. Declaring it is what lets the constellation
	 * list a system tile's live windows the way it lists an admin
	 * menu's. Rows that open no window (Log out, Fullscreen) leave it
	 * unset.
	 */
	windowId?: string;
	/**
	 * This row leaves the site.
	 *
	 * Set server-side on a plugin menu's off-site children, a docs or
	 * account link under the plugin's own menu. Nothing off-site can
	 * load in a window, so surfaces that route a URL into one skip
	 * these rows, and the ones that can hand a link to the browser mark
	 * them as leaving.
	 *
	 * Named `offSite`, not `external`, because the window's tab strip
	 * already spends that word on something else: `data-kind="external"`
	 * is a plugin-opened sub-iframe tab, which is very much on-site.
	 */
	offSite?: boolean;
}

export interface DockItem {
	/** Unique identifier (menu slug). */
	id: string;
	/** Display label (for tooltip). */
	title: string;
	/** Icon: dashicons class, data:image/svg+xml, URL, or 'none'. */
	icon: string;
	/** Admin page URL to open. */
	url: string;
	/**
	 * Native-window id this tile targets, when known up front.
	 * Populated for synthesized tiles built from a
	 * `openstation_register_icon()` entry whose `window` field points
	 * at a registered native window (no `url`). The dock prefers this
	 * over deriving an id from `url` for indicator + hover-peek
	 * lookups — without it those synth tiles fall back to
	 * `deriveWindowId('')` and never match the open window, so the
	 * active/focused dot stays dark.
	 */
	windowId?: string;
	/**
	 * Label of the self-link stripped out of `submenu` — "All Posts"
	 * for the Posts menu, "All Pages" for Pages. Empty when the menu
	 * had none.
	 *
	 * `submenu` deliberately excludes the entry itself, because two
	 * consumers need it to mean "distinct child links only" (the tab
	 * strip, which would grow a duplicate first tab; the right-click
	 * popover, suppressed on an empty list). Surfaces that LIST a
	 * menu's pages want it back — the constellation flyout puts it
	 * first, pointing at `url`.
	 */
	selfLabel?: string;
	/** Number badge (update count, comment count, etc.). 0 = no badge. */
	badge: number;
	/** Submenu items. */
	submenu: { title: string; url: string; offSite?: boolean }[];
	/** Whether this admin page supports multiple open windows. */
	multi?: boolean;
	/**
	 * Whether this item is a first-party WordPress core menu entry
	 * (Dashboard, Posts, Media, Plugins, Users, Settings, CPTs,
	 * taxonomies). Used by the dock to render a visual separator
	 * between core and plugin tiles. Server-side classifier lives
	 * in `openstation_is_core_menu_slug`.
	 */
	isCore?: boolean;
	/**
	 * Plugin file (e.g. `woocommerce/woocommerce.php`) that owns this
	 * menu, when resolvable. Set server-side by
	 * `openstation_resolve_menu_plugin_file()`. Used by the dock
	 * right-click menu to surface a "Deactivate plugin" action. Always
	 * `null` for core menus, mu-plugins, drop-ins, and OpenStation
	 * itself — none of those are deactivatable via `wp/v2/plugins`.
	 */
	pluginFile?: string | null;
	/**
	 * Human-readable display name of the owning plugin (e.g.
	 * `"WooCommerce"`), as read from the plugin header's `Name:` field
	 * via `get_plugins()`. Used in the right-click "Deactivate …"
	 * label so a sub-page tile (e.g. WC's "Analytics") still presents
	 * the parent plugin's identity in the destructive action. Null
	 * when `pluginFile` is null.
	 */
	pluginName?: string | null;
}

/** Which edge of the screen the rail hugs. Drives tooltip anchoring + modifier CSS. */
export type DockOrientation = 'left' | 'right' | 'bottom';

/**
 * Context object passed to every dock decoration hook detail. Lets a
 * single subscriber disambiguate between rails when two coexist
 * (Classic layout's left side bar + bottom dock) without reaching
 * into the DOM.
 *
 * `dockId` is the host element's `id` attribute — `'os-dock'`
 * for the bottom rail, `'os-side-dock'` for the Classic side
 * rail. `rail` mirrors `Dock.rail` (`'dock'` or `'taskbar'`) and
 * `orientation` carries the placement.
 *
 * @public
 */
export interface DockHookContextBase {
	rail: 'dock' | 'taskbar';
	orientation: DockOrientation;
	dockId: string;
	container: HTMLElement;
}

/**
 * Context for a single tile being painted. `isSystem` is the
 * discriminator: when `true`, `item` is a {@link SystemDockItem};
 * when `false`, a {@link DockItem} from the admin menu.
 *
 * @public
 */
export interface DockTileContext extends DockHookContextBase {
	item: DockItem | SystemDockItem;
	isSystem: boolean;
}

/**
 * Context for the bulk render hooks ({@link HOOKS.DOCK_BEFORE_RENDER}
 * / {@link HOOKS.DOCK_AFTER_RENDER}). `tileElements` is a frozen
 * map of menu-tile id → DOM element — read-only; mutating it
 * desyncs the rail.
 *
 * @public
 */
export interface DockRenderContext extends DockHookContextBase {
	items: DockItem[];
	tileElements: ReadonlyMap<string, HTMLElement>;
}

/** Attention modes accepted by `Dock.setAttention()` and `Window.requestAttention()`. */
export type DockAttentionMode = 'pulse' | 'shake' | 'bounce' | null;

/** Visual intensity for an attention animation. */
export type DockAttentionIntensity = 'subtle' | 'normal' | 'strong';

/** Options for `Dock.setAttention()` / `Window.requestAttention()`. */
export interface DockAttentionOptions {
	/** Auto-clear after this many ms. `0` = until cleared by another call. Default 4000. */
	durationMs?: number;
	/** Animation intensity. Default `'normal'`. */
	intensity?: DockAttentionIntensity;
}

/**
 * Dock class.
 *
 * Manages a single dock element, its icons, tooltips, and interaction
 * with the window manager. A dock can render along any of three edges
 * (left, right, or bottom); placement is reflected on the dock
 * element's own `data-os-dock-placement` attribute, which CSS
 * keys off for layout, tooltip anchor, and indicator position. This
 * lets two `Dock` instances coexist in the same shell (used by the
 * Classic desktop layout: a left side bar with core menus + a bottom
 * dock with plugin menus) without their selectors colliding.
 */
export class Dock {
	private container: HTMLElement;
	/**
	 * Where menu tiles + the inline group separator live. For vertical
	 * placements this is the inner `.os-dock__scroll` wrapper
	 * (a scrollable flex column) so a long admin menu doesn't push the
	 * system tiles off-screen; the wrapper takes the scroll while the
	 * outer dock stays the height of the shell body. For the bottom
	 * placement it's the dock itself — the horizontal pill has its own
	 * width constraints and doesn't benefit from inner scrolling.
	 */
	private itemHost: HTMLElement;
	/**
	 * Where system tiles + their hairline separator live. For vertical
	 * placements this is the `.os-dock__pinned` wrapper sat
	 * below `itemHost`, so OS Settings / Recycle Bin / etc. stay visible
	 * at the bottom regardless of scroll position. For the bottom
	 * placement it's the dock itself.
	 */
	private systemHost: HTMLElement;
	private windowManager: WindowManager;
	private items: DockItem[];
	private tooltip: HTMLElement;
	private itemElements: Map<string, HTMLElement> = new Map();
	private adminUrl: string;
	private orientation: DockOrientation;
	/**
	 * Routing discriminator stamped onto every event this rail
	 * publishes. `'left'` orientation carries `'dock'`; `'bottom'`
	 * carries `'taskbar'`. Lets a single `os/badge-changed`
	 * subscriber tell the two visually-distinct rails apart
	 * without inferring from id space.
	 */
	private rail: 'dock' | 'taskbar';
	private systemItems: SystemDockItem[] = [];
	private systemItemElements: Map<string, HTMLElement> = new Map();
	/**
	 * The rail's contents by zone — the single description everything
	 * else is derived from. `items` and `systemItems` are views onto
	 * it, kept for the hook payloads and the public API that predate
	 * zones.
	 */
	private zones: DockZones = { core: [], apps: [], controls: [] };
	/**
	 * Client-side badge overrides keyed by item id. Lets
	 * `replaceItems()` re-paint a tile that a JS caller had already
	 * decorated via `setBadge()` — without this map the next live
	 * menu refresh would drop every client-set badge back to the
	 * server-declared `item.badge` value.
	 */
	private badgeOverrides: Map<string, number> = new Map();

	/**
	 * Client-set artwork, keyed by item id. Same job as
	 * {@link badgeOverrides}: a tile whose art was swapped via
	 * `setArt()` has to keep it across a live menu refresh, or the
	 * next plugin activation would silently put the server-declared
	 * icon back.
	 */
	private artOverrides: Map<string, string> = new Map();

	/**
	 * Active attention timers, keyed by item id. Used to cancel a
	 * pending auto-clear when a fresh `setAttention()` call comes in
	 * before the previous duration has elapsed.
	 */
	private attentionTimers: Map<string, number> = new Map();

	/**
	 * Per-tile teardown callbacks for the hover-peek. Populated on
	 * tile creation, drained on `destroy()` and on every `replaceItems`.
	 */
	private peekTeardowns: Map<string, () => void> = new Map();

	/**
	 * Window-lifecycle listener captured here so `destroy()` can
	 * detach it from `document` and the hooks bus. Two simultaneous
	 * docks (Classic layout) each register their own.
	 */
	private boundRefresh: () => void = () => undefined;

	/** Unique hooks-bus namespace per instance for clean teardown. */
	private hooksNamespace: string;

	private static instanceCounter = 0;

	/**
	 * Module-wide "currently-running drag reset" handle. A drag attaches
	 * its escape hatches (pointermove/up/cancel/blur/visibility) to
	 * `document`. If the rail re-renders mid-drag (live menu refresh,
	 * dispatcher refresh after a settings save), the dragged tile is
	 * destroyed but its document listeners keep firing on detached DOM —
	 * blocking the next drag. Every new tile's drag setup calls this
	 * before attaching its own, guaranteeing only one drag is ever live.
	 */
	private static activeDragReset: ( () => void ) | null = null;

	/**
	 * Build the base context object every dock decoration hook
	 * receives. Read from `this` so a single subscriber can
	 * disambiguate two coexisting rails by `dockId`.
	 */
	private buildHookContextBase(): DockHookContextBase {
		return {
			rail: this.rail,
			orientation: this.orientation,
			dockId: this.container.id,
			container: this.container,
		};
	}

	constructor(
		container: HTMLElement,
		windowManager: WindowManager,
		items: DockItem[],
		adminUrl: string,
		orientation: DockOrientation = 'left',
	) {
		this.container = container;
		this.windowManager = windowManager;
		this.items = items;
		this.adminUrl = adminUrl;
		this.orientation = orientation;
		this.rail = orientation === 'bottom' ? 'taskbar' : 'dock';
		this.hooksNamespace = `desktop-mode/dock/${ ++Dock.instanceCounter }`;

		// Placement lives on the dock element itself so two instances
		// (Classic layout's left side bar + bottom dock) can coexist
		// without their CSS scopes colliding. dock.css reads this
		// attribute for layout, tooltip anchor, and indicator anchor.
		//
		// Committed with transitions off, because the container is
		// REUSED across a rebuild. Moving the dock from the bottom edge
		// to a side is a teardown and a fresh Dock on the same element,
		// which arrives still carrying the old placement's padding —
		// and `.os-dock` transitions padding, width and transform (see
		// `window-overview.css`, where they exist to animate the
		// overview collapse). Without this the new dock tweens out of
		// the old one's geometry: it lands a size too big and settles,
		// which reads as a bounce. A rebuild is not a state change and
		// nothing about it should tween.
		//
		// Reading `offsetWidth` between the two lines is what makes it
		// work: it forces the new placement to be resolved while
		// transitions are still off, so it becomes the before-change
		// style rather than a target to animate towards. rAF would be
		// the usual way to wait a frame, and it is the wrong tool —
		// this has to happen before the browser can paint, not after.
		this.container.classList.add( 'os-dock--no-transition' );
		this.container.setAttribute(
			'data-os-dock-placement',
			orientation,
		);
		void this.container.offsetWidth;
		this.container.classList.remove( 'os-dock--no-transition' );

		// Every dock gets two inner wrappers so menu tiles can scroll
		// independently of the system tiles. Vertical placements scroll
		// the menu area vertically with system tiles pinned at the
		// bottom edge; the bottom dock scrolls horizontally with system
		// tiles pinned at the trailing edge. The outer dock keeps the
		// placement attribute + orientation chrome; the wrappers carry
		// the actual flow.
		const scroll = document.createElement( 'div' );
		scroll.className = 'os-dock__scroll';
		const pinned = document.createElement( 'div' );
		pinned.className = 'os-dock__pinned';
		container.appendChild( scroll );
		container.appendChild( pinned );
		this.itemHost = scroll;
		this.systemHost = pinned;

		// Tooltip — shared across all items. Anchor class flips per
		// orientation so the tooltip sits outside the dock regardless
		// of which edge it hugs.
		this.tooltip = document.createElement( 'div' );
		this.tooltip.className = 'os-dock__tooltip';
		this.tooltip.setAttribute( 'role', 'tooltip' );
		// Anchor modifier — applied directly to the tooltip element
		// (not via a descendant selector on the dock) because the
		// tooltip lives in `document.body` for stacking-context
		// reasons. CSS keys off this class for the slide-in animation
		// direction; `positionTooltip()` writes the absolute coords.
		if ( orientation === 'bottom' ) {
			this.tooltip.classList.add( 'os-dock__tooltip--above' );
		} else if ( orientation === 'right' ) {
			this.tooltip.classList.add( 'os-dock__tooltip--before' );
		} else {
			this.tooltip.classList.add( 'os-dock__tooltip--after' );
		}
		document.body.appendChild( this.tooltip );

		this.zones = this.zonesFromMenu( items, [] );
		this.render();
		this.bindWindowEvents();
	}

	/**
	 * Replace the menu-derived tile list with a fresh one, preserving
	 * any JS-registered system tiles. Used by the live menu-refresh
	 * path: after a plugin is activated or deactivated, the chromeless
	 * bridge postMessages a fresh payload built from real admin
	 * context, and the shell calls this so the dock repaints without
	 * a tab reload.
	 *
	 * Old menu tiles are removed from both the DOM and the lookup
	 * map; new tiles are inserted before the system separator (or
	 * appended at the end if none exists yet), so the menu-items →
	 * hairline → system-items ordering stays intact. Active-state
	 * classes are re-computed once the new tiles are in place so
	 * window indicators survive the swap.
	 *
	 * @param items New DockItem list. Pass `[]` to clear everything
	 *              menu-derived.
	 */
	/**
	 * Update the dock's orientation. Writes the new value to the
	 * dock element's `data-os-dock-placement` attribute (CSS
	 * keys off it for layout) and keeps the tooltip anchor in sync.
	 *
	 * In practice, the layout dispatcher in `desktop.ts` rebuilds the
	 * dock(s) from scratch on a layout change rather than re-orienting
	 * a live instance — but this stays correct in case any caller
	 * wants to flip orientation without the rebuild.
	 */
	public setOrientation( orientation: DockOrientation ): void {
		if ( this.orientation === orientation ) {
			return;
		}
		this.orientation = orientation;
		this.container.setAttribute(
			'data-os-dock-placement',
			orientation,
		);
		this.tooltip.classList.remove(
			'os-dock__tooltip--above',
			'os-dock__tooltip--before',
			'os-dock__tooltip--after',
		);
		if ( orientation === 'bottom' ) {
			this.tooltip.classList.add( 'os-dock__tooltip--above' );
		} else if ( orientation === 'right' ) {
			this.tooltip.classList.add( 'os-dock__tooltip--before' );
		} else {
			this.tooltip.classList.add( 'os-dock__tooltip--after' );
		}
	}

	public replaceItems( items: DockItem[] ): void {
		// System entries keep the zone they were appended to; only the
		// menu-derived half is replaced.
		this.zones = this.zonesFromMenu( items, this.systemEntries() );
		this.render();
	}

	/**
	 * Replace the rail's entire contents, zone by zone.
	 *
	 * The layout dispatcher's one write path: it recomputes the whole
	 * navigation from `computeNav` and hands the answer over. Prefer
	 * this to `replaceItems` + `appendSystemItem`, which cannot express
	 * a plugin menu and an app launcher sharing a zone.
	 */
	public setZones( zones: DockZones ): void {
		this.zones = {
			core: zones.core.slice(),
			apps: zones.apps.slice(),
			controls: zones.controls.slice(),
		};
		this.render();
	}

	/** Every system entry across every zone, in paint order. */
	private systemEntries(): DockEntry[] {
		const out: DockEntry[] = [];
		for ( const zone of DOCK_ZONE_ORDER ) {
			for ( const entry of this.zones[ zone ] ) {
				if ( 'system' === entry.type ) {
					out.push( entry );
				}
			}
		}
		return out;
	}

	/**
	 * Zone the menu list by `isCore`, then put the system entries back
	 * where their kind says they belong.
	 *
	 * The legacy shape of the rail — one flat menu list plus a trailing
	 * system cluster — collapses onto zones exactly, which is why
	 * `replaceItems` and `appendSystemItem` keep working for custom
	 * rail renderers that never learned about zones.
	 */
	private zonesFromMenu(
		items: DockItem[],
		systemEntries: DockEntry[],
	): DockZones {
		const zones: DockZones = { core: [], apps: [], controls: [] };
		for ( const item of items ) {
			zones[ item.isCore ? 'core' : 'apps' ].push( {
				type: 'menu',
				item,
			} );
		}
		for ( const entry of systemEntries ) {
			if ( 'system' !== entry.type ) {
				continue;
			}
			zones[ zoneForSystemTile( entry.item ) ].push( entry );
		}
		return zones;
	}

	/**
	 * True when the rail currently has ANY renderable tile —
	 * either a menu-derived item or a JS-registered system item.
	 * Lets callers (the shell's live-refresh path) decide whether
	 * to hide the whole rail without having to peek into two
	 * internal maps. "System tiles keep the rail alive even when
	 * menu items are empty" is the user-visible contract we enforce.
	 */
	public hasItems(): boolean {
		return this.itemElements.size > 0 || this.systemItemElements.size > 0;
	}

	/**
	 * Remove a previously-registered system item. Used by the
	 * server-driven native-window sync path — when a plugin is
	 * deactivated, its native-window entry disappears from the
	 * server's payload and the shell calls this to pull the tile
	 * back off the rail without a reload.
	 *
	 * Idempotent: an unknown id is a silent no-op. The system
	 * separator is kept in place as long as at least one system
	 * item remains; removing the last system item also strips the
	 * separator so the rail doesn't dangle a divider under nothing.
	 */
	public removeSystemItem( id: string ): void {
		let found = false;
		for ( const zone of DOCK_ZONE_ORDER ) {
			const next = this.zones[ zone ].filter(
				( entry ) =>
					'system' !== entry.type || entry.item.id !== id,
			);
			if ( next.length !== this.zones[ zone ].length ) {
				found = true;
			}
			this.zones[ zone ] = next;
		}
		if ( ! found ) {
			return;
		}
		// Drop any client-side badge override the caller had set —
		// the tile is gone, the override would otherwise re-apply
		// on a future re-registration of the same id.
		this.badgeOverrides.delete( id );
		this.artOverrides.delete( id );
		this.render();

		doAction( HOOKS.DOCK_ITEM_REMOVED, { id, placement: this.rail } );
	}

	/**
	 * Set the badge count on a tile. Live-updates without a full
	 * dock re-render — the existing tile's badge node is mutated in
	 * place (or created if missing). Pass `0` to remove the badge.
	 *
	 * Resolves the tile in id order: menu items (`data-menu-slug`)
	 * first, then system items (`data-system-id`), so callers can
	 * use the same id surface regardless of which rail the tile
	 * happens to live on.
	 *
	 * Idempotent: applying the same count is a no-op (no DOM mutation).
	 *
	 * @param itemId Tile id (menu slug for admin pages, system id
	 *               for `appendSystemItem` / `registerSystemTile`).
	 * @param count  Non-negative integer. `>99` renders as `99+`.
	 */
	public setBadge( itemId: string, count: number ): void {
		const tile = this._resolveTileElement( itemId );
		// No tile on this rail — silent no-op. Lets plugin authors
		// fan a count to every rail (`dock.setBadge`, `taskbar.setBadge`,
		// `icons.setBadge`) without each call double-emitting. The
		// rail that actually owns the tile is the only one that
		// paints and publishes; the others see "this id isn't mine"
		// and bow out cleanly.
		if ( ! tile ) {
			return;
		}
		const safe = Math.max( 0, Math.floor( Number( count ) || 0 ) );

		// Track the client-side override so `replaceItems()` (live
		// menu refresh) can re-apply it without having to re-call
		// every plugin's badge wiring. `0` clears the override so
		// the server-declared `item.badge` resumes ownership.
		if ( safe === 0 ) {
			this.badgeOverrides.delete( itemId );
		} else {
			this.badgeOverrides.set( itemId, safe );
		}

		const primary = tile.querySelector< HTMLElement >(
			'.os-dock__item-primary',
		);
		_applyBadgeNode( primary ?? tile, safe );

		// Single emission point — activity bus. `rail` is the
		// routing discriminator so a single subscriber can
		// compose dock + taskbar + icons under one shape.
		activity.publish( 'os/badge-changed', {
			itemId,
			count: safe,
			rail: this.rail,
		} );
	}

	/**
	 * Clear the badge on a tile. Equivalent to `setBadge( id, 0 )`.
	 */
	public clearBadge( itemId: string ): void {
		this.setBadge( itemId, 0 );
	}

	/**
	 * Swap a tile's artwork.
	 *
	 * The counterpart to {@link setBadge} for apps whose tile means
	 * something different depending on state, rather than counting
	 * something. The Recycle Bin is the in-tree example: an empty bin
	 * and a bin holding something are two drawings of one object, and
	 * a tile that changes shape says it without spending a corner on
	 * a number.
	 *
	 * Same fan-out contract as `setBadge`: an id this rail doesn't own
	 * is a silent no-op, so a caller can fan one change to
	 * `dock.setArt`, `taskbar.setArt` and `icons.setArt` and let the
	 * rail that owns the tile be the one that paints.
	 *
	 * `svg` takes the same shapes {@link renderIcon} accepts, so a
	 * data URI, an http(s) URL, or a dashicon class. Art naming
	 * `currentColor` is painted as a mask and follows the tile's own
	 * glyph colour; fixed-colour art keeps its own.
	 *
	 * Survives a live menu refresh — see {@link artOverrides}. Pass an
	 * empty string to drop the override and hand the tile back to the
	 * server-declared icon.
	 *
	 * @public
	 *
	 * @param itemId Tile id.
	 * @param svg    Icon string, or `''` to restore the original.
	 */
	public setArt( itemId: string, svg: string ): void {
		// Clearing restores the declared icon immediately, the way
		// `setBadge( id, 0 )` removes the pill immediately rather than
		// waiting for the next rebuild.
		if ( ! svg ) {
			if ( ! this.artOverrides.delete( itemId ) ) {
				return; // Nothing was overridden — nothing changed.
			}
			const tile = this._resolveTileElement( itemId );
			const declared = this._declaredIcon( itemId );
			if ( tile && declared ) {
				this._paintArt( tile, itemId, declared );
			}
			activity.publish( 'os/art-changed', {
				itemId,
				icon: '',
				rail: this.rail,
			} );
			return;
		}

		// Record BEFORE painting. A caller that sets art during boot
		// usually beats the rail to the DOM (the bin does exactly
		// this), and the tile builders re-apply from this map, so an
		// early call lands the moment the tile exists rather than
		// being dropped on the floor.
		this.artOverrides.set( itemId, svg );
		const tile = this._resolveTileElement( itemId );
		if ( ! tile ) {
			return;
		}
		this._paintArt( tile, itemId, svg );
		activity.publish( 'os/art-changed', {
			itemId,
			icon: svg,
			rail: this.rail,
		} );
	}

	/**
	 * The icon a tile was registered with, menu item or system item.
	 * Used to put things back when an art override is cleared.
	 */
	private _declaredIcon( itemId: string ): string {
		const menu = this.items.find( ( i ) => i.id === itemId );
		if ( menu ) {
			return menu.icon;
		}
		const system = this.systemItems.find( ( i ) => i.id === itemId );
		return system ? system.icon : '';
	}

	/**
	 * Repaint a tile's icon node in place.
	 *
	 * Replaces whatever the icon currently is — dashicon span, `<img>`,
	 * mask span — with a mask span carrying the new art, so a tile can
	 * cross between icon shapes without the caller knowing which one it
	 * started as. Falls back to leaving the node alone when the art
	 * isn't maskable, which is the same "don't make it worse" rule
	 * `resolveIcon` follows.
	 */
	private _paintArt( tile: HTMLElement, itemId: string, svg: string ): void {
		const primary =
			tile.querySelector< HTMLElement >( '.os-dock__item-primary' ) ??
			tile;
		// Route through the rail's own resolver rather than masking by
		// hand, so `setArt` accepts everything a registered icon does —
		// dashicon class, data URI, http(s) URL — and still honours a
		// desktop theme's slot override. Hand-rolling the mask here
		// would have quietly rejected dashicons.
		const next = this.resolveIcon(
			svg,
			this._declaredTitle( itemId ),
			undefined,
			slotForTileId( itemId ),
		);
		const current = primary.querySelector< HTMLElement >(
			'.os-dock__item-mask, .os-dock__item-svg, .dashicons, img',
		);
		if ( current ) {
			current.replaceWith( next );
		} else {
			primary.prepend( next );
		}
	}

	/** Registered title for a tile, for the letter-badge fallback. */
	private _declaredTitle( itemId: string ): string {
		const menu = this.items.find( ( i ) => i.id === itemId );
		if ( menu ) {
			return menu.title;
		}
		const system = this.systemItems.find( ( i ) => i.id === itemId );
		return system ? system.title : '';
	}

	/**
	 * Apply or clear an attention animation on a tile.
	 *
	 *   - `'pulse'`  — soft halo + scale, ~1.4 s loop. Default.
	 *   - `'shake'`  — short horizontal jiggle.
	 *   - `'bounce'` — vertical bob, attention-grabbing.
	 *   - `null`     — clear any active attention.
	 *
	 * Animations are gated on `prefers-reduced-motion: no-preference`;
	 * the reduced-motion fallback shows a static accent ring for the
	 * same duration so the affordance still works. `durationMs` of
	 * `0` keeps the attention until the next call clears it.
	 *
	 * @param itemId Tile id.
	 * @param mode   Animation mode or `null` to clear.
	 * @param opts   Optional duration / intensity overrides.
	 */
	public setAttention(
		itemId: string,
		mode: DockAttentionMode,
		opts: DockAttentionOptions = {},
	): void {
		const tile = this._resolveTileElement( itemId );
		if ( ! tile ) {
			return;
		}

		// Cancel any pending auto-clear from a previous call.
		const pending = this.attentionTimers.get( itemId );
		if ( pending !== undefined ) {
			window.clearTimeout( pending );
			this.attentionTimers.delete( itemId );
		}

		// Strip every prior attention class before applying the new one.
		tile.classList.remove(
			'os-dock__item--attention-pulse',
			'os-dock__item--attention-shake',
			'os-dock__item--attention-bounce',
			'os-dock__item--intensity-subtle',
			'os-dock__item--intensity-normal',
			'os-dock__item--intensity-strong',
		);

		if ( mode === null ) {
			return;
		}

		tile.classList.add( `os-dock__item--attention-${ mode }` );
		const intensity = opts.intensity ?? 'normal';
		tile.classList.add( `os-dock__item--intensity-${ intensity }` );

		const duration = opts.durationMs ?? 4000;
		if ( duration > 0 ) {
			const handle = window.setTimeout( () => {
				this.attentionTimers.delete( itemId );
				this.setAttention( itemId, null );
			}, duration );
			this.attentionTimers.set( itemId, handle );
		}
	}

	/**
	 * Resolve a tile element by id — checks menu items first
	 * (`data-menu-slug`), then system items (`data-system-id`). Used
	 * by `setBadge` / `setAttention` so callers can reach either rail
	 * with one id surface.
	 */
	private _resolveTileElement( itemId: string ): HTMLElement | null {
		return (
			this.itemElements.get( itemId ) ??
			this.systemItemElements.get( itemId ) ??
			null
		);
	}

	/**
	 * Append a JS-registered system item to the rail.
	 *
	 * The tile lands in the zone its {@link SystemDockItem.navKind}
	 * names — the apps zone for a launcher, the controls zone for one
	 * of OpenStation's own affordances — and sorts among the other
	 * system tiles there by {@link SystemDockItem.order}. Call order
	 * cannot decide it: native-window tiles arrive whenever their lazy
	 * script resolves.
	 *
	 * Idempotent on id: re-appending replaces the previous tile.
	 */
	public appendSystemItem( item: SystemDockItem ): void {
		const zone = zoneForSystemTile( item );
		const entry: DockEntry = { type: 'system', item };
		// Drop any previous registration of this id from every zone,
		// so a re-register after a navKind change doesn't leave a
		// stale tile behind.
		for ( const z of DOCK_ZONE_ORDER ) {
			this.zones[ z ] = this.zones[ z ].filter(
				( e ) => 'system' !== e.type || e.item.id !== item.id,
			);
		}
		const list = this.zones[ zone ];
		const order = item.order ?? 0;
		// First system entry with a strictly greater order wins, so
		// equal orders keep registration order and menu entries (which
		// carry no order) always lead.
		const at = list.findIndex(
			( e ) => 'system' === e.type && ( e.item.order ?? 0 ) > order,
		);
		if ( at === -1 ) {
			list.push( entry );
		} else {
			list.splice( at, 0, entry );
		}
		this.render();
	}

	/**
	 * Paint the rail from {@link zones}.
	 *
	 * Three zones, two hosts: `core` and `apps` share the scrollable
	 * host so a long admin menu can scroll without taking the controls
	 * with it, and `controls` sits in the pinned host at the trailing
	 * edge. A divider is drawn between each pair of ADJACENT NON-EMPTY
	 * zones, so a split-layout dock (whose core zone is empty, its
	 * menus being in the sidebar) opens with apps rather than with a
	 * lonely separator.
	 */
	private render(): void {
		// Cancel any in-flight drag — the dragged tile is about to be
		// destroyed below. Without this its document-level listeners
		// keep firing on detached DOM and block the next drag.
		if ( Dock.activeDragReset ) {
			const prev = Dock.activeDragReset;
			Dock.activeDragReset = null;
			prev();
		}

		// Tear down peeks from the previous render — each tile is about
		// to be discarded, so its hover listeners would dangle on a
		// detached node. Idempotent.
		for ( const teardown of this.peekTeardowns.values() ) {
			teardown();
		}
		this.peekTeardowns.clear();

		this.itemHost.innerHTML = '';
		this.systemHost.innerHTML = '';
		this.itemElements.clear();
		this.systemItemElements.clear();

		this.items = [];
		this.systemItems = [];
		for ( const zone of DOCK_ZONE_ORDER ) {
			for ( const entry of this.zones[ zone ] ) {
				if ( 'menu' === entry.type ) {
					this.items.push( entry.item );
				} else {
					this.systemItems.push( entry.item );
				}
			}
		}

		const base = this.buildHookContextBase();
		doAction( HOOKS.DOCK_BEFORE_RENDER, {
			...base,
			items: this.items,
			tileElements: this.itemElements as ReadonlyMap<string, HTMLElement>,
		} );

		let painted = false;
		for ( const zone of DOCK_ZONE_ORDER ) {
			const entries = this.zones[ zone ];
			if ( 0 === entries.length ) {
				continue;
			}
			const host =
				'controls' === zone ? this.systemHost : this.itemHost;
			if ( painted ) {
				const sep = document.createElement( 'div' );
				// The controls divider keeps the plain modifier it has
				// always had: it separates two HOSTS, and the pinned
				// host styles its own leading edge from it.
				sep.className =
					'controls' === zone
						? 'os-dock__separator'
						: 'os-dock__separator os-dock__separator--group';
				sep.setAttribute( 'aria-hidden', 'true' );
				host.appendChild( sep );
			}
			for ( const entry of entries ) {
				this.paintEntry( entry, zone, host, base );
			}
			painted = true;
		}

		this.updateActiveStates();

		doAction( HOOKS.DOCK_AFTER_RENDER, {
			...base,
			items: this.items,
			tileElements: this.itemElements as ReadonlyMap<string, HTMLElement>,
		} );
	}

	/** Build one tile, stamp its zone, and hang it in `host`. */
	private paintEntry(
		entry: DockEntry,
		zone: keyof DockZones,
		host: HTMLElement,
		base: DockHookContextBase,
	): void {
		const id = entry.item.id;
		const tile =
			'menu' === entry.type
				? this.createItemButton( entry.item )
				: this.createSystemItemButton( entry.item );
		// The zone is what scopes a drag: a gesture only reorders tiles
		// carrying the same value, so there is no cross-zone drop to
		// reject.
		tile.dataset.zone = zone;
		tile.dataset.navId = id;
		const locked =
			'system' === entry.type && true === entry.item.locked;
		if ( locked ) {
			// `'true'`, not `''`: a dataset value of the empty string
			// is falsy, so a `! el.dataset.navLocked` guard would read
			// a locked tile as unlocked. Presence is what is meant, so
			// the drag tests for presence too.
			tile.dataset.navLocked = 'true';
		} else {
			this.attachDragReorder( tile, id, zone );
			// Right-click → the placement menu. Mounted on the tile
			// (not the primary button) so a contextmenu inside the
			// badge or the submenu chevron still triggers it, and on
			// both cohorts because a launcher is as movable as a menu.
			tile.addEventListener( 'contextmenu', ( ev: MouseEvent ) => {
				ev.preventDefault();
				openItemVisibilityMenu( {
					x: ev.clientX,
					y: ev.clientY,
					id,
					title: entry.item.title,
					surface: 'dock',
					pluginFile:
						'menu' === entry.type
							? entry.item.pluginFile ?? null
							: null,
					pluginName:
						'menu' === entry.type
							? entry.item.pluginName ?? null
							: null,
				} );
			} );
		}
		if ( 'menu' === entry.type ) {
			this.itemElements.set( id, tile );
		} else {
			this.systemItemElements.set( id, tile );
		}
		host.appendChild( tile );

		// Re-apply any client-side badge / art override set before this
		// render. Without this a live menu refresh would drop every
		// JS-set decoration back to the server-declared value.
		const badge = this.badgeOverrides.get( id );
		if ( badge !== undefined ) {
			const primary = tile.querySelector< HTMLElement >(
				'.os-dock__item-primary',
			);
			_applyBadgeNode( primary ?? tile, badge );
		}
		const art = this.artOverrides.get( id );
		if ( art ) {
			this._paintArt( tile, id, art );
		}

		doAction( HOOKS.DOCK_TILE_RENDERED, {
			...base,
			item: entry.item,
			isSystem: 'system' === entry.type,
			el: tile,
		} );
	}

	/**
	 * Create a tile for a JS-registered system item. Structurally
	 * simpler than a menu tile — no submenu rail, no multi-instance
	 * chips, no badge — but built on the same base classes so hover,
	 * focus and active styling are shared.
	 */
	private createSystemItemButton( item: SystemDockItem ): HTMLElement {
		const ctx: DockTileContext = {
			...this.buildHookContextBase(),
			item,
			isSystem: true,
		};

		const tile = document.createElement( 'div' );
		const baseClasses = [
			'os-dock__item',
			'os-dock__item--system',
		];
		const filteredClasses = applyFilters< string[] >(
			HOOKS.DOCK_TILE_CLASS,
			baseClasses,
			ctx,
		);
		tile.className = filteredClasses.join( ' ' );
		tile.dataset.systemId = item.id;
		// The constellation resolves a flyout from this attribute the
		// way it resolves a menu one from `data-menu-slug`, and
		// `dock-peek` stands down on it for the same reason it stands
		// down on that one: two popovers on one tile is a flicker.
		if ( item.submenu && item.submenu.length > 0 ) {
			tile.dataset.constellationId = item.id;
		}

		const primary = document.createElement( 'button' );
		primary.className = 'os-dock__item-primary';
		primary.setAttribute( 'type', 'button' );
		primary.setAttribute( 'aria-label', item.title );

		primary.appendChild(
			this.resolveIcon(
				item.icon,
				item.title,
				undefined,
				slotForTileId( item.id ),
			),
		);
		// System items don't have a native admin-menu counterpart; the
		// third arg is intentionally omitted.
		primary.addEventListener( 'click', ( event ) => item.onOpen( event ) );

		tile.appendChild( primary );
		this.bindTooltipFiltered( tile, item.title, ctx );

		// System items represent native windows (OS Settings, Jorvy,
		// plugin-registered native windows). When the window is open
		// the peek shows a thumbnail card matching the live window's
		// chrome — same as a menu tile. Ghost Card defaults to off
		// (most system tiles are singletons by convention) but tiles
		// that declare `multi: true` opt in, matching the menu-tile
		// peek's "+ open another" affordance.
		const teardown = attachDockPeek( {
			tile,
			item: {
				id: item.id,
				title: item.title,
				icon: item.icon,
				url: '',
			},
			// System tiles target a single native-window id; that id
			// is also the baseId the manager stores duplicates under
			// when the user opens additional instances via the Ghost
			// Card. `getAllByBaseId` returns `[]` / `[one]` for the
			// singleton cases and the full set when a multi-capable
			// system tile (`multi: true`) has been duplicated.
			getInstances: () => this.windowManager.getAllByBaseIdOnActiveDesktop( item.id ),
			enableGhost: !! item.multi,
			windowManager: this.windowManager,
			getOrientation: () => this.orientation,
			openNew: () => {
				const fn = item.onOpenNew ?? item.onOpen;
				fn();
			},
			suppressTooltip: ( on: boolean ) => {
				if ( on ) {
					this.tooltip.classList.remove(
						'os-dock__tooltip--visible',
					);
				}
			},
		} );
		this.peekTeardowns.set( `system:${ item.id }`, teardown );

		return applyFilters< HTMLElement >(
			HOOKS.DOCK_TILE_ELEMENT,
			tile,
			ctx,
		);
	}

	/**
	 * Create a single dock icon tile.
	 *
	 * A tile is a vertical stack: the primary icon button, plus — for
	 * multi-capable pages — an instance rail rendered below it showing one
	 * dot per open window and a trailing "+" to open another. The rail is
	 * hydrated by {@link updateActiveStates}; here we only place the empty
	 * container so the DOM is stable.
	 */
	private createItemButton( item: DockItem ): HTMLElement {
		const ctx: DockTileContext = {
			...this.buildHookContextBase(),
			item,
			isSystem: false,
		};

		const tile = document.createElement( 'div' );
		const baseClasses = [ 'os-dock__item' ];
		if ( item.multi ) {
			baseClasses.push( 'os-dock__item--multi' );
		}
		const filteredClasses = applyFilters< string[] >(
			HOOKS.DOCK_TILE_CLASS,
			baseClasses,
			ctx,
		);
		tile.className = filteredClasses.join( ' ' );
		tile.dataset.menuSlug = item.id;

		// Primary button — the icon body. Focuses existing or opens first.
		const primary = document.createElement( 'button' );
		primary.className = 'os-dock__item-primary';
		primary.setAttribute( 'type', 'button' );
		primary.setAttribute( 'aria-label', item.title );

		const iconEl = this.resolveIcon(
			item.icon,
			item.title,
			item.url,
			slotForTileId( item.id ),
		);
		primary.appendChild( iconEl );

		if ( item.badge > 0 ) {
			// Cap the rendered count at 99 — anything higher reads as
			// "99+" so the badge stays a clean pill instead of
			// stretching to three or four digits.
			const displayCount = item.badge > 99 ? '99+' : String( item.badge );
			const badge = document.createElement( 'span' );
			badge.className = 'os-dock__badge';
			badge.textContent = displayCount;
			badge.setAttribute(
				'aria-label',
				sprintf(
					// translators: %d is the number of pending updates / items.
					_n( '%d update', '%d updates', item.badge ),
					item.badge,
				),
			);
			primary.appendChild( badge );
		}

		primary.addEventListener( 'click', () => {
			this.openPage( item );
		} );

		tile.appendChild( primary );

		this.bindTooltipFiltered( tile, item.title, ctx );

		// Every dock tile gets the hover-peek when its window is open.
		// Multi-capable tiles fan out one card per open instance + a
		// Ghost Card that spawns a fresh instance. Singleton tiles
		// (Plugins, Appearance, Tools, Settings, plus any plugin page
		// not flagged `multi`) show a single focus card with no Ghost
		// Card — there's nothing meaningful about "open another
		// Settings."
		//
		// `baseId` MUST be the key the window-manager stores instances
		// under. For tiles whose URL is currently captured by a
		// native-window remap (e.g. Posts → `desktop-mode-posts`
		// under the `nativePostsEnabled` opt-in), that's the native
		// window id, not the iframe slug. Without the remap-aware
		// lookup, hovering the Posts tile finds no instances and
		// the peek card never appears even when the native window
		// is open.
		const baseId = this.resolveItemBaseId( item );
		const teardown = attachDockPeek( {
			tile,
			item: {
				id: item.id,
				title: item.title,
				icon: item.icon,
				url: item.url,
			},
			// Source instances from `getAllByBaseId` regardless of
			// `item.multi`. The Ghost Card spawns duplicates on every
			// tile (the `enableGhost: true` below), so any tile —
			// including ones synthesized from a desktop icon, where
			// `multi` is never set — can end up with >1 open instance.
			// A `multi`-gated singleton lookup would only return the
			// first window and the peek would silently underreport.
			// For genuine singletons that never get duplicated, the
			// returned array is just `[one]` (or `[]`), same shape the
			// old branch produced.
			getInstances: () => this.windowManager.getAllByBaseIdOnActiveDesktop( baseId ),
			// Ghost Card on EVERY tile, regardless of `multi`. The
			// affordance reads consistently across the dock — every
			// hover-peek surfaces a "+ open another <Page>" card. For
			// multi-capable items, clicking it spawns a fresh
			// instance. For singletons it falls through to the same
			// open-or-focus path the tile click takes — usually a
			// no-op (focuses the existing window) but cheap and
			// visually consistent.
			enableGhost: true,
			windowManager: this.windowManager,
			getOrientation: () => this.orientation,
			openNew: () => this.openNewInstance( item ),
			suppressTooltip: ( on: boolean ) => {
				if ( on ) {
					this.tooltip.classList.remove(
						'os-dock__tooltip--visible',
					);
				}
			},
		} );
		this.peekTeardowns.set( item.id, teardown );

		this.bindHoverPrewarm( tile, item );

		return applyFilters< HTMLElement >(
			HOOKS.DOCK_TILE_ELEMENT,
			tile,
			ctx,
		);
	}

	/**
	 * Drag-to-reorder for menu tiles. Fixed slots — no interpolated
	 * positioning. While dragging:
	 *
	 * 1. Pointer down on the primary button starts a tentative drag.
	 *    Click handling is preserved by requiring movement past a
	 *    small threshold before we claim the gesture.
	 * 2. Once claimed, the tile gets a `--dragging` modifier so CSS
	 *    can lift it visually. Every `pointermove` checks which other
	 *    menu tile the cursor is currently over; if it's a different
	 *    tile, we splice the dragged tile in front of it (so adjacent
	 *    tiles slide into the vacated slot).
	 * 3. On `pointerup` we read the resulting DOM order, persist the
	 *    new id list to `navOrder` via the public settings writer,
	 *    and the layout-dispatcher subscriber re-applies. Cancellation
	 *    (Escape, pointercancel) reverts to the original order.
	 */
	private attachDragReorder(
		tile: HTMLElement,
		itemId: string,
		zone: keyof DockZones,
	): void {
		const THRESHOLD = 5; // px the pointer must move before claiming.
		const FLIP_MS = 200;
		let active = false;
		let startX = 0;
		let startY = 0;
		let originalOrder: string[] = [];
		let originalNext: ChildNode | null = null;
		let pointerId = -1;
		let originRect: DOMRect | null = null;
		let justDragged = false;
		// Defensive guard: belt-and-braces cleanup if listeners are
		// somehow detached without the gesture completing (browser
		// hands the pointer to another consumer, devtools pause,
		// a third-party event swallowed our pointerup). Without
		// this, the tile stays stuck in `--dragging` and the user
		// can't grab it again because subsequent pointerdowns think
		// a gesture is already running.
		const hardReset = (): void => {
			active = false;
			tile.classList.remove( 'os-dock__item--dragging' );
			tile.style.transform = '';
			tile.style.transition = '';
			document.removeEventListener( 'pointermove', onMove );
			document.removeEventListener( 'pointerup', onUp );
			document.removeEventListener( 'pointercancel', onCancel );
			document.removeEventListener( 'keydown', onKey, true );
			window.removeEventListener( 'blur', onBlur );
			document.removeEventListener( 'visibilitychange', onVisibility );
			pointerId = -1;
			originRect = null;
		};

		// The drag's host is the one the zone paints into: the two
		// scrolling zones share an element, the controls zone has its
		// own.
		const host: HTMLElement =
			'controls' === zone ? this.systemHost : this.itemHost;

		/**
		 * A tile this gesture may reorder against.
		 *
		 * Same zone, and nothing else. Zones are the whole boundary:
		 * a tile cannot be dragged into another one because a drop
		 * outside its own zone simply never matches, so there is no
		 * cross-zone move to detect and undo.
		 *
		 * A locked tile is excluded as a TARGET, not just as a thing
		 * to pick up. Exit OpenStation carries no drag handler, but a
		 * neighbour's gesture still hit-tests against it, and matching
		 * here would let the drag reorder across it and write its id
		 * into the persisted order — after which every load paints it
		 * wherever it was dragged through.
		 */
		const isSameZoneTile = ( el: Element | null ): el is HTMLElement => {
			return (
				!! el &&
				el instanceof HTMLElement &&
				el.classList.contains( 'os-dock__item' ) &&
				el.dataset.zone === zone &&
				!! el.dataset.navId &&
				undefined === el.dataset.navLocked
			);
		};

		const eachSiblingTile = ( fn: ( el: HTMLElement ) => void ): void => {
			for ( const child of Array.from( host.children ) ) {
				if (
					child instanceof HTMLElement &&
					child !== tile &&
					isSameZoneTile( child )
				) {
					fn( child );
				}
			}
		};

		const snapshotZoneOrder = (): string[] => {
			const ids: string[] = [];
			for ( const child of Array.from( host.children ) ) {
				if ( isSameZoneTile( child ) ) {
					ids.push( child.dataset.navId as string );
				}
			}
			return ids;
		};

		/**
		 * FLIP — animate siblings from their previous rect to their
		 * new rect. Snapshot deltas, apply inverse transform with no
		 * transition, then in the next frame remove the transform so
		 * the transition CSS carries them home.
		 */
		const flipSiblings = (
			prevRects: Map< Element, DOMRect >,
		): void => {
			eachSiblingTile( ( sib ) => {
				const prev = prevRects.get( sib );
				if ( ! prev ) {
					return;
				}
				const now = sib.getBoundingClientRect();
				const dx = prev.left - now.left;
				const dy = prev.top - now.top;
				if ( Math.abs( dx ) < 0.5 && Math.abs( dy ) < 0.5 ) {
					return;
				}
				sib.style.transition = 'none';
				sib.style.transform = `translate(${ dx }px, ${ dy }px)`;
				// Force layout flush so the transform sticks before
				// we remove it.
				void sib.offsetHeight;
				sib.style.transition = `transform ${ FLIP_MS }ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
				sib.style.transform = '';
				const onEnd = (): void => {
					sib.style.transition = '';
					sib.style.transform = '';
					sib.removeEventListener( 'transitionend', onEnd );
				};
				sib.addEventListener( 'transitionend', onEnd );
			} );
		};

		const onMove = ( ev: PointerEvent ): void => {
			// Filter to the pointer that initiated this gesture so a
			// second touch / mouse doesn't accidentally drive it.
			if ( pointerId !== -1 && ev.pointerId !== pointerId ) {
				return;
			}
			if ( ! active ) {
				const dx = ev.clientX - startX;
				const dy = ev.clientY - startY;
				if ( dx * dx + dy * dy < THRESHOLD * THRESHOLD ) {
					return;
				}
				// Claim the gesture.
				active = true;
				originalOrder = snapshotZoneOrder();
				originalNext = tile.nextSibling;
				originRect = tile.getBoundingClientRect();
				tile.classList.add( 'os-dock__item--dragging' );
				// Suppress the hover tooltip & peek for the duration.
				this.tooltip.classList.remove(
					'os-dock__tooltip--visible',
				);
			}

			if ( ! originRect ) {
				return;
			}

			// Translate the dragged tile by the cursor delta from its
			// initial press position so it follows the cursor.
			const dx = ev.clientX - startX;
			const dy = ev.clientY - startY;
			tile.style.transform = `translate(${ dx }px, ${ dy }px)`;

			// Hit-test for a sibling under the cursor. The dragged
			// tile has CSS `pointer-events: none` so it never returns
			// itself — the deepest non-dragged element wins.
			const under = document.elementFromPoint( ev.clientX, ev.clientY );
			const targetTile = under?.closest(
				'.os-dock__item',
			) as HTMLElement | null;
			if ( ! targetTile || targetTile === tile ) {
				return;
			}
			if ( ! isSameZoneTile( targetTile ) ) {
				return;
			}

			// Determine which half of the target the cursor is in.
			// Bottom (horizontal) docks compare X; side (vertical) docks
			// compare Y.
			const rect = targetTile.getBoundingClientRect();
			let insertBefore: boolean;
			if ( this.orientation === 'bottom' ) {
				insertBefore = ev.clientX < rect.left + rect.width / 2;
			} else {
				insertBefore = ev.clientY < rect.top + rect.height / 2;
			}

			// Snapshot the BEFORE rects of every non-dragged sibling so
			// we can FLIP them once the DOM has been reordered.
			const prevRects = new Map< Element, DOMRect >();
			eachSiblingTile( ( sib ) => {
				prevRects.set( sib, sib.getBoundingClientRect() );
			} );

			let reordered = false;
			if ( insertBefore ) {
				if ( targetTile !== tile.nextSibling ) {
					host.insertBefore( tile, targetTile );
					reordered = true;
				}
			} else if ( targetTile.nextSibling !== tile ) {
				host.insertBefore( tile, targetTile.nextSibling );
				reordered = true;
			}

			if ( reordered ) {
				// The dragged tile's in-flow slot moved. Re-base the
				// cursor anchor to the centre of the new slot so
				// subsequent translates stay smooth — without this,
				// the tile would jump by the slot-width on every
				// swap. We measure with no transform applied so the
				// rect reflects the true in-flow position.
				tile.style.transform = '';
				const fresh = tile.getBoundingClientRect();
				startX = fresh.left + fresh.width / 2;
				startY = fresh.top + fresh.height / 2;
				tile.style.transform = `translate(${
					ev.clientX - startX
				}px, ${ ev.clientY - startY }px)`;
				flipSiblings( prevRects );
			}
		};

		const cleanup = (): void => {
			tile.classList.remove( 'os-dock__item--dragging' );
			tile.style.transform = '';
			tile.style.transition = '';
			document.removeEventListener( 'pointermove', onMove );
			document.removeEventListener( 'pointerup', onUp );
			document.removeEventListener( 'pointercancel', onCancel );
			document.removeEventListener( 'keydown', onKey, true );
			window.removeEventListener( 'blur', onBlur );
			document.removeEventListener( 'visibilitychange', onVisibility );
			pointerId = -1;
			originRect = null;
			active = false;
			if ( Dock.activeDragReset === hardReset ) {
				Dock.activeDragReset = null;
			}
		};

		const animateHome = (): void => {
			// Snap the dragged tile back to its slot with the same
			// curve the siblings used — covers the "no swap, user
			// released" case AND the cancellation case.
			tile.style.transition = `transform ${ FLIP_MS }ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
			tile.style.transform = '';
			const onEnd = (): void => {
				tile.style.transition = '';
				tile.removeEventListener( 'transitionend', onEnd );
			};
			tile.addEventListener( 'transitionend', onEnd );
		};

		const persistZoneOrder = ( finalOrder: string[] ): void => {
			void itemId;
			persistNavZoneOrder( finalOrder );
		};

		const onUp = ( ev: PointerEvent ): void => {
			if ( pointerId !== -1 && ev.pointerId !== pointerId ) {
				return;
			}
			if ( ! active ) {
				cleanup();
				return;
			}
			justDragged = true;
			const finalOrder = snapshotZoneOrder();
			animateHome();
			cleanup();

			const same =
				finalOrder.length === originalOrder.length &&
				finalOrder.every( ( id, i ) => id === originalOrder[ i ] );
			if ( ! same ) {
				persistZoneOrder( finalOrder );
			}
			setTimeout( () => {
				justDragged = false;
			}, 200 );
		};

		const onCancel = ( ev?: PointerEvent ): void => {
			if ( ev && pointerId !== -1 && ev.pointerId !== pointerId ) {
				return;
			}
			if ( active && originalNext !== undefined ) {
				const prevRects = new Map< Element, DOMRect >();
				eachSiblingTile( ( sib ) => {
					prevRects.set( sib, sib.getBoundingClientRect() );
				} );
				host.insertBefore( tile, originalNext );
				flipSiblings( prevRects );
			}
			animateHome();
			cleanup();
		};

		const onKey = ( ev: KeyboardEvent ): void => {
			if ( ev.key === 'Escape' ) {
				onCancel();
			}
		};

		// Window/tab losing focus or visibility while a drag is in
		// flight: cancel cleanly so the tile doesn't get stuck in
		// `--dragging` when the user comes back. The browser may also
		// silently drop the pointer capture in these cases.
		const onBlur = (): void => onCancel();
		const onVisibility = (): void => {
			if ( document.visibilityState !== 'visible' ) {
				onCancel();
			}
		};

		tile.addEventListener( 'pointerdown', ( ev: PointerEvent ) => {
			if ( ev.button !== 0 ) {
				return;
			}
			// Cancel any in-flight drag from a previous tile that may
			// have been orphaned by a rail rebuild. The module-wide
			// handle calls the OWNER's hardReset, detaching its
			// document-level listeners — without this, the orphan's
			// listeners would race ours and the new gesture would
			// look "stuck" because two parallel drags fight for the
			// same pointer.
			if ( Dock.activeDragReset ) {
				const prev = Dock.activeDragReset;
				Dock.activeDragReset = null;
				prev();
			}
			// Also reset our own state in case this same tile's
			// previous gesture didn't clean up.
			if ( active || pointerId !== -1 ) {
				hardReset();
			}
			startX = ev.clientX;
			startY = ev.clientY;
			pointerId = ev.pointerId;
			active = false;
			Dock.activeDragReset = hardReset;
			document.addEventListener( 'pointermove', onMove );
			document.addEventListener( 'pointerup', onUp );
			document.addEventListener( 'pointercancel', onCancel );
			document.addEventListener( 'keydown', onKey, true );
			window.addEventListener( 'blur', onBlur );
			document.addEventListener( 'visibilitychange', onVisibility );
		} );

		// Block the click that immediately follows a drag — without
		// this, releasing the pointer on the dragged tile (or any
		// tile, after a reorder) triggers the open-or-focus handler.
		tile.addEventListener(
			'click',
			( ev: MouseEvent ) => {
				if ( justDragged ) {
					ev.preventDefault();
					ev.stopImmediatePropagation();
				}
			},
			true,
		);
	}

	/**
	 * Resolve a registered icon value into a DOM element.
	 *
	 * Priority: dashicons class → inline SVG data URI → image URL →
	 * letter badge derived from the item's title. The letter fallback is
	 * important for plugin tiles: plugin authors routinely register
	 * top-level menus with `add_menu_page()` and omit the icon argument
	 * (defaulting to `'div'` or empty), which would otherwise render as
	 * an indistinguishable wall of generic wrenches. A colored letter
	 * tile gives each plugin a stable, unique-ish visual identity with
	 * zero plugin-side effort — the hue derives deterministically from
	 * the title so the same plugin always gets the same color.
	 *
	 * @param icon  The icon value from the menu entry.
	 * @param title Human-readable title, used when falling back to a
	 *              letter badge.
	 */
	private resolveIcon(
		icon: string,
		title: string,
		url?: string,
		slot?: string,
	): HTMLElement {
		// 0. Desktop-theme substitution, ahead of the whole branch
		//    chain below.
		//
		//    `isThemed` matters for step 4: the native-menu harvest is
		//    a fallback for "the server couldn't produce a usable
		//    icon", and it fires whenever the icon is the generic gear.
		//    If a theme deliberately maps a slot to
		//    `dashicons-admin-generic`, that is a CHOICE, not a
		//    failure — harvesting the plugin's own icon out of the
		//    hidden #adminmenu would silently override the theme.
		let isThemed = false;
		let tint: string | null = null;
		if ( slot ) {
			const themed = resolveThemedIcon( slot );
			if ( themed !== null ) {
				icon = themed;
				isThemed = true;
			}
			tint = resolveThemedIconColor( slot );
		}

		// 0b. Tinted image — painted as a mask filled with the theme's
		//     colour, so only the artwork's alpha is used. This is what
		//     makes a monochrome iconset legible on the dock: as an
		//     `<img>` a black-stroked glyph is invisible against a dark
		//     dock, and as a mask it takes whatever fill the theme
		//     named (or `currentColor`, which follows the tile).
		//
		//     Ahead of every image branch below because it supersedes
		//     all of them; dashicons fall through to branch 1, where a
		//     tint is just `color`.
		//     Deliberately NOT `os-dock__item-svg`: that class
		//     carries `filter: brightness(0) invert(1)`, which exists to
		//     force plugin SVGs with hardcoded `fill` attributes to
		//     white. It would flatten the theme's chosen tint to white
		//     too. The mask class below is the same size and opacity
		//     behaviour without the filter.
		if ( tint !== null && ! icon.startsWith( 'dashicons-' ) ) {
			const masked = this._makeMaskSpan();
			if ( applyIconMask( masked, icon, tint ) ) {
				return masked;
			}
		}

		// 1. Specific dashicon — trust what the server gave us, UNLESS
		//    it's the generic gear fallback. When the server hands us
		//    dashicons-admin-generic it usually means the plugin uses
		//    'none'/'div' for its icon and styles it from CSS — in that
		//    case we try harder via the native-menu extractor below.
		if (
			icon.startsWith( 'dashicons-' ) &&
			( isThemed || icon !== 'dashicons-admin-generic' )
		) {
			const el = document.createElement( 'span' );
			el.className = `dashicons ${ icon }`;
			el.setAttribute( 'aria-hidden', 'true' );
			if ( tint !== null ) {
				el.style.color = tint;
			}
			return el;
		}

		// 2. Inline SVG data URI — render as a CSS background-image.
		//    PHP already validated the base64 payload shape; we re-verify
		//    here because icons registered from JS never cross the sanitizer.
		if ( icon.startsWith( 'data:image/svg+xml;base64,' ) ) {
			const base64Part = icon.slice( 'data:image/svg+xml;base64,'.length );
			if ( /^[A-Za-z0-9+/=]+$/.test( base64Part ) ) {
				return this._makeSvgIcon( icon );
			}
			// Malformed — skip this case and try native-menu extraction.
		}

		// 3a. Raw CSS `url(...)` value — only the live-activation icon
		//     harvest in includes/render/chromeless-bridge.php produces
		//     this shape. It hands us the iframe's computed
		//     `::before { background-image }` verbatim so we can paint it
		//     identically to how F5 would (via _extractNativeMenuIcon's
		//     shape-c branch), without losing fidelity through a data-URI
		//     re-encode. Server-built icons never take this branch.
		if ( icon.startsWith( 'url(' ) ) {
			return this._makeSvgIcon( icon );
		}

		// 3. http(s) URL — direct image.
		if ( icon.startsWith( 'http://' ) || icon.startsWith( 'https://' ) ) {
			const img = document.createElement( 'img' );
			img.className = 'os-dock__item-img';
			img.src = icon;
			img.alt = '';
			img.setAttribute( 'aria-hidden', 'true' );
			return img;
		}

		// 4. NATIVE-MENU FALLBACK — the server couldn't produce a usable
		//    icon, but WP's hidden #adminmenu in the parent page IS
		//    rendering this plugin's icon perfectly. Copy from there.
		if ( url && ! isThemed ) {
			const native = this._extractNativeMenuIcon( url );
			if ( native ) {
				return native;
			}
		}

		// 5. If the server said "dashicons-admin-generic" explicitly and
		//    native extraction failed, honour the gear — matches the
		//    historical behaviour so core menu items without icons still
		//    render as gears rather than letter badges.
		if ( icon === 'dashicons-admin-generic' ) {
			const el = document.createElement( 'span' );
			el.className = 'dashicons dashicons-admin-generic';
			el.setAttribute( 'aria-hidden', 'true' );
			return el;
		}

		// 6. Nothing matched — first-letter tile on a deterministic hue.
		return this.createLetterBadge( title );
	}

	/**
	 * A span shaped like a dock glyph, ready to be painted as a mask.
	 *
	 * Geometry inline as well as in the stylesheet. A masked span has
	 * no intrinsic size — unlike the `<img>` it replaces — so if its
	 * CSS rule is missing for ANY reason (a stale cached stylesheet, a
	 * host that strips our CSS, a plugin resetting spans) the icon
	 * collapses to nothing and simply disappears. The element that
	 * needs the size should carry it.
	 */
	private _makeMaskSpan(): HTMLElement {
		const el = document.createElement( 'span' );
		el.className = 'os-dock__item-mask';
		el.setAttribute( 'aria-hidden', 'true' );
		el.style.width = 'var( --os-dock-icon-size, 20px )';
		el.style.height = 'var( --os-dock-icon-size, 20px )';
		el.style.display = 'block';
		el.style.flexShrink = '0';
		return el;
	}

	/**
	 * Build an SVG icon tile. Shared between the data-URI branch of
	 * {@link resolveIcon} and the native-menu extractor.
	 *
	 * **Monochrome by mask, not by filter.** The dock has always
	 * flattened plugin artwork to one colour — `filter: brightness(0)
	 * invert(1)` on the fallback span below, so an SVG shipping a
	 * hardcoded `fill` still matches its dashicon neighbours.
	 * Flattening is the right call and stays. WHAT it flattens to is
	 * the part nothing could reach: a filter has no colour to name, so
	 * these icons stayed white on a dock a theme had repainted pale.
	 *
	 * A mask filled with `currentColor` flattens identically — both
	 * paths keep only the source's alpha — and lands on the tile's own
	 * glyph colour, so plugin art now follows
	 * `--os-dock-icon-color` like every other glyph. Unthemed
	 * that colour is `rgba( 255, 255, 255, 0.7 )` at rest and `#fff` on
	 * hover: the same two values the filter and its opacity pair
	 * produced before, which is why nothing moves by default.
	 *
	 * `src/icon.ts` reaches the same place from the other direction —
	 * it masks silhouette art and leaves fixed-colour art alone. The
	 * dock masks both, because the dock had already decided every
	 * plugin icon is monochrome.
	 *
	 * The background-image span stays as the fallback for anything the
	 * mask can't take — a URL carrying quotes, spaces or parens — so no
	 * icon can disappear on account of this.
	 */
	private _makeSvgIcon( bgValue: string ): HTMLElement {
		// The native-menu harvest hands us a computed
		// `background-image` verbatim, so unwrap before validating:
		// `isMaskableIcon()` rejects the quotes and parens of the
		// `url( … )` wrapper, not the URL inside it.
		const unwrapped = /^url\(\s*(['"]?)(.+?)\1\s*\)$/.exec( bgValue );
		const bare = unwrapped ? unwrapped[ 2 ] : bgValue;
		const masked = this._makeMaskSpan();
		if ( applyIconMask( masked, bare, 'currentColor' ) ) {
			return masked;
		}

		const el = document.createElement( 'span' );
		el.className = 'os-dock__item-svg';
		el.style.backgroundImage = bgValue.startsWith( 'url(' )
			? bgValue
			: `url("${ bgValue }")`;
		el.style.backgroundSize = 'contain';
		el.style.backgroundRepeat = 'no-repeat';
		el.style.backgroundPosition = 'center';
		el.setAttribute( 'aria-hidden', 'true' );
		return el;
	}

	/**
	 * Extract a plugin's icon from the hidden `#adminmenu` that still
	 * exists in the parent shell DOM (display:none'd by desktop.css).
	 * Handles the three shapes plugins commonly use when the menu-page
	 * icon_url is 'none' or 'div':
	 *
	 *   (a) `<img src="...">` nested inside `.wp-menu-image`
	 *   (b) a dashicon class on `.wp-menu-image` itself
	 *   (c) a CSS background-image on `.wp-menu-image::before` (the
	 *       `menu-icon-XYZ` pattern Yoast, WooCommerce, Jetpack, etc. use)
	 *
	 * Returns null when the URL doesn't match any admin-menu entry or
	 * none of the three shapes are detectable.
	 */
	private _extractNativeMenuIcon( url: string ): HTMLElement | null {
		const adminMenu = document.getElementById( 'adminmenu' );
		if ( ! adminMenu ) {
			return null;
		}

		// Match the admin-menu link by the "filename?query" suffix of
		// its href. Works for both core slugs (edit.php, upload.php,
		// options-general.php) and plugin slugs (admin.php?page=wpseo).
		let target: string;
		try {
			const u = new URL( url, window.location.href );
			const filename = u.pathname.split( '/' ).pop() || '';
			target = filename + u.search;
		} catch {
			return null;
		}
		if ( ! target ) {
			return null;
		}

		const links = adminMenu.querySelectorAll< HTMLAnchorElement >( 'li.menu-top > a' );
		let matchLi: HTMLElement | null = null;
		for ( const link of Array.from( links ) ) {
			if ( link.href.endsWith( target ) ) {
				matchLi = link.closest( 'li.menu-top' );
				break;
			}
		}
		if ( ! matchLi ) {
			return null;
		}

		const imgWrap = matchLi.querySelector< HTMLElement >( '.wp-menu-image' );
		if ( ! imgWrap ) {
			return null;
		}

		// Shape (a): nested <img>
		const img = imgWrap.querySelector( 'img' );
		if ( img && img.src ) {
			const el = document.createElement( 'img' );
			el.className = 'os-dock__item-img';
			el.src = img.src;
			el.alt = '';
			el.setAttribute( 'aria-hidden', 'true' );
			return el;
		}

		// Shape (b): dashicon class on the wrap div itself.
		const dashMatch = imgWrap.className.match( /\bdashicons-[\w-]+\b/ );
		if ( dashMatch && dashMatch[ 0 ] !== 'dashicons-before' ) {
			const el = document.createElement( 'span' );
			el.className = `dashicons ${ dashMatch[ 0 ] }`;
			el.setAttribute( 'aria-hidden', 'true' );
			return el;
		}

		// Shape (c): CSS background-image on ::before pseudo.
		const before = window.getComputedStyle( imgWrap, '::before' );
		const bg = before.backgroundImage;
		if ( bg && bg !== 'none' && ! bg.includes( 'url("")' ) ) {
			return this._makeSvgIcon( bg );
		}

		// Fallback within the native-menu branch: background-image on
		// the wrap div itself (less common but some plugins do it).
		const bgWrap = window.getComputedStyle( imgWrap ).backgroundImage;
		if ( bgWrap && bgWrap !== 'none' && ! bgWrap.includes( 'url("")' ) ) {
			return this._makeSvgIcon( bgWrap );
		}

		return null;
	}

	/**
	 * Create a letter-badge icon — a rounded square tinted with a
	 * deterministic hue derived from the title, displaying the first
	 * letter of the title. Mirrors the "app icon placeholder" look
	 * macOS uses when an app ships without artwork.
	 *
	 * The title always drives both the letter and the hue — same plugin,
	 * same color across reloads. An empty title falls through to a `?`
	 * on a neutral gray tile, but the menu builder upstream guards
	 * against empty titles, so this is a defensive branch.
	 */
	private createLetterBadge( title: string ): HTMLElement {
		const el = document.createElement( 'span' );
		el.className = 'os-dock__item-letter';
		el.setAttribute( 'aria-hidden', 'true' );

		const trimmed = title.trim();
		// Use the first "letter" — handle accented chars, emoji, etc.
		// by grabbing the first code point rather than the first char.
		// Array.from iterates by code point, so [0] is always valid
		// for non-empty strings.
		const firstCodePoint = trimmed ? Array.from( trimmed )[ 0 ] : '?';
		el.textContent = firstCodePoint.toUpperCase();

		const hue = hashTitleToHue( trimmed );
		// Two-tone gradient for a tiny bit of depth — same hue, two
		// lightnesses. Keeps the palette harmonious while varying hue
		// across plugins.
		el.style.background = `linear-gradient(135deg, hsl(${ hue } 62% 55%), hsl(${ ( hue + 24 ) % 360 } 58% 42%))`;

		return el;
	}

	/**
	 * Bind tooltip show/hide on hover. Tooltip anchor differs per
	 * orientation: left dock → tile's right side, right dock → tile's
	 * left side, bottom dock → above the tile. We set the relevant
	 * coordinate inline each enter; the CSS takes care of the rest.
	 */
	/**
	 * Resolves the tooltip text through {@link HOOKS.DOCK_TILE_TOOLTIP}
	 * once at bind time (so the dock doesn't re-filter on every
	 * pointerenter) and stashes the resolved text on
	 * `tile.dataset.dockTooltip` so the multi-instance chip can
	 * restore it on its own pointerleave without going through the
	 * filter again.
	 *
	 * Returning an empty string from the filter suppresses the
	 * tooltip — the listener short-circuits and never adds the
	 * `--visible` class.
	 */
	private bindTooltipFiltered(
		tile: HTMLElement,
		text: string,
		ctx: DockTileContext,
	): void {
		const filtered = applyFilters< string >(
			HOOKS.DOCK_TILE_TOOLTIP,
			text,
			ctx,
		);
		tile.dataset.dockTooltip = filtered;
		if ( filtered === '' ) {
			return;
		}
		tile.addEventListener( 'pointerenter', () => {
			this.positionTooltip( tile, filtered );
			this.tooltip.classList.add( 'os-dock__tooltip--visible' );
		} );
		tile.addEventListener( 'pointerleave', () => {
			this.tooltip.classList.remove( 'os-dock__tooltip--visible' );
		} );
	}

	/**
	 * Write the tooltip text + anchor coordinate for `el`. Split out
	 * because the multi-instance chip's pointerenter handler also
	 * needs to anchor to a specific element (the chip, not the tile).
	 */
	private positionTooltip( el: HTMLElement, text: string ): void {
		const rect = el.getBoundingClientRect();
		this.tooltip.textContent = text;
		if ( this.orientation === 'bottom' ) {
			// Horizontal centering; CSS `--above` modifier handles the
			// vertical translate.
			this.tooltip.style.left = `${ rect.left + rect.width / 2 }px`;
			this.tooltip.style.top = `${ rect.top - 14 }px`;
		} else if ( this.orientation === 'right' ) {
			// Tooltip sits to the LEFT of the tile — anchor on the
			// tile's left edge; CSS `--before` modifier translates it
			// further left + centers vertically.
			this.tooltip.style.top = `${ rect.top + rect.height / 2 - 14 }px`;
			this.tooltip.style.left = `${ rect.left }px`;
		} else {
			// Left orientation (default). Tooltip sits to the RIGHT
			// of the tile — anchor on the tile's right edge with an
			// 8px gap so it clears the rail's outer border. Vertical
			// centering computed inline; CSS `--after` modifier
			// handles only the slide-in animation. (Body-attached
			// tooltips can't rely on `.os-dock[…] .tooltip`
			// descendant selectors; the position lives in JS.)
			this.tooltip.style.top = `${ rect.top + rect.height / 2 - 14 }px`;
			this.tooltip.style.left = `${ rect.right + 8 }px`;
		}
	}

	/**
	 * Open an admin page in a window (or focus if already open).
	 *
	 * Consults the native URL-remap registry first — when an opt-in
	 * native window has registered itself as the replacement for this
	 * admin URL (e.g. the native Posts window for `edit.php` when the
	 * user has flipped `nativePostsEnabled`), the click is rerouted
	 * to that window and the iframe path is skipped. The dock item
	 * itself is untouched: same icon, same tooltip, same position —
	 * only the destination changes.
	 */
	/**
	 * Hover-intent window prewarming (opt-in via the "Prewarm windows
	 * on hover" Beta toggle). A sustained mouse hover on a dock tile is
	 * a strong predictor of the next click, and the document TTFB of an
	 * admin page is the dominant cost of a window open — so start the
	 * hidden speculative window while the user is still deciding, and
	 * let `windowManager.open()` adopt it on the actual click.
	 *
	 * Deliberately narrow: mouse pointers only (touch has no hover),
	 * iframe pages only (native windows render instantly anyway),
	 * same-origin only (cross-origin URLs can't be iframed), and never
	 * for URLs a native-window remap would capture. The dwell delay
	 * matches the dock-peek's hover-intent timing so the two
	 * affordances read as one gesture.
	 */
	private bindHoverPrewarm( tile: HTMLElement, item: DockItem ): void {
		// No URL means there is no iframe document to warm: either a
		// native-window tile (`windowId` with no `url`, which
		// `openPage` routes to the registry) or a tile with nothing to
		// open at all. Both are handled by the same check — a native
		// tile is exactly the `! item.url` case.
		if ( ! item.url ) {
			return;
		}
		const DWELL_MS = 180;
		let dwellTimer: number | undefined;
		const cancel = () => {
			if ( dwellTimer !== undefined ) {
				window.clearTimeout( dwellTimer );
				dwellTimer = undefined;
			}
		};
		tile.addEventListener( 'pointerenter', ( e: PointerEvent ) => {
			if ( e.pointerType !== 'mouse' ) {
				return;
			}
			const os = (
				window as unknown as {
					wp?: {
						os?: {
							getOsSettings?: () => {
								windowPrewarmEnabled?: boolean;
							};
						};
					};
				}
			).wp?.os;
			if ( ! os?.getOsSettings?.().windowPrewarmEnabled ) {
				return;
			}
			// Cross-origin URLs open in a browser tab, and remapped
			// URLs open as native windows — neither wants an iframe
			// warmed for it.
			try {
				const parsed = new URL( item.url, window.location.href );
				if ( parsed.origin !== window.location.origin ) {
					return;
				}
				// Prewarming LOADS the page, so a dock item whose URL
				// acts would have acted — on hover, with no click. A
				// plugin is free to put `admin.php?action=…&_wpnonce=…`
				// behind a menu entry, and `post-new.php` mints an
				// auto-draft merely by rendering. The service worker's
				// speculative documents have always refused these;
				// hover prewarming builds a real hidden window and did
				// not, so the two paths now share one predicate.
				if ( urlActs( parsed ) ) {
					return;
				}
				// The shell screen boots a desktop, not a window's page.
				if ( isShellDocumentUrl( parsed ) ) {
					return;
				}
			} catch {
				return;
			}
			if ( resolveNativeUrlRemap( item.url ) ) {
				return;
			}
			cancel();
			dwellTimer = window.setTimeout( () => {
				dwellTimer = undefined;
				const baseId = this.deriveWindowId( item.url );
				// Same config `openPage` will pass, so the adoption
				// check in `open()` sees an exact match.
				void this.windowManager.prewarm( {
					id: baseId,
					baseId,
					url: item.url,
					parentUrl: item.url,
					title: item.title,
					icon: item.icon.startsWith( 'dashicons-' )
						? item.icon
						: 'dashicons-admin-generic',
					submenu: item.submenu,
					selfLabel: item.selfLabel,
					multi: !! item.multi,
				} );
			}, DWELL_MS );
		} );
		tile.addEventListener( 'pointerleave', cancel );
		// The click path takes over from here — cancel a pending dwell
		// so a fast click never races its own prewarm.
		tile.addEventListener( 'pointerdown', cancel );
	}

	private openPage( item: DockItem ): void {
		// A tile whose target is a native window rather than an admin
		// URL — an app launcher the user put on the rail, or a window
		// with no launcher at all that is on the rail because it is
		// open. Deriving an id from its empty `url` would find nothing
		// and the click would silently no-op.
		//
		// Focus first, open second. The registry can only open windows
		// it registered, and a window that arrived some other way (the
		// Preferences panel, a plugin's `windowManager.open()`) is
		// exactly the kind whose tile exists only because it is
		// already open.
		if ( item.windowId && ! item.url ) {
			const existing = this.windowManager.getById( item.windowId );
			if ( existing ) {
				this.windowManager.focus( existing );
				return;
			}
			const wp = ( window as unknown as {
				wp?: { os?: { openWindow?: ( id: string ) => unknown } };
			} ).wp?.os;
			wp?.openWindow?.( item.windowId );
			return;
		}

		// Off-site admin menu entries (e.g. WordPress.com's "Hosting"
		// link, which points at `wordpress.com/hosting/<site>` from a
		// wpcomstaging.com wp-admin) can't be iframed — the chromeless
		// guard returns null for cross-origin URLs and the iframe lands
		// on `about:blank`. Send those to a new browser tab instead,
		// mirroring what classic admin does for the same item.
		if ( tryOpenExternalUrl( item.url ) ) {
			return;
		}

		if ( tryNativeUrlRemap( item.url ) ) {
			return;
		}

		const baseId = this.deriveWindowId( item.url );

		this.windowManager.open( {
			id: baseId,
			baseId,
			url: item.url,
			parentUrl: item.url,
			title: item.title,
			icon: item.icon.startsWith( 'dashicons-' ) ? item.icon : 'dashicons-admin-generic',
			submenu: item.submenu,
			selfLabel: item.selfLabel,
			multi: !! item.multi,
		} );
	}

	/**
	 * Open a brand-new instance of a page, even if one is already
	 * open. Invoked by the "+" ghost card in the dock peek.
	 *
	 * The user explicitly asked for "another window of this thing,"
	 * so we honour the request even when {@link tryNativeUrlRemap}
	 * would otherwise route the click into a native-window
	 * singleton. Result: clicking + while a native Posts window is
	 * open opens a fresh iframe of `edit.php` alongside it. Two
	 * windows of Posts is the explicit ask — that's what + is for.
	 */
	private openNewInstance( item: DockItem ): void {
		// "+" on an off-site tile means the same thing the primary
		// click does — open a fresh browser tab. Iframing a cross-
		// origin URL would land on `about:blank` (see openPage).
		if ( tryOpenExternalUrl( item.url ) ) {
			return;
		}

		// Resolved through the public-API global typed in `global.d.ts`
		// (OpenStationPublicApi), so a future signature change to
		// `openNewWindow` shows up at THIS call site instead of being
		// hidden behind an inline `as unknown as { wp?: … }` cast that
		// pinned a stale local shape.
		const openNewWindow = window.wp?.os?.openNewWindow;

		// Dock-promoted desktop icons whose target is a native window
		// (My WordPress, Jorvy, plugin-registered launchers) carry the
		// registry id on `item.windowId` and ship with an empty `url`.
		// Route those directly through the native opener so the +
		// spawns a fresh native instance — without this branch the
		// `deriveWindowId('')` fallthrough below opens a chrome-only
		// iframe whose `src=''` never loads (user-visible symptom: the
		// duplicate window appears with just the title bar).
		if ( item.windowId && ! item.url ) {
			if ( openNewWindow?.( item.windowId, { source: 'dock-peek' } ) ) {
				return;
			}
		}

		// If the item's URL is claimed by a native-window remap (Posts,
		// Pages, Users, Comments, Plugins, …), spawn a fresh native
		// instance via the registry — same path as the regular dock
		// click, but routed through `openNewById` instead of
		// `openById` so the next-instance-id logic kicks in.
		// Without this branch native windows would fall through to the
		// iframe `openNew()` below and lose their custom render
		// callback + template, opening a generic chromeless iframe of
		// the URL instead of a duplicate of the native window.
		const remappedId = resolveNativeUrlRemap( item.url );
		if ( remappedId ) {
			if ( openNewWindow?.( remappedId, { source: 'dock-peek' } ) ) {
				return;
			}
		}

		const baseId = this.deriveWindowId( item.url );
		void this.windowManager.openNew( {
			id: baseId,
			baseId,
			url: item.url,
			parentUrl: item.url,
			title: item.title,
			icon: item.icon.startsWith( 'dashicons-' ) ? item.icon : 'dashicons-admin-generic',
			submenu: item.submenu,
			selfLabel: item.selfLabel,
			multi: true,
		} );
	}

	/**
	 * Derive a window ID from an admin page URL.
	 */
	private deriveWindowId( url: string ): string {
		return deriveWindowId( url, this.adminUrl );
	}

	/**
	 * Resolve the window-manager key for a dock tile, in this order:
	 *
	 * 1. `item.windowId` — carried by the navigation for any tile
	 *    whose target is a native window. Native-window ids never
	 *    pass through the URL → native-window remap layer, so we
	 *    short-circuit before touching it.
	 * 2. {@link resolveNativeUrlRemap} on `item.url` — captures the
	 *    `nativePostsEnabled` / `nativePagesEnabled` opt-ins that
	 *    repoint a URL-based tile at a native window.
	 * 3. {@link deriveWindowId} on `item.url` — the URL-based
	 *    fallback for ordinary admin-menu tiles.
	 *
	 * Shared by the hover-peek card and the active/focused-dot
	 * indicator; the two stayed in lockstep before this method existed
	 * by hand-rolling the same chain at each call site.
	 */
	private resolveItemBaseId( item: DockItem ): string {
		if ( item.windowId ) {
			return item.windowId;
		}
		const remapped = resolveNativeUrlRemap( item.url );
		return remapped ?? this.deriveWindowId( item.url );
	}

	/**
	 * Listen to window events to update active/focused/minimized
	 * indicators on dock items, plus the global Show Desktop body class.
	 *
	 * The event detail isn't used — we just need to re-query the
	 * window manager on every change — so the handlers take no
	 * argument and the type cast is gone with it.
	 *
	 * `WINDOW_MINIMIZED` / `WINDOW_RESTORED` route through the hook bus
	 * (no DOM CustomEvent equivalent today). Without these, minimizing
	 * a window via Show Desktop / the title-bar minimize button left
	 * the dock's active-dot rendering stuck on "visible window" — the
	 * user had no cue that everything had collapsed to minimized.
	 */
	private bindWindowEvents(): void {
		const refresh = (): void => this.updateActiveStates();
		this.boundRefresh = refresh;
		document.addEventListener( 'os-window-opened', refresh );
		document.addEventListener( 'os-window-closed', refresh );
		document.addEventListener( 'os-window-focused', refresh );
		// Desktop switches change which windows count as "open on
		// the active desktop" even though the stack is unchanged.
		// Listen via the hook bus so a plugin that manually calls
		// switchDesktop() also triggers a repaint.
		window.wp?.hooks?.addAction?.(
			'os.os.switched',
			this.hooksNamespace,
			refresh,
		);
		window.wp?.hooks?.addAction?.(
			'os.os.closed',
			this.hooksNamespace,
			refresh,
		);
		window.wp?.hooks?.addAction?.(
			HOOKS.WINDOW_MINIMIZED,
			this.hooksNamespace,
			refresh,
		);
		window.wp?.hooks?.addAction?.(
			HOOKS.WINDOW_RESTORED,
			this.hooksNamespace,
			refresh,
		);
		// The escape hatch for tiles whose active dot answers a
		// question about something other than windows — see the hook's
		// own docblock.
		window.wp?.hooks?.addAction?.(
			HOOKS.DOCK_REFRESH_ACTIVE,
			this.hooksNamespace,
			refresh,
		);
	}

	/**
	 * Tear the dock down: detach window-lifecycle listeners, clear
	 * pending attention timers, remove the floating tooltip from
	 * `document.body`, and empty the container's children. Used by
	 * the layout dispatcher when the user switches `desktopLayout`
	 * in OS Settings — old dock(s) get destroyed and a fresh set is
	 * constructed for the new layout.
	 *
	 * Idempotent: calling twice is safe.
	 */
	public destroy(): void {
		document.removeEventListener(
			'os-window-opened',
			this.boundRefresh,
		);
		document.removeEventListener(
			'os-window-closed',
			this.boundRefresh,
		);
		document.removeEventListener(
			'os-window-focused',
			this.boundRefresh,
		);
		window.wp?.hooks?.removeAction?.(
			'os.os.switched',
			this.hooksNamespace,
		);
		window.wp?.hooks?.removeAction?.(
			'os.os.closed',
			this.hooksNamespace,
		);
		window.wp?.hooks?.removeAction?.(
			HOOKS.WINDOW_MINIMIZED,
			this.hooksNamespace,
		);
		window.wp?.hooks?.removeAction?.(
			HOOKS.DOCK_REFRESH_ACTIVE,
			this.hooksNamespace,
		);
		window.wp?.hooks?.removeAction?.(
			HOOKS.WINDOW_RESTORED,
			this.hooksNamespace,
		);
		for ( const handle of this.attentionTimers.values() ) {
			window.clearTimeout( handle );
		}
		this.attentionTimers.clear();
		for ( const teardown of this.peekTeardowns.values() ) {
			teardown();
		}
		this.peekTeardowns.clear();
		this.tooltip.remove();
		while ( this.container.firstChild ) {
			this.container.removeChild( this.container.firstChild );
		}
		this.itemElements.clear();
		this.systemItemElements.clear();
		this.systemItems = [];
		this.zones = { core: [], apps: [], controls: [] };
		this.container.removeAttribute( 'data-os-dock-placement' );
	}

	/**
	 * Update the active/focused/minimized classes on every dock item in
	 * response to a window lifecycle event, and toggle the global Show
	 * Desktop body class.
	 *
	 * For singletons the rail is absent; "active" means "the one window
	 * is open". For multi-capable items, active means "≥1 instance is
	 * open" and focused means "the focused window belongs to this item".
	 *
	 * `--all-minimized` is layered on top of `--active` and fires only
	 * when EVERY open instance of the tile is minimized — so a partial
	 * minimize (one of two windows hidden) keeps the solid dot. CSS
	 * swaps the dot for a hollow ring on minimized-only tiles so the
	 * user can tell at a glance "I have something here, it's just
	 * hidden right now."
	 */
	private updateActiveStates(): void {
		const focused = this.windowManager.getFocused();
		// The dock reflects the ACTIVE desktop only. Windows on
		// other desktops are invisible to the user right now —
		// showing "active" dots for them conflates "something's
		// open somewhere" with "something's open here," which is
		// what tripped up the first user on an empty desktop.
		const activeDesktopId = this.windowManager.getActiveDesktopId();
		const onActiveDesktop = ( w: { config: { desktopId?: string } } ): boolean =>
			( w.config.desktopId || activeDesktopId ) === activeDesktopId;
		const isMinimized = ( w: { state?: string } ): boolean =>
			w.state === 'minimized';

		for ( const item of this.items ) {
			const tile = this.itemElements.get( item.id );
			if ( ! tile ) {
				continue;
			}

			const baseId = this.resolveItemBaseId( item );
			let instances = this.windowManager
				.getAllByBaseId( baseId )
				.filter( onActiveDesktop );
			if ( instances.length === 0 && item.url ) {
				const derivedId = this.deriveWindowId( item.url );
				instances = this.windowManager
					.getAll()
					.filter( ( w ) => {
						const wBase = w.config.baseId || w.id;
						if ( wBase === baseId || wBase === derivedId || wBase === item.id ) {
							return true;
						}
						// A window opened from this menu's submenu — the
						// post editor behind "Posts → Add New", or the
						// same page reached from the Create tile. It is
						// keyed on the CHILD page, so no id here will
						// ever match it; `parentUrl` is the only thing
						// that says which menu it came from, and without
						// consulting it the parent tile stays dark while
						// one of its pages is plainly open.
						if (
							w.config.parentUrl &&
							this.deriveWindowId( w.config.parentUrl ) === derivedId
						) {
							return true;
						}
						if ( w.config.url ) {
							const wDerived = this.deriveWindowId( w.config.url );
							return wDerived === baseId || wDerived === derivedId;
						}
						return false;
					} )
					.filter( onActiveDesktop );
			}
			const isOpen = instances.length > 0;
			const allMinimized = isOpen && instances.every( isMinimized );
			const isFocused =
				!! focused &&
				onActiveDesktop( focused ) &&
				! isMinimized( focused ) &&
				instances.some( ( w ) => w.id === focused.id || ( focused.config.baseId || focused.id ) === baseId );

			tile.classList.toggle( 'os-dock__item--active', isOpen );
			tile.classList.toggle( 'os-dock__item--focused', isFocused );
			tile.classList.toggle(
				'os-dock__item--all-minimized',
				allMinimized,
			);
			tile.classList.toggle(
				'os-dock__item--stacked',
				isOpen && instances.length > 1,
			);
		}

		// System items — active dot driven by the caller's predicate. No
		// focus indicator: the OS Settings window can be focused like any
		// other, and the regular tile styling picks that up naturally.
		for ( const sys of this.systemItems ) {
			const tile = this.systemItemElements.get( sys.id );
			if ( ! tile ) {
				continue;
			}
			const sysWin = this.windowManager.getById( sys.id );
			const isOpen = sys.isOpen ? sys.isOpen() : !! sysWin;
			const allMinimized = !! sysWin && isMinimized( sysWin );
			const isFocused =
				!! focused && focused.id === sys.id && ! isMinimized( focused );
			tile.classList.toggle( 'os-dock__item--active', isOpen );
			tile.classList.toggle( 'os-dock__item--focused', isFocused );
			tile.classList.toggle(
				'os-dock__item--all-minimized',
				allMinimized,
			);
		}

		// Global Show Desktop indicator — the canonical "every live
		// window on the active desktop is minimized" state. Toggled as
		// a body class so any surface (dock pill, wallpaper vignette,
		// future taskbar widget) can react via CSS. Idempotent across
		// dock instances: two docks setting the same class doesn't
		// double-fire.
		this.updateShowDesktopBodyClass();
	}

	/**
	 * Toggle `body.os-show-desktop-active` based on whether
	 * every live window on the active desktop is minimized. Mirrors
	 * the heuristic inside {@link WindowManager.toggleShowDesktop} so
	 * the visual cue tracks the actual state — set by Show Desktop
	 * gestures, restored when any window is brought back, automatically
	 * cleared when no windows exist.
	 *
	 * @internal
	 */
	private updateShowDesktopBodyClass(): void {
		const activeDesktopId = this.windowManager.getActiveDesktopId();
		const live = this.windowManager
			.getAll()
			.filter(
				( w ) =>
					( w.config.desktopId || activeDesktopId ) === activeDesktopId,
			);
		const showDesktop =
			live.length > 0 && live.every( ( w ) => w.state === 'minimized' );
		document.body.classList.toggle(
			'os-show-desktop-active',
			showDesktop,
		);
	}
}

/**
 * Idempotently paint or remove the numeric badge on a tile host.
 *
 * Shared between `Dock.setBadge()` and any external surface that
 * decorates the same tiles (e.g. the recycle-bin badge module had
 * its own copy of this logic). Mutates the badge node in place so
 * an existing animation isn't restarted by a no-op repaint.
 *
 * @internal
 */
function _applyBadgeNode( host: HTMLElement, count: number ): void {
	const existing = host.querySelector< HTMLElement >(
		':scope > .os-dock__badge',
	);
	if ( count <= 0 ) {
		existing?.remove();
		return;
	}
	const display = count > 99 ? '99+' : String( count );
	if ( existing ) {
		if ( existing.textContent !== display ) {
			existing.textContent = display;
		}
		existing.setAttribute(
			'aria-label',
			sprintf(
				// translators: %d is the number of pending items in a dock badge.
				_n( '%d notification', '%d notifications', count ),
				count,
			),
		);
		return;
	}
	const badge = document.createElement( 'span' );
	badge.className = 'os-dock__badge';
	badge.textContent = display;
	badge.setAttribute(
		'aria-label',
		sprintf(
			// translators: %d is the number of pending items in a dock badge.
			_n( '%d notification', '%d notifications', count ),
			count,
		),
	);
	host.appendChild( badge );
}
