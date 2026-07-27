/**
 * Desktop Mode — Window transition effect registry.
 *
 * Same shape as the screen-effect registry next door: a shared store so
 * the lazy `stage` bundle, the lazy OS-Settings panel and the main shell
 * bundle all see one list, plus a filter applied on every read.
 *
 * @since 0.9.8
 */

import { applyFilters, HOOKS } from '../../hooks';
import { throwOnRegistrationErrors } from '../../registration-errors';
import { createSharedStore } from '../../shared-store';
import {
	WINDOW_EFFECT_NONE,
	WINDOW_TRANSITIONS,
	type WindowEffectDef,
	type WindowTransition,
} from './types';

type RegistryListener = () => void;

interface WindowEffectRegistryStore {
	registry: Map< string, WindowEffectDef >;
	listeners: Set< RegistryListener >;
}
const store = createSharedStore< WindowEffectRegistryStore >(
	'desktop-mode/window-effect-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const WINDOW_EFFECT_ID = /^[a-z0-9_/-]+$/;

/**
 * Register (or replace) a window transition effect.
 *
 * @param  def Effect definition.
 * @throws {RegistrationError} when `def` fails validation.
 */
export function registerWindowEffect( def: WindowEffectDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_EFFECT_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push( `id (must match ${ WINDOW_EFFECT_ID })` );
		} else if ( def.id.trim().toLowerCase() === WINDOW_EFFECT_NONE ) {
			errors.push( 'id ("none" is reserved for the no-effect option)' );
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if ( typeof def.run !== 'function' ) {
			errors.push( 'run (missing)' );
		}
		if ( ! Array.isArray( def.transitions ) || def.transitions.length === 0 ) {
			errors.push(
				'transitions (must list at least one lifecycle transition)',
			);
		} else {
			const unknown = def.transitions.filter(
				( t ) => ! WINDOW_TRANSITIONS.includes( t ),
			);
			if ( unknown.length > 0 ) {
				errors.push(
					`transitions (unknown: ${ unknown.join( ', ' ) }; valid: ${ WINDOW_TRANSITIONS.join( ', ' ) })`,
				);
			}
		}
	}

	throwOnRegistrationErrors( 'WindowEffect', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

/** Remove an effect by id. */
export function unregisterWindowEffect( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

/**
 * Remove every effect registered by a given owner (script handle).
 *
 * @param owner Script handle the effects were registered under.
 */
export function unregisterWindowEffectsByOwner( owner: string ): number {
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

/** Current effect list, with the `desktop-mode.window-effects` filter applied. */
export function listWindowEffects(): WindowEffectDef[] {
	const copy = Array.from( registry.values() );
	const filtered = applyFilters< WindowEffectDef[] >(
		HOOKS.WINDOW_EFFECTS,
		copy,
	);
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[desktop-mode] `desktop-mode.window-effects` filter returned a non-array; falling back to the registry list.',
			);
		}
		return copy;
	}
	return filtered;
}

/**
 * Effects that can play a given transition — what the settings picker
 * offers for each row.
 *
 * @param transition Lifecycle transition to filter by.
 */
export function listWindowEffectsFor(
	transition: WindowTransition,
): WindowEffectDef[] {
	return listWindowEffects().filter( ( def ) =>
		def.transitions.includes( transition ),
	);
}

/** Look up an effect by id, post-filter. */
export function getWindowEffect( id: string ): WindowEffectDef | undefined {
	return listWindowEffects().find( ( e ) => e.id === id );
}

/** Subscribe to registry changes. Returns an unsubscribe. */
export function subscribeWindowEffects( cb: RegistryListener ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

function notify(): void {
	for ( const cb of Array.from( listeners ) ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode] window-effect registry listener threw:',
					err,
				);
			}
		}
	}
}
