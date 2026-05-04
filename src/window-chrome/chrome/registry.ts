/**
 * Custom-chrome registry — Layer 4 of the window-chrome framework.
 *
 * **Status: Experimental.** The chrome render contract may change in
 * future minor versions. Layers 1-3 (themes, controls, slots) cover
 * 95%+ of practical customization by composition; reach for Layer 4
 * only when you need to draw a fundamentally different title bar
 * (a vertical title strip, a wide app-style header, a status-band
 * stack above the chrome).
 *
 * A registered chrome owns the entire title-bar DOM tree of any
 * window that selects it via `WindowConfig.appearance.chrome`. The
 * shell still owns drag, focus, resize, lifecycle, position
 * persistence, and the postMessage bridge — chrome render only
 * controls the visual + interactive surface inside the title bar.
 *
 * The default chrome (`'core/standard'`) registers from the shell's
 * own bootstrap and renders Layers 1-3 (theme + slots + controls).
 * Plugin chromes can render however they like — including by
 * delegating back to the standard chrome's helpers — but cannot
 * pre-empt the framework's drag / resize handlers.
 *
 * @since 0.6.0
 */

import { throwOnRegistrationErrors } from '../../registration-errors';

import type { Window as DesktopWindow } from '../../window';
import type { WindowState } from '../../types';

/**
 * Lifecycle state surfaced to a chrome renderer. Chrome implementations
 * read this on first paint and on every `update()` call to refresh
 * the title-bar visual.
 *
 * @public
 */
export interface ChromeRenderState {
	title: string;
	icon: string;
	focused: boolean;
	state: WindowState;
}

/**
 * Render context handed to a chrome render callback.
 *
 * @public
 */
export interface ChromeRenderContext {
	/** The window the chrome is being rendered for. */
	window: DesktopWindow;
	/** Initial render state. Mirrors the data passed to `update()`. */
	state: ChromeRenderState;
}

/**
 * Render handle returned by a chrome render callback. The shell uses
 * it to push state updates and to tear the chrome down when it's
 * being replaced or the window closes.
 *
 * @public
 */
export interface ChromeRenderHandle {
	/**
	 * Called when the underlying window state changes (focus, title,
	 * icon, window-state). Chrome implementations re-paint the
	 * relevant DOM nodes from the new state.
	 *
	 * Optional — implementations that subscribe to lifecycle hooks
	 * directly can skip `update` entirely.
	 */
	update?: ( state: ChromeRenderState ) => void;
	/**
	 * Required teardown. The shell calls this when:
	 *
	 *   - The window's chrome is swapped to a different registration.
	 *   - The window closes.
	 *   - The chrome is unregistered (registry mutation).
	 *
	 * Drop event listeners, disconnect observers, free retained
	 * references. The shell will remove host children itself after
	 * `destroy()` returns.
	 */
	destroy: () => void;
}

/**
 * A registered window chrome.
 *
 * @public
 */
export interface WindowChromeDef {
	/**
	 * Unique id matching `/^[a-z0-9_/-]+$/`. The default chrome uses
	 * `'core/standard'`; plugins use `'vendor/sub-id'`.
	 */
	id: string;
	/** Optional human-readable label for tooling / chrome pickers. */
	label?: string;
	/**
	 * Predicate — return `true` to make this chrome eligible for the
	 * window. The shell still consults `WindowConfig.appearance.chrome`
	 * for the explicit selection; `match` is the gate that prevents a
	 * chrome from being installed on incompatible windows (e.g. a
	 * mobile-shaped chrome refusing desktop-sized windows).
	 *
	 * Throwing predicates are treated as `false`.
	 */
	match: ( window: DesktopWindow ) => boolean;
	/**
	 * Render callback. Receives the chrome's host element (the
	 * `<div class="desktop-mode-window">` outer element with body
	 * already created) and a context object. The implementation
	 * mounts its title-bar DOM into the host, returns a handle whose
	 * `update()` re-paints on state change and `destroy()` tears
	 * down on swap / close.
	 *
	 * The host element ALREADY contains the body + resize handles —
	 * chrome implementations should mount the title bar by querying /
	 * inserting children rather than wiping the host.
	 */
	render: ( host: HTMLElement, ctx: ChromeRenderContext ) => ChromeRenderHandle;
	/**
	 * Owner tag — typically the WordPress script handle that registered
	 * the chrome. Set to live-unregister on plugin deactivation.
	 */
	owner?: string;
}

const registry = new Map< string, WindowChromeDef >();
const listeners = new Set<() => void >();

const WINDOW_CHROME_ID = /^[a-z0-9_/-]+$/;

/**
 * Register (or replace) a window chrome. Throws a
 * {@link RegistrationError} on validation failure.
 */
export function registerWindowChrome( def: WindowChromeDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_CHROME_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_CHROME_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( typeof def.match !== 'function' ) {
			errors.push( 'match (must be a function)' );
		}
		if ( typeof def.render !== 'function' ) {
			errors.push( 'render (must be a function)' );
		}
	}

	throwOnRegistrationErrors( 'WindowChrome', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

/**
 * Remove a chrome by id. No-op when the id wasn't registered.
 *
 * Removing the chrome a window currently uses falls back to
 * `'core/standard'` on the next chrome resolve.
 */
export function unregisterWindowChrome( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

/**
 * Bulk teardown — drop every chrome whose `owner` matches.
 */
export function unregisterWindowChromesByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ id, def ] of Array.from( registry.entries() ) ) {
		if ( def.owner === owner ) {
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
 * Snapshot of every registered chrome, in id-stable order.
 */
export function listWindowChromes(): WindowChromeDef[] {
	return Array.from( registry.values() ).sort( ( a, b ) =>
		a.id.localeCompare( b.id ),
	);
}

/**
 * Lookup a chrome by id, or `null` when no chrome is registered
 * under that id.
 */
export function getWindowChrome( id: string ): WindowChromeDef | null {
	return registry.get( id.toLowerCase() ) ?? null;
}

/**
 * Subscribe to registry changes. Returns an unsubscribe function.
 */
export function subscribeWindowChromes( cb: () => void ): () => void {
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
				// eslint-disable-next-line no-console
				console.error(
					'[desktop-mode] window-chrome registry listener threw:',
					err,
				);
			}
		}
	}
}

/**
 * Test-only: drop every chrome + clear subscribers.
 *
 * @internal
 */
export function _resetWindowChromeRegistryForTests(): void {
	registry.clear();
	listeners.clear();
}
