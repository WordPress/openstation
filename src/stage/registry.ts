/**
 * Desktop Mode — Screen-effect registry.
 *
 * Owns the in-memory list of available screen effects and applies the
 * `desktop-mode.screen-effects` filter each time callers read it, so
 * plugins can register via `wp.desktop.stage.registerScreenEffect()`
 * and also reach the raw filter for reorder / remove / conditional swap.
 *
 * The three built-ins (scanlines, CRT, pixel art) are seeded from the
 * lazy `stage` bundle through this very same public `register()` — the
 * shipped effects dogfood the extensibility API rather than taking a
 * private shortcut.
 *
 * Cross-bundle: the registry AND the subscriber set live in a
 * `createSharedStore` record, because three separate IIFE bundles touch
 * it — the lazy `stage` bundle registers the built-ins, the lazy
 * OS-Settings-panel bundle lists them to build sliders, and the main
 * shell bundle resolves the user's chain. Without the shared store each
 * would iterate its own empty copy (see AGENTS.md → "Cross-bundle
 * state").
 *
 * @since 0.9.8
 */

import { applyFilters, HOOKS } from '../hooks';
import { throwOnRegistrationErrors } from '../registration-errors';
import { createSharedStore } from '../shared-store';
import type { ScreenEffectDef } from './types';

type RegistryListener = () => void;

interface ScreenEffectRegistryStore {
	registry: Map< string, ScreenEffectDef >;
	listeners: Set< RegistryListener >;
}
const store = createSharedStore< ScreenEffectRegistryStore >(
	'desktop-mode/screen-effect-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

/**
 * Valid effect id: lower-case alphanum, hyphen, underscore, slash —
 * same shape as the unfocus-effect / command / title-bar-button
 * registries so plugins can namespace `vendor/sub-id`.
 *
 * @internal
 */
const SCREEN_EFFECT_ID = /^[a-z0-9_/-]+$/;

/**
 * Valid parameter key: the settings panel turns these into slider
 * labels and they round-trip through user meta, so keep them boring.
 *
 * @internal
 */
const SCREEN_EFFECT_PARAM_KEY = /^[a-zA-Z0-9_]+$/;

/**
 * Register (or replace) a screen effect. Re-registering the same id
 * replaces the previous entry — mirrors WordPress's `register_*`
 * semantics where the latest call wins.
 *
 * Throws a {@link RegistrationError} on validation failure so plugin
 * authors get a stack frame at registration time instead of an effect
 * that silently never appears in OS Settings.
 *
 * @param  def Effect definition.
 * @throws {RegistrationError} when `def` fails validation.
 */
export function registerScreenEffect( def: ScreenEffectDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! SCREEN_EFFECT_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ SCREEN_EFFECT_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if ( typeof def.createFilter !== 'function' ) {
			errors.push( 'createFilter (missing — must return a Pixi Filter)' );
		}
		if ( undefined !== def.params ) {
			if ( ! Array.isArray( def.params ) ) {
				errors.push( 'params (must be an array)' );
			} else {
				def.params.forEach( ( param, i ) => {
					if (
						! param ||
						typeof param.key !== 'string' ||
						! SCREEN_EFFECT_PARAM_KEY.test( param.key )
					) {
						errors.push(
							`params[${ i }].key (must match ${ SCREEN_EFFECT_PARAM_KEY })`,
						);
						return;
					}
					if (
						! Number.isFinite( param.min ) ||
						! Number.isFinite( param.max ) ||
						param.min > param.max
					) {
						errors.push(
							`params[${ i }].min/max (must be finite numbers with min <= max)`,
						);
					}
					if ( ! Number.isFinite( param.default ) ) {
						errors.push(
							`params[${ i }].default (must be a finite number)`,
						);
					}
				} );
			}
		}
	}

	throwOnRegistrationErrors( 'ScreenEffect', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

/** Remove an effect by id. */
export function unregisterScreenEffect( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

/**
 * Remove every effect registered by a given owner (script handle).
 * Used by the server-sync module on plugin deactivation. Returns the
 * number removed.
 *
 * @param owner Script handle the effects were registered under.
 */
export function unregisterScreenEffectsByOwner( owner: string ): number {
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
 * Current effect list with the `desktop-mode.screen-effects` filter
 * applied. The map values are copied so a filter callback can mutate
 * its input safely; a misbehaving filter that returns a non-array falls
 * back to the unfiltered list.
 */
export function listScreenEffects(): ScreenEffectDef[] {
	const copy = Array.from( registry.values() );
	const filtered = applyFilters< ScreenEffectDef[] >(
		HOOKS.SCREEN_EFFECTS,
		copy,
	);
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[desktop-mode] `desktop-mode.screen-effects` filter ' +
					'returned a non-array; falling back to registry list.',
			);
		}
		return copy;
	}
	return filtered;
}

/** Look up an effect by id, post-filter. */
export function getScreenEffect( id: string ): ScreenEffectDef | undefined {
	return listScreenEffects().find( ( e ) => e.id === id );
}

/**
 * Subscribe to registry changes — the OS Settings panel repaints its
 * effect list and the stage rebuilds its filter chain when this fires.
 * Returns an unsubscribe.
 *
 * @param cb Called after every register / unregister.
 */
export function subscribeScreenEffects( cb: RegistryListener ): () => void {
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
					'[desktop-mode] screen-effect registry listener threw:',
					err,
				);
			}
		}
	}
}
