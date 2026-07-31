/**
 * Desktop Mode — Wallpaper registry.
 *
 * Owns the in-memory list of available wallpapers and applies the
 * `desktop-mode.wallpapers` filter each time callers read it. That
 * means plugins can both register entries via
 * `wp.desktop.registerWallpaper()` (which internally adds a filter)
 * and reach the raw filter API for more exotic operations — reorder,
 * remove, conditionally swap.
 *
 * The registry is intentionally cache-free: every `all()` / `get()`
 * call re-applies the filter. That's fine — the filter chain is
 * shallow (a handful of built-ins plus any plugin additions) and we
 * call `all()` at most on each OS Settings render, not on every
 * window paint.
 */

import { applyFilters, HOOKS } from '../hooks';
import {
	collectRegistrationErrors,
	throwOnRegistrationErrors,
} from '../registration-errors';
import { createSharedStore } from '../shared-store';
import type { WallpaperDef } from './types';

/**
 * Listener fired after every successful `register()` / `unregister()`.
 * Declared up here (rather than near `subscribe()` further down)
 * because the shared store's type signature needs it.
 */
type RegistryListener = () => void;

/**
 * Shared store backing the wallpaper registry.
 *
 * The seed list AND the subscriber set live here. This is critical:
 * the OS Settings panel ships in its own Vite IIFE
 * bundle (`os-settings-panel[.min].js`), so a plain
 * `const seed: WallpaperDef[] = []` at module scope would give the
 * main bundle and the panel bundle each their own copy — main's
 * server-sync would register the PHP-declared CSS presets (dark /
 * aurora / sunset / forest / mono) into main's seed, but the panel's
 * wallpaper picker would iterate the panel's empty seed and render
 * only whatever the panel itself registered (`custom-gradient`).
 * Routing through `createSharedStore` makes both bundles share a
 * single record on `window.__desktopModeSharedStores`.
 *
 * Both fields are captured into module-local `seed` / `listeners`
 * references below. Because `createSharedStore` returns the same
 * underlying object across bundles, mutating those references
 * (push / splice / add / delete) propagates to every other bundle
 * that holds the same shared store handle.
 */
interface WallpaperRegistryStore {
	seed: WallpaperDef[];
	listeners: Set< RegistryListener >;
}
const store = createSharedStore< WallpaperRegistryStore >(
	'desktop-mode/wallpaper-registry',
	() => ( {
		seed: [],
		listeners: new Set< RegistryListener >(),
	} ),
);
const seed = store.state.seed;
const listeners = store.state.listeners;

/**
 * Append a wallpaper to the seed list.
 *
 * Used by the built-in presets (`built-in.ts`) and by the convenience
 * `wp.desktop.registerWallpaper()` wrapper. Third parties can also
 * call this directly, but the recommended entry point is the hook
 * API so plugin identity can be tracked.
 */
export function register( def: WallpaperDef ): void {
	throwOnRegistrationErrors(
		'Wallpaper',
		collectRegistrationErrors< WallpaperDef >( def, WALLPAPER_CHECKS ),
		def,
	);
	// Replace an existing entry with the same id rather than doubling
	// up. Late registrations win — matches WP's `register_*` semantics
	// where the most recent call owns the final state.
	const idx = seed.findIndex( ( w ) => w.id === def.id );
	if ( idx >= 0 ) {
		seed[ idx ] = def;
	} else {
		seed.push( def );
	}
	notify();
}

/** Remove a wallpaper by id. Rare, but keeps symmetry with `register`. */
export function unregister( id: string ): void {
	const idx = seed.findIndex( ( w ) => w.id === id );
	if ( idx >= 0 ) {
		seed.splice( idx, 1 );
		notify();
	}
}

// ---------------------------------------------------------------------------
// Change subscription
//
// UI surfaces that render wallpaper lists (OS Settings picker) need to
// re-paint when a plugin is activated mid-session and registers its
// wallpaper, or when it's deactivated and the registry shrinks. This
// subscribe() API is how they hear about it.
// ---------------------------------------------------------------------------

/**
 * Subscribe to registry changes. The callback fires after every
 * successful `register()` or `unregister()` call. Returns an
 * unsubscribe function the caller should invoke when the UI surface
 * is torn down (or can be left to self-clean via `isConnected`
 * checks inside the callback).
 *
 * @param cb Listener to invoke on change.
 * @return Unsubscribe function.
 */
export function subscribe( cb: RegistryListener ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

/** Notify all subscribers. Listeners that throw don't break the others. */
function notify(): void {
	// Snapshot before iterating — listeners may unsubscribe themselves
	// during their callback, and mutating a Set mid-iteration is
	// defined but awkward.
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode] wallpaper registry listener threw:',
					err,
				);
			}
		}
	}
}

/**
 * Produce the current wallpaper list with the `desktop-mode.wallpapers`
 * filter applied. Plugins that hooked into the filter after load
 * participate automatically; the seed array is copied so filter
 * callbacks can safely mutate their input without corrupting state.
 */
export function all(): WallpaperDef[] {
	const copy = seed.slice();
	const filtered = applyFilters<WallpaperDef[]>( HOOKS.WALLPAPERS, copy );
	// Defensive: a misbehaving filter could return undefined / a
	// non-array. Fall back to the unfiltered seed rather than break
	// the entire OS Settings panel.
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[desktop-mode] `desktop-mode.wallpapers` filter ' +
					'returned a non-array; falling back to seed list.',
			);
		}
		return copy;
	}
	// Drop any entries a filter callback mangled into an invalid
	// shape — keeps downstream renders robust against bad plugins.
	return filtered.filter( isValidDef );
}

/** Look up a wallpaper by id, post-filter. */
export function get( id: string ): WallpaperDef | undefined {
	return all().find( ( w ) => w.id === id );
}

/**
 * Minimum-viable validation. Enforces presence of the fields the
 * shell actually relies on. Deeper validation (CSS value parsing,
 * mount function typing) would over-reach — plugin authors are in
 * charge of their own correctness past this boundary.
 */
const WALLPAPER_CHECKS = [
	{
		field: 'id',
		message: 'missing or not a non-empty string',
		valid: ( d: Partial< WallpaperDef > ) =>
			typeof d.id === 'string' && d.id !== '',
	},
	{
		field: 'label',
		message: 'missing or not a non-empty string',
		valid: ( d: Partial< WallpaperDef > ) =>
			typeof d.label === 'string' && d.label !== '',
	},
	{
		field: 'preview',
		message: 'missing or not a non-empty string',
		valid: ( d: Partial< WallpaperDef > ) =>
			typeof d.preview === 'string' && d.preview !== '',
	},
	{
		field: 'type',
		message: 'must be "css" or "canvas"',
		valid: ( d: Partial< WallpaperDef > ) =>
			d.type === 'css' || d.type === 'canvas',
	},
	{
		field: 'value/resolveValue/mount',
		message:
			'css types need `value` or `resolveValue`; canvas types need `mount`',
		valid: ( d: Partial< WallpaperDef > ) => {
			if ( d.type === 'css' ) {
				return (
					typeof ( d as { value?: unknown } ).value === 'string' ||
					typeof ( d as { resolveValue?: unknown } ).resolveValue ===
						'function'
				);
			}
			if ( d.type === 'canvas' ) {
				return typeof ( d as { mount?: unknown } ).mount === 'function';
			}
			// type check already failed above; don't double-report.
			return true;
		},
	},
];

function isValidDef( def: unknown ): def is WallpaperDef {
	return (
		collectRegistrationErrors< WallpaperDef >( def, WALLPAPER_CHECKS ).length === 0
	);
}
