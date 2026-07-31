/**
 * Desktop Mode — Dock rail renderer interfaces.
 *
 * Public contract for the radical customization registry: how plugin
 * authors REPLACE the entire dock rail. The default `'default'`
 * renderer wraps the shipped `Dock` class (icon strip with badges,
 * tooltips, multi-instance chips, attention animations, etc.); a
 * plugin can register a renderer that paints a circular ring, a
 * Stage-Manager-style stack, a floating cluster — anything that
 * fits the controller contract.
 *
 * Plugin authors `register()`, implement `mount()`, and return a
 * controller. The shell handles error isolation and live-sync
 * registration.
 */

import type {
	DockAttentionIntensity,
	DockAttentionMode,
	DockItem,
	DockOrientation,
	SubmenuItem,
	SystemDockItem,
} from '../dock';
import type { WindowManager } from '../window-manager';

/**
 * Dependencies the renderer's `mount()` receives. Two cohorts:
 *
 * **Required wiring** (all renderers consume):
 *   - `container` — the rail's host element. The renderer owns
 *     everything inside it; the shell does not paint into this
 *     element after `mount()` returns.
 *   - `items` — the menu-derived tile list at boot. Live updates
 *     come through the controller's `replaceItems()`.
 *   - `orientation` — `'left' | 'right' | 'bottom'`. Reflected on
 *     the container's `data-desktop-mode-dock-placement` attribute
 *     by the shell before `mount()` runs.
 *
 * **Routing callbacks** (renderers MUST call these instead of
 * reaching for the window manager directly):
 *   - `openItem( item )` — primary tile click. Routes through the
 *     same window-manager.open() the default renderer uses, so
 *     custom renderers stay compatible with multi-instance, submenu
 *     propagation, session restore, etc.
 *   - `openSystemItem( item )` — system-tile click (OS Settings,
 *     plugin-owned native windows). Mirrors `openItem` for the
 *     non-menu cohort.
 * **Read-only collaborators** for renderers that need them:
 *   - `windowManager` — full WindowManager. Use sparingly; prefer
 *     the routing callbacks. Provided for renderers that need raw
 *     access to active state, focus, virtual desktops.
 *   - `adminUrl` — admin URL prefix for window-id derivation.
 */
export interface DockRailMountDeps {
	container: HTMLElement;
	/**
	 * The rail-scoped slice of the menu — what THIS rail is meant to
	 * paint. Classic layout splits the menu (`isCore` to side rail,
	 * the rest to primary), so a custom renderer registered against
	 * the primary rail in Classic only sees the plugin half here.
	 *
	 * Use this when you want to honour the layout's intent. Use
	 * {@link fullMenu} when you want the entire admin menu
	 * regardless of rail.
	 */
	items: DockItem[];
	/**
	 * The COMPLETE admin-menu list, including items routed to other
	 * rails or to the wallpaper-icon grid (Spatial). A custom
	 * renderer that wants to paint a *unified view* of the entire
	 * admin — or that wants to ignore the layout's partitioning
	 * logic for its own UX — reads this. Updates with every live
	 * menu refresh.
	 */
	fullMenu: DockItem[];
	/**
	 * Snapshot of every JS-registered system tile across both rails
	 * at mount time — the OS Settings tile, plugin-owned native-
	 * window launchers, the recycle bin, etc. Mirrors `fullMenu`'s
	 * shape: a single read at mount time of the cohort that flows
	 * through `appendSystemItem` / `removeSystemItem` over the
	 * renderer's lifetime.
	 *
	 * Use this when your renderer wants to apply uniform treatment
	 * (partition, sort, filter, decorate) to *every* dockable
	 * thing in one pass — without maintaining parallel collections
	 * for menu items + system tiles. Live updates still flow
	 * through the controller's `appendSystemItem` /
	 * `removeSystemItem` hooks.
	 */
	fullSystemTiles: SystemDockItem[];
	orientation: DockOrientation;
	/**
	 * Primary tile click — routes through the same
	 * `windowManager.open()` the default renderer uses, so custom
	 * renderers stay compatible with multi-instance, submenu
	 * propagation into the in-window tab strip, session restore,
	 * per-window theming.
	 */
	openItem( item: DockItem ): void;
	/**
	 * Submenu pick — invoked when the user activates a child link
	 * of `item` (typically from a submenu popover the renderer
	 * surfaces). Mirrors `openItem` but opens the child URL while
	 * preserving the parent's identity for `baseId`, icon, and
	 * the in-window tab strip.
	 *
	 * Renderers that surface submenus (orbit, radial menu, hovering
	 * cards, anything that fans out children) call this instead of
	 * deriving window ids themselves — the framework's id derivation
	 * (`deriveWindowId`) is exposed via this callback so plugin and
	 * default renderers address the same window with the same id at
	 * runtime.
	 */
	openSubmenuPick( item: DockItem, sub: SubmenuItem ): void;
	openSystemItem( item: SystemDockItem ): void;
	windowManager: WindowManager;
	adminUrl: string;
}

/**
 * Controller returned by `mount()`. The shell drives every live
 * update through this — never reaches into the renderer's DOM
 * directly.
 *
 * Required methods: `replaceItems`, `appendSystemItem`,
 * `removeSystemItem`, `destroy`. Optional methods are silently
 * skipped when the active renderer doesn't implement them — a
 * renderer that doesn't support badges or attention animations
 * still works; those signals just don't paint.
 *
 * Idempotency contract: every method may be called repeatedly with
 * the same arguments; renderers must absorb that without leaking
 * DOM or duplicating event listeners.
 */
export interface DockRailController {
	/**
	 * Replace the menu-derived tile list. Live menu refresh path
	 * uses this every time `dockItems` arrives in a fresh server
	 * payload (plugin activation / deactivation). System tiles
	 * (OS Settings, plugin-owned native windows) survive — they're
	 * tracked separately.
	 */
	replaceItems( items: DockItem[] ): void;
	/** Append a JS-owned system tile after the menu items. */
	appendSystemItem( item: SystemDockItem ): void;
	/** Remove a system tile by id. Idempotent — unknown ids no-op. */
	removeSystemItem( id: string ): void;
	/**
	 * Set / clear a numeric badge on a tile. `count: 0` clears.
	 * Optional — renderers without a badge surface ignore.
	 */
	setBadge?( itemId: string, count: number ): void;
	/**
	 * Trigger or clear an attention animation on a tile. Modes:
	 * `'pulse' | 'shake' | 'bounce' | null`. `null` clears.
	 * Optional — renderers without attention support ignore.
	 */
	setAttention?(
		itemId: string,
		mode: DockAttentionMode,
		opts?: { durationMs?: number; intensity?: DockAttentionIntensity },
	): void;
	/**
	 * Re-orient the rail in place. Called by the layout dispatcher
	 * if the rail's placement changes mid-life — most layouts swap
	 * by `destroy() + mount()` instead, so this is purely an
	 * optimization renderers can skip.
	 */
	setOrientation?( orientation: DockOrientation ): void;
	/**
	 * Tear down. Remove every DOM node, listener, timer, and
	 * subscription the renderer added. Called by the layout
	 * dispatcher on layout switch and on shell unload.
	 */
	destroy(): void;
}

/**
 * The contract a plugin implements to replace the dock rail.
 * Identified by `id`; the active renderer is the user's
 * `dockRailRenderer` OS Settings pick (default `'default'`).
 *
 * @public
 */
export interface DockRailRenderer {
	/**
	 * Stable id, `[a-z0-9_-]+`. Must be unique across registrations.
	 * `'default'` is reserved for the built-in icon-strip renderer
	 * (`Dock` class). A plugin that registers `id: 'default'`
	 * replaces the shipped baseline — late registrations win.
	 */
	id: string;
	/** Human-readable label shown in the OS Settings picker. */
	label: string;
	/** Optional 1-line description for the picker preview. */
	description?: string;
	/** Optional dashicon class for the picker icon. */
	icon?: string;
	/**
	 * API contract version. Reserved for forward-compat: the shell
	 * rejects renderers whose version it doesn't speak yet. Today
	 * only `1` is valid; omit to match.
	 */
	apiVersion?: 1;
	/** Owner tag for live unregistration on plugin deactivation. */
	owner?: string;
	/**
	 * Build and mount the rail UI. Return a controller the shell
	 * uses to drive subsequent updates and tear-down. Throwing
	 * from `mount()` is caught by the shell, surfaced via
	 * {@link HOOKS.SHELL_ERROR}, and the dispatcher falls back to
	 * the `'default'` renderer for the failed rail.
	 */
	mount( deps: DockRailMountDeps ): DockRailController;
}
