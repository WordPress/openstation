/**
 * OpenStation — Window-link renderer registry.
 *
 * Owns the list of available window-link renderers (how relation ties
 * between windows are drawn) and applies the
 * `os.window-links.renderers` filter each time callers read
 * it. The built-in `svg-splines` is seeded here through the very same
 * `register()` the public hook calls — the shipped renderer dogfoods
 * the extensibility API rather than taking a private shortcut.
 *
 * Cross-bundle: the registry AND the subscriber set live in a
 * `createSharedStore` record so the lazy OS-Settings-panel bundle
 * (the selector), third-party renderer bundles, and the main shell
 * share a single registry — see AGENTS.md → "Cross-bundle state".
 */

import { applyFilters, HOOKS } from '../hooks';
import { throwOnRegistrationErrors } from '../registration-errors';
import { createSharedStore } from '../shared-store';
import type { WindowLinkRendererDef } from './types';

type RegistryListener = () => void;

/**
 * Reserved renderer id meaning "don't draw the ties". Offered in the
 * OS Settings selector and used as the render host's sentinel, but
 * never a registered def — `registerWindowLinkRenderer` rejects it.
 */
export const WINDOW_LINK_RENDERER_NONE = 'none';

/** The id the render host falls back to when the picked id vanished. */
export const WINDOW_LINK_RENDERER_DEFAULT = 'svg-splines';

interface WindowLinkRendererRegistryStore {
	registry: Map< string, WindowLinkRendererDef >;
	listeners: Set< RegistryListener >;
}
const store = createSharedStore< WindowLinkRendererRegistryStore >(
	'desktop-mode/window-link-renderer-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

/**
 * Valid renderer id — same shape as every other registry so plugins
 * can namespace `vendor/sub-id`.
 *
 * @internal
 */
const WINDOW_LINK_RENDERER_ID = /^[a-z0-9_/-]+$/;

/**
 * Register (or replace) a window-link renderer. Re-registering the
 * same id replaces the previous entry — mirrors WordPress's
 * `register_*` semantics where the latest call wins.
 *
 * Throws a {@link RegistrationError} on validation failure so plugin
 * authors get a stack frame at registration time instead of a
 * silently missing selector entry.
 *
 * @param  def Renderer definition.
 * @throws {RegistrationError} when `def` fails validation.
 */
export function registerWindowLinkRenderer( def: WindowLinkRendererDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if (
			! WINDOW_LINK_RENDERER_ID.test( def.id.trim().toLowerCase() )
		) {
			errors.push(
				`id (must match ${ WINDOW_LINK_RENDERER_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		} else if (
			def.id.trim().toLowerCase() === WINDOW_LINK_RENDERER_NONE
		) {
			// `none` is the host's reserved "don't draw" sentinel — it
			// is offered in the selector but is never a registered def.
			errors.push( 'id ("none" is reserved)' );
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if ( typeof def.mount !== 'function' ) {
			errors.push( 'mount (not a function)' );
		}
	}

	throwOnRegistrationErrors( 'WindowLinkRenderer', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

/** Remove a renderer by id. */
export function unregisterWindowLinkRenderer( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

/**
 * Remove every renderer registered by a given owner (script handle).
 * Used by the server-sync module on plugin deactivation. Returns the
 * number removed.
 */
export function unregisterWindowLinkRenderersByOwner( owner: string ): number {
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
 * Current renderer list with the `os.window-links.renderers`
 * filter applied. Map values are copied so a filter callback can
 * mutate its input safely; a misbehaving filter that returns a
 * non-array falls back to the unfiltered list.
 */
export function listWindowLinkRenderers(): WindowLinkRendererDef[] {
	const copy = Array.from( registry.values() );
	const filtered = applyFilters< WindowLinkRendererDef[] >(
		HOOKS.WINDOW_LINK_RENDERERS,
		copy,
	);
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] `os.window-links.renderers` filter ' +
					'returned a non-array; falling back to registry list.',
			);
		}
		return copy;
	}
	return filtered;
}

/** Look up a renderer by id, post-filter. */
export function getWindowLinkRenderer(
	id: string,
): WindowLinkRendererDef | undefined {
	return listWindowLinkRenderers().find( ( r ) => r.id === id );
}

/**
 * Subscribe to registry changes — the OS Settings selector repaints
 * and the render host remounts when this fires. Returns an
 * unsubscribe.
 */
export function subscribeWindowLinkRenderers(
	cb: RegistryListener,
): () => void {
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
					'[openstation] window-link-renderer registry listener threw:',
					err,
				);
			}
		}
	}
}
