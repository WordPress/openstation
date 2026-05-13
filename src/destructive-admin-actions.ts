/**
 * Destructive-admin-action registry.
 *
 * The cross-page admin-link dispatcher (`handleCrossPageAdminLink`
 * in `src/window/iframe-bridge.ts`) classifies admin-internal clicks
 * into three buckets:
 *
 *   1. Native-window remap — opens a registered native window
 *      (Posts, Pages, Plugins, …) and closes the source iframe.
 *   2. Destructive action — navigates the SOURCE iframe in place
 *      so vanilla wp-admin's "row disappears + Undo notice on the
 *      same list" behavior is preserved.
 *   3. Cross-page open — spawns a new window for a genuine
 *      different-page navigation (Edit screen, deep settings link).
 *
 * Bucket 2 is what this registry feeds: a list of predicates +
 * a built-in whitelist of Core action names (Trash, Untrash, Delete
 * on posts; the spam / approve / trash / unspam set on comments).
 * Plugin authors that introduce their own redirect-back actions
 * (e.g. `admin.php?page=my-plugin&action=my-trash&_wpnonce=…`)
 * register a predicate here so their action stays in place too,
 * matching the UX every wp-admin user already has muscle memory for.
 *
 * Why a registry instead of "any URL with `_wpnonce`": plenty of
 * legitimate cross-page navigations also carry nonces (e.g.
 * `update-core.php?action=upgrade-core&_wpnonce=…`,
 * `users.php?action=adduser&_wpnonce=…`). Treating every nonce'd URL
 * as redirect-back would break the windowing UX for them. The
 * registry keeps the policy explicit and per-plugin.
 *
 * Cross-bundle state: the registry routes through
 * {@link createSharedStore} (key `desktop-mode/destructive-admin-actions`).
 * The `iframe-bridge.ts` module that walks the predicates lives in
 * the `window-system` Vite bundle; the main `desktop.ts` bundle is
 * where plugins typically run their `register*` calls — so a plain
 * module-level array would give each bundle its own private copy and
 * silently drop every registration. See `AGENTS.md` §
 * "Cross-bundle state — `wp.desktop.createSharedStore`".
 *
 * @since 0.8.4
 */

import { createSharedStore } from './shared-store';

/**
 * Predicate function shape — given the raw URL string + a parsed
 * URL object (the dispatcher parses once and shares for ergonomics),
 * return `true` to claim the URL as a destructive action.
 *
 * Predicates SHOULD also check for nonce presence — a `?action=foo`
 * without a nonce won't actually perform a side-effect on the
 * server (WP / plugin handlers reject it via `check_admin_referer`).
 * Including the nonce check disambiguates from action names that
 * plugins might overload for non-destructive flows.
 */
export type DestructiveAdminActionPredicate = (
	url: string,
	parsed: URL,
) => boolean;

/**
 * A single registry entry. The `id` is used to dedupe re-registrations
 * (same id replaces the prior entry) and to identify the entry on
 * unregister. Predicate-only access via {@link matches}.
 */
export interface DestructiveAdminActionEntry {
	/**
	 * Globally-unique id. Recommended format
	 * `<plugin>/<action-slug>` so two plugins won't collide.
	 */
	id: string;
	/**
	 * The classifier. The walker stops at the first match in
	 * registration order, so order across plugins follows
	 * registration order.
	 */
	matches: DestructiveAdminActionPredicate;
}

interface RegistryState {
	entries: DestructiveAdminActionEntry[];
}

const store = createSharedStore< RegistryState >(
	'desktop-mode/destructive-admin-actions',
	() => ( { entries: [] } ),
);

/**
 * Register (or replace) a destructive-admin-action predicate.
 *
 * @example
 * ```ts
 * wp.desktop.registerDestructiveAdminAction( {
 *     id: 'woocommerce/trash-order',
 *     matches: ( _url, parsed ) =>
 *         parsed.pathname.endsWith( '/admin.php' ) &&
 *         parsed.searchParams.get( 'page' ) === 'wc-orders' &&
 *         parsed.searchParams.get( 'action' ) === 'trash' &&
 *         parsed.searchParams.has( '_wpnonce' ),
 * } );
 * ```
 *
 * @since 0.8.4
 *
 * @param entry Registry entry. Returns a no-op unregister when the
 *              entry is malformed (missing id / matches), so callers
 *              can store the return value unconditionally.
 * @return Unregister function. Calling it removes the entry by id;
 *         subsequent calls are no-ops.
 */
export function registerDestructiveAdminAction(
	entry: DestructiveAdminActionEntry,
): () => void {
	if ( ! entry || typeof entry.id !== 'string' || entry.id.trim() === '' ) {
		return () => {};
	}
	if ( typeof entry.matches !== 'function' ) {
		return () => {};
	}

	const entries = store.state.entries;
	const idx = entries.findIndex( ( e ) => e.id === entry.id );
	if ( idx >= 0 ) {
		entries.splice( idx, 1 );
	}
	entries.push( entry );

	return () => unregisterDestructiveAdminAction( entry.id );
}

/**
 * Remove a destructive-admin-action entry by id. No-op when no entry
 * matches.
 *
 * @since 0.8.4
 *
 * @param id Entry id passed to {@link registerDestructiveAdminAction}.
 */
export function unregisterDestructiveAdminAction( id: string ): void {
	const entries = store.state.entries;
	const idx = entries.findIndex( ( e ) => e.id === id );
	if ( idx >= 0 ) {
		entries.splice( idx, 1 );
	}
}

/**
 * Defensive snapshot of the current registry — mutating the array
 * does NOT affect the registry. For debugging + the public API's
 * `list…` reflection method.
 *
 * @internal
 */
export function listDestructiveAdminActions(): DestructiveAdminActionEntry[] {
	return store.state.entries.slice();
}

/**
 * Walk the registry looking for a matching predicate. Returns the
 * first matching entry's id, or `null`. Used by the dispatcher only
 * — callers outside the bridge should generally not need this.
 *
 * @internal
 */
export function matchDestructiveAdminAction(
	url: string,
	parsed: URL,
): string | null {
	for ( const entry of store.state.entries ) {
		try {
			if ( entry.matches( url, parsed ) ) {
				return entry.id;
			}
		} catch ( err ) {
			// One bad predicate shouldn't shadow the rest. The
			// throw is the plugin author's bug; surface it but
			// keep walking.
			// eslint-disable-next-line no-console
			console.warn(
				`[desktop-mode] destructive-action predicate threw for "${ entry.id }":`,
				err,
			);
		}
	}
	return null;
}

/**
 * Test-only escape hatch — clears every registered entry. Used by
 * Vitest setups to keep tests independent.
 *
 * @internal
 */
export function _resetDestructiveAdminActionsForTests(): void {
	store.state.entries.length = 0;
}
