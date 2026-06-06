/**
 * Desktop Mode — Unfocused-window effect registry.
 *
 * Owns the in-memory list of available unfocus effects and applies the
 * `desktop-mode.unfocus-effects` filter each time callers read it, so
 * plugins can register via `wp.desktop.registerUnfocusEffect()` and
 * also reach the raw filter for reorder / remove / conditional swap.
 *
 * The built-in `darken` is seeded here, through the very same
 * `register()` the public hook calls — the shipped effect dogfoods the
 * extensibility API rather than taking a private shortcut.
 *
 * Cross-bundle: the seed list AND the subscriber set live in a
 * `createSharedStore` record so the lazy OS-Settings-panel bundle and
 * the main shell bundle share a single registry (see AGENTS.md →
 * "Cross-bundle state"). Without it the panel's selector would iterate
 * its own empty copy and the engine would never hear about effects the
 * panel registered.
 *
 * @since 0.26.0
 */

import { applyFilters, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { throwOnRegistrationErrors } from '../registration-errors';
import { createSharedStore } from '../shared-store';
import type { UnfocusEffectDef } from './types';

type RegistryListener = () => void;

interface UnfocusEffectRegistryStore {
	registry: Map< string, UnfocusEffectDef >;
	listeners: Set< RegistryListener >;
}
const store = createSharedStore< UnfocusEffectRegistryStore >(
	'desktop-mode/unfocus-effect-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

/**
 * Valid effect id: lower-case alphanum, hyphen, underscore, slash —
 * same shape as the title-bar-button / command registries so plugins
 * can namespace `vendor/sub-id`. Empty strings rejected.
 *
 * @internal
 */
const UNFOCUS_EFFECT_ID = /^[a-z0-9_/-]+$/;

/**
 * Register (or replace) an unfocus effect. Re-registering the same id
 * replaces the previous entry — mirrors WordPress's `register_*`
 * semantics where the latest call wins.
 *
 * Throws a {@link RegistrationError} on validation failure so plugin
 * authors get a stack frame at registration time instead of a silently
 * missing selector entry.
 *
 * @param  def Effect definition.
 * @throws {RegistrationError} when `def` fails validation.
 */
export function registerUnfocusEffect( def: UnfocusEffectDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! UNFOCUS_EFFECT_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ UNFOCUS_EFFECT_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		} else if ( def.id.trim().toLowerCase() === 'none' ) {
			// `none` is the engine's reserved "no effect" sentinel — it
			// is offered in the selector but is never a registered def.
			errors.push( 'id ("none" is reserved)' );
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if (
			typeof def.className !== 'string' &&
			typeof def.apply !== 'function'
		) {
			errors.push(
				'className|apply (at least one must be provided — a CSS class to toggle or an apply callback)',
			);
		}
	}

	throwOnRegistrationErrors( 'UnfocusEffect', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

/** Remove an effect by id. */
export function unregisterUnfocusEffect( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

/**
 * Remove every effect registered by a given owner (script handle).
 * Used by the server-sync module on plugin deactivation. Returns the
 * number removed.
 */
export function unregisterUnfocusEffectsByOwner( owner: string ): number {
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
 * Current effect list with the `desktop-mode.unfocus-effects` filter
 * applied. The map values are copied so a filter callback can mutate
 * its input safely; a misbehaving filter that returns a non-array
 * falls back to the unfiltered list.
 */
export function listUnfocusEffects(): UnfocusEffectDef[] {
	const copy = Array.from( registry.values() );
	const filtered = applyFilters< UnfocusEffectDef[] >(
		HOOKS.UNFOCUS_EFFECTS,
		copy,
	);
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[desktop-mode] `desktop-mode.unfocus-effects` filter ' +
					'returned a non-array; falling back to registry list.',
			);
		}
		return copy;
	}
	return filtered;
}

/** Look up an effect by id, post-filter. */
export function getUnfocusEffect( id: string ): UnfocusEffectDef | undefined {
	return listUnfocusEffects().find( ( e ) => e.id === id );
}

/**
 * Subscribe to registry changes — the OS Settings selector repaints
 * and the engine recomputes when this fires. Returns an unsubscribe.
 */
export function subscribeUnfocusEffects( cb: RegistryListener ): () => void {
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
					'[desktop-mode] unfocus-effect registry listener threw:',
					err,
				);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Built-in effects
//
// Seeded through the public `register()` path so the shipped effect is
// indistinguishable from a plugin's. `register()` replaces by id, so a
// re-import (the panel bundle also evaluates this module) is idempotent.
// ---------------------------------------------------------------------------
registerUnfocusEffect( {
	id: 'darken',
	label: __( 'Darken' ),
	description: __( 'Dim unfocused windows so the focused one stands out.' ),
	className: 'desktop-mode-window--fx-darken',
} );
