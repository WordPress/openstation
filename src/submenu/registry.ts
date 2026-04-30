/**
 * Desktop Mode — Submenu renderer registry.
 *
 * In-memory lookup table for {@link SubmenuRenderer} instances.
 * Entry points:
 *
 * - `register()` — plugin opt-in; replaces an entry with the same
 *   id so late registrations win (matches WP `register_*` semantics).
 * - `get()` — fetch by id; returns `undefined` if missing.
 * - `list()` — full list (sorted by registration order); used by the
 *   OS Settings picker.
 * - `subscribe()` — UI surfaces (the picker) listen for changes so
 *   they repaint when a plugin is activated mid-session.
 *
 * The default `'default'` renderer is registered at boot from
 * `default-renderer.ts` and treated as the fallback when the user's
 * `submenuRenderer` setting points at an id that no longer exists
 * (plugin deactivated since it was picked).
 *
 * @since 0.18.0
 */

import type { SubmenuRenderer } from './types';

const registry = new Map<string, SubmenuRenderer>();
const listeners = new Set<() => void>();

const ID_RE = /^[a-z0-9_-]+$/;

/**
 * The id the user has picked in OS Settings → Appearance →
 * Submenu style. Mirrors `state.submenuRenderer`. Settings changes
 * push into here via {@link setActiveRenderer}; the Dock reads
 * {@link resolveActive} on each right-click to find the renderer
 * to mount.
 */
let activeId: string = 'default';

/**
 * Register (or replace) a submenu renderer. Validates the shape and
 * either inserts or overwrites by id.
 *
 * Late registrations win: a second `register()` with the same id
 * replaces the first, matching WordPress's `register_*` semantics.
 * This is what makes the canonical `'default'` entry replaceable —
 * a plugin can ship its own `id: 'default'` to take over without
 * users needing to flip a setting.
 *
 * Throws on a malformed shape (missing id, missing mount, bad id
 * pattern). The throw surfaces through `wp.desktop.registerSubmenuRenderer`
 * so plugin authors see the error in their console immediately
 * rather than silently failing.
 */
export function register( renderer: SubmenuRenderer ): void {
	if ( ! renderer || typeof renderer !== 'object' ) {
		throw new TypeError(
			'[wp-desktop-mode] registerSubmenuRenderer: renderer must be an object.',
		);
	}
	if ( typeof renderer.id !== 'string' || ! ID_RE.test( renderer.id ) ) {
		throw new TypeError(
			`[wp-desktop-mode] registerSubmenuRenderer: id must match /^[a-z0-9_-]+$/, got: ${ String( renderer.id ) }`,
		);
	}
	if ( typeof renderer.label !== 'string' || renderer.label === '' ) {
		throw new TypeError(
			'[wp-desktop-mode] registerSubmenuRenderer: label must be a non-empty string.',
		);
	}
	if ( typeof renderer.mount !== 'function' ) {
		throw new TypeError(
			'[wp-desktop-mode] registerSubmenuRenderer: mount must be a function.',
		);
	}
	if (
		renderer.apiVersion !== undefined &&
		renderer.apiVersion !== 1
	) {
		throw new TypeError(
			`[wp-desktop-mode] registerSubmenuRenderer: unsupported apiVersion ${ renderer.apiVersion } (this shell speaks v1).`,
		);
	}
	registry.set( renderer.id, renderer );
	notify();
}

/** Remove a renderer by id. */
export function unregister( id: string ): void {
	if ( registry.delete( id ) ) {
		notify();
	}
}

/**
 * Remove every renderer whose `owner` tag matches. Used by the
 * server-sync module on plugin deactivation. Returns the count
 * removed so callers can decide whether to surface a toast.
 */
export function unregisterByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ id, renderer ] of Array.from( registry.entries() ) ) {
		if ( renderer.owner === owner ) {
			registry.delete( id );
			removed++;
		}
	}
	if ( removed > 0 ) {
		notify();
	}
	return removed;
}

/** Fetch a renderer by id; returns `undefined` if missing. */
export function get( id: string ): SubmenuRenderer | undefined {
	return registry.get( id );
}

/** Return every registered renderer in registration order. */
export function list(): SubmenuRenderer[] {
	return Array.from( registry.values() );
}

/**
 * Subscribe to registry changes. Fires after every successful
 * `register` / `unregister` / `unregisterByOwner` call. Returns an
 * unsubscribe function.
 */
export function subscribe( cb: () => void ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

/**
 * Set the active renderer id. Called by the shell when the user
 * changes `submenuRenderer` in OS Settings, and at boot from the
 * persisted snapshot. Notifies subscribers so the OS Settings
 * picker can repaint.
 */
export function setActiveRenderer( id: string ): void {
	if ( activeId === id ) {
		return;
	}
	activeId = id;
	notify();
}

/** Read the current active id without resolution. Used by the picker. */
export function getActiveRendererId(): string {
	return activeId;
}

/**
 * Resolve the renderer the user's currently pointing at, with a
 * defensive fallback chain:
 *
 * 1. User's `activeId` (their OS Settings pick, default `'default'`).
 * 2. The built-in `'default'` renderer if registered.
 * 3. Any other registered renderer (whichever Map iteration finds
 *    first) — covers the case where a plugin replaced `'default'`
 *    and was then deactivated.
 *
 * Returns `undefined` only when the registry is completely empty —
 * shouldn't happen in practice because `installDefaultSubmenuRenderer()`
 * runs at boot.
 */
export function resolveActive(): SubmenuRenderer | undefined {
	return (
		registry.get( activeId ) ??
		registry.get( 'default' ) ??
		registry.values().next().value
	);
}

/** Internal: clear every renderer + listener. Test-only. */
export function _resetForTests(): void {
	registry.clear();
	listeners.clear();
	activeId = 'default';
}

function notify(): void {
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[wp-desktop-mode] submenu-renderer listener threw:',
					err,
				);
			}
		}
	}
}
