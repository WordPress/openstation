/**
 * Native-window URL remap registry.
 *
 * Centralizes the "when the user clicks a dock tile (or follows a portal
 * deep-link) that points at admin URL X, open the native window Y
 * instead" pattern. Each new native window that replaces a classic
 * admin page (Posts → `edit.php`, Pages → `edit.php?post_type=page`,
 * Media → `upload.php`, Users → `users.php`) registers a single entry
 * here; the Dock and the portal each consult `tryRemap()` on every
 * open and silently fall through to the iframe path when nothing
 * matches.
 *
 * The registry is intentionally tiny: a list of entries, a snapshot
 * accessor, and a single `tryRemap()` walker. No event bus, no public
 * surface — the consumers (`Dock.openPage`, the portal's deep-link
 * opener) import the functions directly. Plugins can hook the public
 * `wp.desktop.registerNativeUrlRemap()` (added later) when they ship
 * their own native replacements.
 *
 * Why a singleton instead of constructor-injected callbacks: the Dock
 * is constructed by every dock-rail renderer (default, custom plugin
 * renderers); plumbing a new positional arg through every renderer is
 * the kind of churn this design exists to avoid. A renderer that
 * doesn't want the remap behaviour simply doesn't call `tryRemap()`.
 *
 * @since 0.8.0
 */

import type { OsSettingsSnapshot } from './settings/registry';
import { createSharedStore } from './shared-store';

/**
 * A single URL → native-window remap.
 */
export interface NativeUrlRemap {
	/**
	 * Stable id for the remap. Used for unregistration / debugging /
	 * dedupe (re-registering the same id replaces the prior entry).
	 */
	id: string;
	/** The native window id to open when this remap matches. */
	nativeWindowId: string;
	/**
	 * Predicate against an admin-page URL. Receives the original URL
	 * string the dock or portal would have loaded, plus the resolved
	 * `URL` object (parsed once for ergonomic param access).
	 *
	 * Return `true` to claim the click. The walker stops at the first
	 * match in registration order.
	 */
	matches( url: string, parsed: URL ): boolean;
	/**
	 * Optional gate. Receives the current OS Settings snapshot — return
	 * `false` to defer the remap (e.g. when an opt-in toggle is off).
	 * Default: always enabled.
	 */
	enabled?( snapshot: OsSettingsSnapshot ): boolean;
	/**
	 * Optional pre-open hook. Fires AFTER `matches()` claims the URL
	 * and BEFORE the framework calls `openById( nativeWindowId )`.
	 * Lets a remap thread per-instance state (e.g. the target
	 * user_id parsed out of the URL) into a shared store the
	 * window's render callback reads. Synchronous; throwing here
	 * does NOT block the open — the framework still tries the
	 * native open and falls back if it fails.
	 *
	 * @since 0.18.0
	 */
	onMatch?( url: string, parsed: URL ): void;
}

interface RemapDeps {
	getSnapshot(): OsSettingsSnapshot;
	openById( id: string ): boolean;
	adminUrl: string;
}

// Routed through `createSharedStore` so the registry registered from
// the MAIN `desktop.ts` bundle is visible to the WINDOW-SYSTEM bundle
// that owns the `Window` class (`handleWindowMessage` calls
// `tryNativeUrlRemap` from inside the window-system bundle). A plain
// module-level array here would give each bundle its own private
// copy: `registerNativeUrlRemap()` in main would push into one array,
// `tryNativeUrlRemap()` in window-system would walk a different empty
// one, and every cross-page admin-link click that should remap to a
// native window would silently fall through. See `AGENTS.md`
// § "Cross-bundle state — `wp.desktop.createSharedStore`".
interface RemapRegistryState {
	remaps: NativeUrlRemap[];
	deps: RemapDeps | null;
}
const remapStore = createSharedStore< RemapRegistryState >(
	'desktop-mode/native-url-remap',
	() => ( { remaps: [], deps: null } ),
);

/**
 * Wire the registry to the live shell — called once from `desktop.ts`
 * after `OsSettings` and the native-window sync are constructed.
 *
 * @internal
 */
export function bindNativeUrlRemap( bound: RemapDeps ): void {
	remapStore.state.deps = bound;
}

/**
 * Register (or replace) a remap entry. Returns an unregister function.
 *
 * @since 0.8.0
 *
 * @param entry Remap descriptor.
 * @return Unregister function.
 */
export function registerNativeUrlRemap( entry: NativeUrlRemap ): () => void {
	if ( ! entry || typeof entry.id !== 'string' || entry.id.trim() === '' ) {
		return () => {};
	}
	if ( typeof entry.nativeWindowId !== 'string' || entry.nativeWindowId === '' ) {
		return () => {};
	}
	if ( typeof entry.matches !== 'function' ) {
		return () => {};
	}

	// Replace any existing entry with the same id — mirrors WordPress's
	// `register_*` semantics so a hot-reloaded bundle doesn't double up.
	const remaps = remapStore.state.remaps;
	const existingIdx = remaps.findIndex( ( r ) => r.id === entry.id );
	if ( existingIdx >= 0 ) {
		remaps.splice( existingIdx, 1 );
	}
	remaps.push( entry );

	return () => unregisterNativeUrlRemap( entry.id );
}

/**
 * Remove a remap by id.
 */
export function unregisterNativeUrlRemap( id: string ): void {
	const remaps = remapStore.state.remaps;
	const i = remaps.findIndex( ( r ) => r.id === id );
	if ( i >= 0 ) {
		remaps.splice( i, 1 );
	}
}

/**
 * List currently-registered remaps. Defensive copy — mutating the
 * result does not affect the registry.
 *
 * @internal
 */
export function listNativeUrlRemaps(): NativeUrlRemap[] {
	return remapStore.state.remaps.slice();
}

/**
 * Look up the native window id a URL would remap to, WITHOUT opening
 * anything. Returns `null` when no remap matches, when the matching
 * entry's `enabled` gate says no for the current OS Settings snapshot,
 * or when the registry isn't bound yet.
 *
 * Callers (the dock, the taskbar, anything that needs to know "is the
 * native replacement currently in charge of this URL?") use this to
 * align their open / focused indicators with the native window's id
 * instead of the iframe slug derived from the URL.
 *
 * @since 0.8.0
 *
 * @param url Raw admin URL the caller would have loaded.
 * @return Native window id the URL maps to, or `null`.
 */
export function resolveNativeUrlRemap( url: string ): string | null {
	const { deps, remaps } = remapStore.state;
	if ( ! deps || ! url ) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = new URL( url, deps.adminUrl );
	} catch {
		return null;
	}
	const snapshot = deps.getSnapshot();
	for ( const entry of remaps ) {
		if ( ! entry.matches( url, parsed ) ) {
			continue;
		}
		if ( entry.enabled && ! entry.enabled( snapshot ) ) {
			continue;
		}
		return entry.nativeWindowId;
	}
	return null;
}

/**
 * Walk the registry and try to redirect a click. Returns `true` when a
 * remap claimed the URL and the native window opened successfully.
 *
 * Caller must skip its default open path (iframe creation) when this
 * returns `true`. Returns `false` when no entry matched, when the
 * matching entry's gate said no, or when `openById()` reported the
 * native window is not registered for the current user.
 *
 * @since 0.8.0
 *
 * @param url Raw admin URL the caller would have loaded.
 * @return Whether the URL was remapped to a native window.
 */
export function tryNativeUrlRemap( url: string ): boolean {
	const { deps, remaps } = remapStore.state;
	if ( ! deps || ! url ) {
		return false;
	}
	let parsed: URL;
	try {
		parsed = new URL( url, deps.adminUrl );
	} catch {
		return false;
	}

	const snapshot = deps.getSnapshot();
	for ( const entry of remaps ) {
		if ( ! entry.matches( url, parsed ) ) {
			continue;
		}
		if ( entry.enabled && ! entry.enabled( snapshot ) ) {
			continue;
		}
		if ( entry.onMatch ) {
			try {
				entry.onMatch( url, parsed );
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.warn(
					`[desktop-mode] URL remap onMatch hook threw for "${ entry.id }":`,
					err,
				);
			}
		}
		if ( deps.openById( entry.nativeWindowId ) ) {
			return true;
		}
	}
	return false;
}

/**
 * Tear the registry down. Used by tests so a previous test's
 * registrations don't leak into the next one.
 *
 * @internal
 */
export function _resetNativeUrlRemap(): void {
	remapStore.state.remaps.length = 0;
	remapStore.state.deps = null;
}
