/**
 * Desktop Mode — Submenu renderer interfaces.
 *
 * Public contract for the second customization registry: how plugin
 * authors replace the default popover that opens when the user
 * right-clicks a dock tile that has admin submenu items. The default
 * renderer ships a list popover; plugins can ship anything from a
 * radial menu to floating cards to a centered overlay.
 *
 * Mirrors the shape of {@link DockRailRenderer} so plugin authors see
 * the same DX across both registries — register a tagged object,
 * implement `mount()`, return a controller. The shell handles
 * lifecycle, error isolation, and live registration sync via the
 * standard server-sync module.
 *
 * @since 0.18.0
 */

import type { DockItem, DockOrientation } from '../dock';

/**
 * Picked submenu item data. Renderers call `onPick` with this when
 * the user activates an entry; the dock then opens the URL in a
 * window. Identical shape to `DockItem.submenu[number]` — kept as a
 * standalone interface so plugin authors don't have to reach into
 * `DockItem` to find it.
 */
export interface SubmenuItem {
	title: string;
	url: string;
}

/**
 * Dependencies the renderer's `mount()` receives.
 *
 * `anchor` is the dock tile's DOM element — renderers position their
 * UI relative to it (typically with `getBoundingClientRect`).
 * `orientation` tells the renderer which edge the parent dock hugs
 * so the default popover can flip its anchor side; a fully-custom
 * renderer can ignore it entirely.
 *
 * `onPick` and `onClose` are the two outbound signals. `onPick`
 * delegates window opening back to the dock — the renderer never
 * opens windows directly. `onClose` tells the dock the popover has
 * been dismissed (Escape, outside click, blur — whatever counts as
 * a dismiss in the renderer's UX).
 */
export interface SubmenuMountDeps {
	item: DockItem;
	anchor: HTMLElement;
	orientation: DockOrientation;
	onPick( submenu: SubmenuItem ): void;
	onClose(): void;
}

/**
 * Controller returned by `mount()`. The shell uses it to drive the
 * renderer's lifecycle:
 *
 * - `close()` — the user opened a different submenu, switched
 *   layouts, or the dock was destroyed; the renderer should run
 *   its dismiss animation if it has one.
 * - `destroy()` — unconditional teardown, no animation. Must remove
 *   every DOM node and listener the renderer added.
 *
 * Both must be idempotent: the shell may call `close()` followed by
 * `destroy()` (animated dismiss → final teardown), or skip directly
 * to `destroy()` (e.g., on shell unload).
 */
export interface SubmenuController {
	close(): void;
	destroy(): void;
}

/**
 * The contract a plugin implements to replace the default submenu
 * popover. Identified by `id`; the active renderer is the user's
 * `submenuRenderer` OS Settings pick (default `'default'`).
 *
 * @public
 * @since 0.18.0
 */
export interface SubmenuRenderer {
	/**
	 * Stable id, `[a-z0-9_-]+`. Must be unique across registrations.
	 * `'default'` is reserved for the built-in list popover.
	 */
	id: string;
	/** Human-readable label shown in the OS Settings picker. */
	label: string;
	/** Optional 1-line description for the picker preview. */
	description?: string;
	/** Optional dashicon class for the picker icon. */
	icon?: string;
	/**
	 * API contract version this renderer implements. Reserved for
	 * forward-compat: the shell rejects renderers whose version it
	 * doesn't speak yet so an out-of-date plugin can't stand on a
	 * load-bearing bug. Today only `1` is valid; omit to match.
	 *
	 * @since 0.18.0
	 */
	apiVersion?: 1;
	/**
	 * Owner tag for live unregistration on plugin deactivation. When
	 * set, the server-sync module removes this renderer if the named
	 * script handle leaves the payload — matches the contract used by
	 * commands and settings tabs.
	 */
	owner?: string;
	/**
	 * Build and mount the submenu UI for a dock tile. Return a
	 * controller the shell uses to close / destroy. Throwing from
	 * `mount()` is caught by the shell, the failure is logged via
	 * {@link HOOKS.SHELL_ERROR}, and the dispatcher falls back to
	 * the `'default'` renderer for the current invocation.
	 */
	mount( deps: SubmenuMountDeps ): SubmenuController;
}
