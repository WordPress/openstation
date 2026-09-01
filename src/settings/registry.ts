/**
 * Third-party Preferences tab registry.
 *
 * Plugins register additional tabs in the OpenStation Preferences
 * window via the public `wp.os.registerSettingsTab()` API. The
 * built-in pages (Appearance, Themes, Windows, Navigation, Features,
 * Components, About) live in the Preferences app (`apps/os-settings/`);
 * this registry extends it with externally-contributed tabs without
 * the app needing to know about them.
 *
 * Rendering is the tab's own responsibility — `render( body )` receives
 * the tabpanel body element and may do whatever it wants inside it
 * (plain DOM, `html`/`render` from `../ui/core`, a framework, etc.).
 */

import { createSharedStore } from '../shared-store';
import type { OsSettingsState } from './types';

/**
 * The persisted Preferences state as third-party code reads it — what
 * `wp.os.getOsSettings()` returns and `wp.os.updateOsSettings()`
 * patches. It IS the state shape: every key the store holds is public,
 * documented on {@link OsSettingsState}, and writable through the
 * public API (with one shell-owned exception, the seeded-theme ledger
 * `appliedThemeRecommendations`, which the write path ignores). Always
 * handed out as a defensive copy — mutating a snapshot changes nothing.
 */
export type OsSettingsSnapshot = OsSettingsState;

export interface SettingsTabRenderCtx {
	/**
	 * Whether the current user is an admin (`manage_options`). Handed
	 * through so a tab can conditionally render admin-only sections
	 * without reading from globals.
	 */
	isAdmin: boolean;
	/**
	 * Read the current Preferences state. Equivalent to what the
	 * built-in pages see — wallpaper id, accent, dock size, the AI
	 * toggle. Safe to call repeatedly; no hidden cost (plain object
	 * return).
	 *
	 * Returns a defensive copy — mutating the result does not change
	 * persisted state. To change settings, call
	 * `wp.os.updateOsSettings( patch )` — the public write path
	 * that persists, notifies subscribers, and fires the save
	 * lifecycle.
	 */
	getOsSettings(): OsSettingsSnapshot;
	/**
	 * Subscribe to Preferences changes. Fires every time the user
	 * changes a setting in the Preferences window (accent, AI toggle,
	 * etc.) — typically while they're in a different tab than yours.
	 * Returns an unsubscribe function.
	 *
	 * Scope caveat: only fires for local (in-tab) edits — in-panel
	 * changes or `wp.os.updateOsSettings()` calls. Changes made
	 * on another device/browser (which land via REST on the *next*
	 * page load) won't trigger this.
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
	 * Sort order relative to the built-in pages:
	 * appearance = 10, themes = 12, windows = 18, navigation = 22,
	 * features = 30, help = 40 (About is pinned last with a sentinel
	 * order). Default 100 — third-party tabs render after the
	 * built-ins, before About.
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
	 * the Preferences window subscribes and repaints. Only the
	 * live-unregistration-on-deactivation case needs this field.
	 */
	owner?: string;
	/**
	 * Render callback — invoked with the tabpanel body element when
	 * the tab is first painted, and again whenever the tab is
	 * re-registered. Must be idempotent: closing and reopening the
	 * window rebuilds the tree, so any DOM state the tab wants to
	 * preserve belongs in module scope, not inside the body.
	 */
	render( body: HTMLElement, ctx: SettingsTabRenderCtx ): void;
}

/**
 * Cross-bundle shared backing store for the settings-tab registry.
 *
 * The Preferences app ships in its own Vite IIFE bundle
 * (`assets/js/apps/os-settings[.min].js`) and reads from this registry
 * via `listSettingsTabs()` / `subscribeSettingsTabs()` to interleave
 * plugin-registered tabs with the built-in pages. Meanwhile the main
 * bundle writes to it from two paths:
 *
 *   - `src/settings/server-sync.ts` — diffs PHP-declared tabs and
 *     calls `registerSettingsTab()` on every plugins-changed
 *     refresh, so live plugin install/activate surfaces the new tab
 *     without a reload.
 *   - `wp.os.registerSettingsTab()` — the JS-side public API.
 *
 * Without `createSharedStore`, the two bundles each get their own
 * compiled copy of this module's top-level `Map` + `Set`. Plugin
 * tabs registered in main never reach the app, and the app's
 * own re-renders never wake main's subscribers. The shared store
 * pins both fields to one record on
 * `window.__openStationSharedStores` so every bundle sees the same
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
 * Register (or replace) a Preferences tab. Id matching is
 * case-insensitive; a second registration with the same id replaces
 * the first — mirrors WordPress's `register_*` semantics.
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
				'[openstation] registerSettingsTab: id must be [a-z0-9_-]+, got',
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
					'[openstation] settings-tab-registry listener threw:',
					err,
				);
			}
		}
	}
}
