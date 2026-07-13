/**
 * Third-party OS Settings tab registry.
 *
 * Plugins register additional tabs in the OS Settings window via the
 * public `wp.desktop.registerSettingsTab()` API. Built-in tabs
 * (appearance, ai, apps-icons, features, effects, extended, help,
 * about) live directly in `panel.ts`; this registry extends the panel
 * with externally-contributed tabs without the core module needing to
 * know about them.
 *
 * Rendering is the tab's own responsibility — `render( body )` receives
 * the tabpanel body element and may do whatever it wants inside it
 * (plain DOM, `html`/`render` from `../ui/core`, a framework, etc.).
 *
 * @since 0.5.1
 */

import { createSharedStore } from '../shared-store';

/**
 * Snapshot of the persisted OS Settings state that third-party tabs
 * can read. Intentionally re-declared here (instead of exporting the
 * private `OsSettingsState` type) so the public surface stays minimal:
 * tab authors see exactly the fields they can depend on, and the
 * internal shape can widen without churning the ctx contract.
 *
 * `ai` is particularly load-bearing — it's the read path a third-party
 * AI widget uses to pick up the provider + API key the user configured
 * in the built-in AI Settings tab.
 *
 * @since 0.5.1
 */
export interface OsSettingsSnapshot {
	wallpaper: string;
	accent: string;
	dockSize: string;
	/**
	 * Top-level desktop layout. Drives the dock(s) layout:
	 *
	 * - `classic` — left side bar (core menus) + bottom dock (plugins).
	 * - `unified` — single bottom dock with every menu.
	 * - `spatial` — bottom dock with plugins; core menus rendered as
	 *   icons on the wallpaper.
	 *
	 * @since 0.6.0
	 */
	desktopLayout: 'classic' | 'unified' | 'spatial';
	/**
	 * Active dock rail-renderer id; mirrors the dock-rail registry's
	 * resolution. `'default'` is the shipped icon-strip renderer.
	 *
	 * @since 0.6.0
	 */
	dockRailRenderer: string;
	/**
	 * Active unfocused-window effect id; mirrors the unfocus-effect
	 * registry's resolution. `'darken'` is the shipped built-in,
	 * `'none'` disables the effect.
	 *
	 * @since 0.9.1
	 */
	unfocusEffect: string;
	/**
	 * Active window-link renderer id; `'none'` disables the visuals,
	 * unknown ids fall back to the built-in `'svg-splines'`.
	 *
	 * @since 0.9.4
	 */
	windowLinkRenderer: string;
	/**
	 * When window-link ties show: `'focus'` | `'always'` | `'off'`.
	 *
	 * @since 0.9.4
	 */
	windowLinkVisibility: 'focus' | 'always' | 'off';
	ai: {
		enabled: boolean;
		provider: string;
		apiKey: string;
		/**
		 * Live-progress transport for AI search: `'sse' | 'off'`. Default
		 * `'off'`. Surfaced so a third-party AI tab can read the user's
		 * preferred transport without rebuilding the picker.
		 *
		 * @since 0.6.0
		 */
		transport: 'sse' | 'off';
	};
	/**
	 * Per-user opt-in for the native Posts window. When true, clicking
	 * the Posts dock tile opens the `<wpd-table>`-driven native window
	 * instead of the chromeless `edit.php` iframe. Default off.
	 *
	 * @since 0.8.0
	 */
	nativePostsEnabled: boolean;
	/**
	 * Per-user list of column keys hidden in the native Posts window.
	 * Mirrors the underlying `OsSettingsState.nativePostsHiddenColumns`.
	 * Empty array means every column is visible.
	 *
	 * @since 0.8.0
	 */
	nativePostsHiddenColumns: string[];
	/**
	 * Per-user opt-in for the native Pages window. When true, the Pages
	 * dock tile / `edit.php?post_type=page` links open the native
	 * `<wpd-table>` window instead of the chromeless iframe. Default off.
	 *
	 * @since 0.6.0
	 */
	nativePagesEnabled: boolean;
	/**
	 * Per-user opt-in for the native Users window. Same posture as
	 * {@link nativePagesEnabled} — UI-side gate; the window itself is
	 * cap-gated on the server. Default off.
	 *
	 * @since 0.6.0
	 */
	nativeUsersEnabled: boolean;
	/**
	 * Per-user opt-in for the native Plugins window. Same posture as
	 * {@link nativeUsersEnabled} — UI-side gate; the window itself is
	 * cap-gated on the server (`activate_plugins`). Default off.
	 *
	 * @since 0.9.0
	 */
	nativePluginsEnabled: boolean;
	/**
	 * Per-user opt-in for the native Comments window. Same posture as
	 * {@link nativeUsersEnabled} — UI-side gate; the window itself is
	 * cap-gated on the server (`edit_posts`). Default off.
	 *
	 * @since 0.8.3
	 */
	nativeCommentsEnabled: boolean;
	/**
	 * Per-user kill switch for the folder-sharing feature.
	 * Defaults to `true`. When `false`, every share-related
	 * surface is suppressed for this user (UI hidden, REST routes
	 * return 404, heartbeat skips `shares.pending`). Independent
	 * of the destructive site-admin "Delete folder sharing data"
	 * action, which drops the tables outright.
	 *
	 * @since 0.8.5
	 */
	foldersSharingEnabled: boolean;
	/**
	 * When true, unlocks developer-facing surfaces meant for plugin
	 * authors: the Starter Widget appears in the add-widget picker,
	 * and the OS Settings → Components tab runs its intentional
	 * missing-import-warner demo. Defaults to `false`. Per-user.
	 *
	 * @since 0.9.4
	 */
	developerModeEnabled: boolean;
	/**
	 * Per-item placement preferences. Map of item id → one of
	 * `'both' | 'dock' | 'desktop' | 'hidden'`. Missing keys mean
	 * "use the item's native rail." See
	 * {@link OsSettingsState.itemVisibility} for full semantics.
	 *
	 * @since 0.8.2
	 */
	itemVisibility: Record< string, 'both' | 'dock' | 'desktop' | 'hidden' >;
	/**
	 * User-defined dock ordering. Ordered list of item ids; ids absent
	 * from the list render after the listed ones in server-supplied
	 * order.
	 *
	 * @since 0.8.2
	 */
	dockOrder: string[];
	/**
	 * Persisted desktop position (in CSS px) for every dock item the
	 * user has promoted onto the wallpaper. Keyed by dock-item id.
	 * Missing keys mean "no override" — the synth placement falls
	 * back to the default grid slot. See
	 * {@link OsSettingsState.dockPromotedPositions} for the source
	 * field.
	 *
	 * @since 0.8.6
	 */
	dockPromotedPositions: Record< string, { x: number; y: number } >;
}

export interface SettingsTabRenderCtx {
	/**
	 * Whether the current user is an admin (`manage_options`). Handed
	 * through so a tab can conditionally render admin-only sections
	 * without reading from globals.
	 */
	isAdmin: boolean;
	/**
	 * Read the current OS Settings state. Equivalent to what the
	 * built-in tabs see — provider/apiKey for AI, wallpaper id, accent,
	 * dock size. Safe to call repeatedly; no hidden cost (plain object
	 * return).
	 *
	 * Returns a defensive copy — mutating the result does not change
	 * persisted state. To change settings, call
	 * `wp.desktop.updateOsSettings( patch )` — the public write path
	 * that persists, notifies subscribers, and fires the save
	 * lifecycle.
	 *
	 * @since 0.5.1
	 */
	getOsSettings(): OsSettingsSnapshot;
	/**
	 * Subscribe to OS Settings changes. Fires every time the user
	 * changes a setting in the OS Settings window (accent, AI key,
	 * etc.) — typically while they're in a different tab than yours.
	 * Returns an unsubscribe function.
	 *
	 * Scope caveat: only fires for local (in-tab) edits — in-panel
	 * changes or `wp.desktop.updateOsSettings()` calls. Changes made
	 * on another device/browser (which land via REST on the *next*
	 * page load) won't trigger this.
	 *
	 * @since 0.5.1
	 */
	subscribeOsSettings( cb: ( snapshot: OsSettingsSnapshot ) => void ): () => void;
}

export interface DesktopSettingsTab {
	/** Unique id — letters, digits, hyphen, underscore. */
	id: string;
	/** Human-readable tab label. */
	label: string;
	/**
	 * Required capability for the tab to render. Today the shell only
	 * distinguishes "admin" (maps to `manage_options`) from "everyone";
	 * any non-empty capability other than `manage_options` is treated
	 * as everyone-visible so plugins can round-trip their PHP metadata
	 * through the JS API without losing information.
	 */
	capability?: string;
	/**
	 * Sort order relative to built-in tabs:
	 * appearance = 10, ai = 20, apps-icons = 22, features = 25,
	 * effects = 27, extended = 30, help = 40 (About is pinned last
	 * with a sentinel order). Default 100 — third-party tabs render
	 * after the built-ins, before About.
	 */
	order?: number;
	/**
	 * Owner tag — WordPress script handle that registered the tab.
	 * Set this when plugin deactivation should live-unregister the
	 * tab; the server-sync module walks the registry on every payload
	 * and removes tabs whose `owner` matches a handle that just left
	 * `serverSettingsTabScripts`.
	 *
	 * Plugins that don't set `owner` still get live-registration on
	 * activation — the JS runs, `registerSettingsTab()` is called,
	 * the OS Settings window subscribes and repaints. Only the
	 * live-unregistration-on-deactivation case needs this field.
	 */
	owner?: string;
	/**
	 * Render callback — invoked with the tabpanel body element every
	 * time the OS Settings panel renders. Must be idempotent: closing
	 * and reopening the window rebuilds the tree, so any DOM state
	 * the tab wants to preserve belongs in module scope, not inside
	 * the body.
	 */
	render( body: HTMLElement, ctx: SettingsTabRenderCtx ): void;
}

/**
 * Cross-bundle shared backing store for the settings-tab registry.
 *
 * The OS Settings panel ships in its own Vite IIFE bundle since
 * 0.8.4 (`os-settings-panel[.min].js`) and reads from this registry
 * via `listSettingsTabs()` / `subscribeSettingsTabs()` to interleave
 * plugin-registered tabs with the built-ins. Meanwhile the main
 * bundle writes to it from two paths:
 *
 *   - `src/settings/server-sync.ts` — diffs PHP-declared tabs and
 *     calls `registerSettingsTab()` on every plugins-changed
 *     refresh, so live plugin install/activate surfaces the new tab
 *     without a reload.
 *   - `wp.desktop.registerSettingsTab()` — the JS-side public API.
 *
 * Without `createSharedStore`, the two bundles each get their own
 * compiled copy of this module's top-level `Map` + `Set`. Plugin
 * tabs registered in main never reach the panel, and the panel's
 * own re-renders never wake main's subscribers. The shared store
 * pins both fields to one record on
 * `window.__desktopModeSharedStores` so every bundle sees the same
 * Map and the same Set.
 */
interface SettingsTabRegistryStore {
	registry: Map< string, DesktopSettingsTab >;
	listeners: Set< () => void >;
}
const store = createSharedStore< SettingsTabRegistryStore >(
	'desktop-mode/settings-tab-registry',
	() => ( {
		registry: new Map< string, DesktopSettingsTab >(),
		listeners: new Set<() => void >(),
	} ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

/**
 * Register (or replace) an OS Settings tab. Id matching is
 * case-insensitive; a second registration with the same id replaces
 * the first — mirrors WordPress's `register_*` semantics.
 *
 * @since 0.5.1
 */
export function registerSettingsTab( tab: DesktopSettingsTab ): void {
	if ( ! tab || typeof tab.id !== 'string' || tab.id.trim() === '' ) {
		return;
	}
	if ( typeof tab.label !== 'string' || tab.label.trim() === '' ) {
		return;
	}
	if ( typeof tab.render !== 'function' ) {
		return;
	}
	const id = tab.id.trim().toLowerCase();
	if ( ! /^[a-z0-9_\-]+$/.test( id ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[desktop-mode] registerSettingsTab: id must be [a-z0-9_-]+, got',
				tab.id,
			);
		}
		return;
	}
	registry.set( id, { ...tab, id } );
	notify();
}

/** Remove a tab by id. */
export function unregisterSettingsTab( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

/**
 * Remove every tab whose `owner` tag matches. Used by the settings
 * server-sync on plugin deactivation.
 */
export function unregisterSettingsTabsByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ id, tab ] of Array.from( registry.entries() ) ) {
		if ( tab.owner === owner ) {
			registry.delete( id );
			removed++;
		}
	}
	if ( removed > 0 ) {
		notify();
	}
	return removed;
}

/**
 * Return every registered tab, sorted by `order` (default 100) then
 * by insertion order for ties.
 */
export function listSettingsTabs(): DesktopSettingsTab[] {
	return Array.from( registry.values() ).sort(
		( a, b ) => ( a.order ?? 100 ) - ( b.order ?? 100 ),
	);
}

/** Subscribe to registry changes. */
export function subscribeSettingsTabs( cb: () => void ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

function notify(): void {
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode] settings-tab-registry listener threw:',
					err,
				);
			}
		}
	}
}
