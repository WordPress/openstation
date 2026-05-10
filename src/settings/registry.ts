/**
 * Third-party OS Settings tab registry.
 *
 * Plugins register additional tabs in the OS Settings window via the
 * public `wp.desktop.registerSettingsTab()` API. Built-in tabs
 * (appearance, ai, extended, help) live directly in `index.ts`; this
 * registry extends the panel with externally-contributed tabs without
 * the core module needing to know about them.
 *
 * Rendering is the tab's own responsibility — `render( body )` receives
 * the tabpanel body element and may do whatever it wants inside it
 * (plain DOM, `html`/`render` from `../ui/core`, a framework, etc.).
 *
 * @since 0.17.0
 */

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
 * @since 0.17.0
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
	 * @since 0.18.0
	 */
	desktopLayout: 'classic' | 'unified' | 'spatial';
	/**
	 * Active dock rail-renderer id; mirrors the dock-rail registry's
	 * resolution. `'default'` is the shipped icon-strip renderer.
	 *
	 * @since 0.18.0
	 */
	dockRailRenderer: string;
	ai: {
		enabled: boolean;
		provider: string;
		apiKey: string;
		/**
		 * Live-progress transport for AI search: `'sse' | 'off'`. Default
		 * `'off'`. Surfaced so a third-party AI tab can read the user's
		 * preferred transport without rebuilding the picker.
		 *
		 * @since 0.18.1
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
	 * `<wpd-table>` window instead of the chromeless iframe. Default on.
	 *
	 * @since 0.18.0
	 */
	nativePagesEnabled: boolean;
	/**
	 * Per-user opt-in for the native Users window. Same posture as
	 * {@link nativePagesEnabled} — UI-side gate; the window itself is
	 * cap-gated on the server. Default on.
	 *
	 * @since 0.18.0
	 */
	nativeUsersEnabled: boolean;
	/**
	 * Per-user opt-in for the native Plugins window. Same posture as
	 * {@link nativeUsersEnabled} — UI-side gate; the window itself is
	 * cap-gated on the server (`activate_plugins`). Default on.
	 *
	 * @since 0.9.0
	 */
	nativePluginsEnabled: boolean;
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
	 * persisted state. To change settings, a tab must either own its
	 * own REST endpoint or rely on the user visiting the corresponding
	 * built-in tab.
	 *
	 * @since 0.17.0
	 */
	getOsSettings(): OsSettingsSnapshot;
	/**
	 * Subscribe to OS Settings changes. Fires every time the user
	 * changes a setting in the OS Settings window (accent, AI key,
	 * etc.) — typically while they're in a different tab than yours.
	 * Returns an unsubscribe function.
	 *
	 * Scope caveat: only fires for in-panel edits. Changes made on
	 * another device/browser (which land via REST on the *next* page
	 * load) won't trigger this.
	 *
	 * @since 0.17.0
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
	 * appearance = 10, ai = 20, extended = 30, help = 40.
	 * Default 100 — third-party tabs render after the built-ins.
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

const registry = new Map< string, DesktopSettingsTab >();
const listeners = new Set<() => void >();

/**
 * Register (or replace) an OS Settings tab. Id matching is
 * case-insensitive; a second registration with the same id replaces
 * the first — mirrors WordPress's `register_*` semantics.
 *
 * @since 0.17.0
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
