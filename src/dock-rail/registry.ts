/**
 * Desktop Mode — Dock rail renderer registry.
 *
 * Mirrors the submenu renderer registry pattern (`src/submenu/registry.ts`).
 * Same shape, same DX. The active id mirrors `state.dockRailRenderer`;
 * the layout dispatcher reads {@link resolveActive} when it
 * (re)builds a rail.
 *
 * @since 0.18.0
 */

import { createSharedStore } from '../shared-store';
import type { DockRailRenderer } from './types';

/**
 * Cross-bundle shared backing store. Same rationale as
 * `src/wallpapers/registry.ts` and `src/settings/registry.ts`: the
 * lazy OS Settings panel bundle reads dock-rail renderers via
 * `listDockRailRenderers()` to paint the picker, while main writes
 * to the registry from `dock-rail/server-sync.ts` (live plugin
 * register/unregister) and `wp.desktop.registerDockRailRenderer()`.
 * Without `createSharedStore` the two bundles each carry their own
 * `Map` and updates from one don't reach the other.
 *
 * `activeId` lives in the store too because it's read at render
 * time by every dock rebuild — keeping it bundle-local would let
 * the panel's "set active renderer" call write only the panel
 * bundle's mirror.
 */
interface DockRailRegistryStore {
	registry: Map< string, DockRailRenderer >;
	listeners: Set< () => void >;
	activeId: string;
}
const store = createSharedStore< DockRailRegistryStore >(
	'desktop-mode/dock-rail-registry',
	() => ( {
		registry: new Map< string, DockRailRenderer >(),
		listeners: new Set< () => void >(),
		activeId: 'default',
	} ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const ID_RE = /^[a-z0-9_-]+$/;

/**
 * Register (or replace) a rail renderer. Validates the shape and
 * either inserts or overwrites by id.
 *
 * Late registrations win: a second `register()` with the same id
 * replaces the first. This is what makes the canonical `'default'`
 * entry replaceable — a plugin can ship its own `id: 'default'`
 * to override without users needing to flip a setting.
 *
 * Throws on a malformed shape so plugin authors see the error in
 * their console immediately rather than silently failing.
 */
export function register( renderer: DockRailRenderer ): void {
	if ( ! renderer || typeof renderer !== 'object' ) {
		throw new TypeError(
			'[desktop-mode] registerDockRailRenderer: renderer must be an object.',
		);
	}
	if ( typeof renderer.id !== 'string' || ! ID_RE.test( renderer.id ) ) {
		throw new TypeError(
			`[desktop-mode] registerDockRailRenderer: id must match /^[a-z0-9_-]+$/, got: ${ String( renderer.id ) }`,
		);
	}
	if ( typeof renderer.label !== 'string' || renderer.label === '' ) {
		throw new TypeError(
			'[desktop-mode] registerDockRailRenderer: label must be a non-empty string.',
		);
	}
	if ( typeof renderer.mount !== 'function' ) {
		throw new TypeError(
			'[desktop-mode] registerDockRailRenderer: mount must be a function.',
		);
	}
	if (
		renderer.apiVersion !== undefined &&
		renderer.apiVersion !== 1
	) {
		throw new TypeError(
			`[desktop-mode] registerDockRailRenderer: unsupported apiVersion ${ renderer.apiVersion } (this shell speaks v1).`,
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
 * removed.
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
export function get( id: string ): DockRailRenderer | undefined {
	return registry.get( id );
}

/** Return every registered renderer in registration order. */
export function list(): DockRailRenderer[] {
	return Array.from( registry.values() );
}

/** Subscribe to registry changes. Returns an unsubscribe function. */
export function subscribe( cb: () => void ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

/**
 * Set the active renderer id. Called by the shell when the user
 * changes `dockRailRenderer` in OS Settings, and at boot from the
 * persisted snapshot. Notifies subscribers so the picker repaints
 * AND the layout dispatcher can rebuild the rails with the new
 * renderer.
 */
export function setActiveRenderer( id: string ): void {
	if ( store.state.activeId === id ) {
		return;
	}
	store.state.activeId = id;
	notify();
}

/** Read the current active id without resolution. Used by the picker. */
export function getActiveRendererId(): string {
	return store.state.activeId;
}

/**
 * Resolve the renderer the user's currently pointing at, with the
 * standard fallback chain:
 *
 * 1. User's `activeId` (their OS Settings pick, default `'default'`).
 * 2. The built-in `'default'` renderer if registered.
 * 3. Any other registered renderer (Map iteration first) — covers
 *    "plugin replaced default and was then deactivated."
 *
 * Returns `undefined` only when the registry is completely empty.
 * Should not happen in practice because `installDefaultDockRailRenderer`
 * runs at boot.
 */
export function resolveActive(): DockRailRenderer | undefined {
	return (
		registry.get( store.state.activeId ) ??
		registry.get( 'default' ) ??
		registry.values().next().value
	);
}

/** Internal: clear every renderer + listener. Test-only. */
export function _resetForTests(): void {
	registry.clear();
	listeners.clear();
	store.state.activeId = 'default';
}

function notify(): void {
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode] dock-rail-renderer listener threw:',
					err,
				);
			}
		}
	}
}
