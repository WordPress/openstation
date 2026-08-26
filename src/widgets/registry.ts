/**
 * OpenStation — Widget registry.
 *
 * Mirrors the wallpaper registry: in-memory seed list, `os.widgets`
 * filter applied on every read, register/unregister API, defensive
 * validation of plugin-supplied defs.
 *
 * Intentionally cache-free — the filter chain is shallow and
 * `all()` is called at most when the picker opens or the layer
 * rehydrates, never per-frame.
 */

import { applyFilters, HOOKS } from '../hooks';
import {
	collectRegistrationErrors,
	throwOnRegistrationErrors,
} from '../registration-errors';
import type { WidgetDef } from './types';

/** Seed list — mutated by `register`, reset only in tests. */
const seed: WidgetDef[] = [];

/**
 * Append (or replace) a widget definition. Late registrations win on
 * id conflict, matching WP's `register_*` semantics and letting
 * plugins override a built-in if they really want to.
 */
export function register( def: WidgetDef ): void {
	throwOnRegistrationErrors(
		'Widget',
		collectRegistrationErrors< WidgetDef >( def, WIDGET_CHECKS ),
		def,
	);
	const idx = seed.findIndex( ( w ) => w.id === def.id );
	if ( idx >= 0 ) {
		seed[ idx ] = def;
	} else {
		seed.push( def );
	}
}

/** Remove a widget definition by id. */
export function unregister( id: string ): void {
	const idx = seed.findIndex( ( w ) => w.id === id );
	if ( idx >= 0 ) {
		seed.splice( idx, 1 );
	}
}

/**
 * Produce the current widget list with the `os.widgets`
 * filter applied. Copies the seed before passing so filter callbacks
 * can't mutate the registry by reference.
 */
export function all(): WidgetDef[] {
	const copy = seed.slice();
	const filtered = applyFilters<WidgetDef[]>( HOOKS.WIDGETS, copy );
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] `os.widgets` filter returned ' +
					'a non-array; falling back to seed list.',
			);
		}
		return copy;
	}
	return filtered.filter( isValidDef );
}

/** Look up a widget by id, post-filter. */
export function get( id: string ): WidgetDef | undefined {
	return all().find( ( w ) => w.id === id );
}

/**
 * Minimum-viable validation — enforces presence of the fields the
 * layer and picker actually touch. Deeper correctness is the plugin
 * author's responsibility past this boundary.
 */
const WIDGET_CHECKS = [
	{
		field: 'id',
		message: 'missing or not a non-empty string',
		valid: ( d: Partial< WidgetDef > ) =>
			typeof d.id === 'string' && d.id !== '',
	},
	{
		field: 'label',
		message: 'missing or not a non-empty string',
		valid: ( d: Partial< WidgetDef > ) =>
			typeof d.label === 'string' && d.label !== '',
	},
	{
		field: 'description',
		message: 'not a string',
		valid: ( d: Partial< WidgetDef > ) => typeof d.description === 'string',
	},
	{
		field: 'icon',
		message: 'missing or not a non-empty string',
		valid: ( d: Partial< WidgetDef > ) =>
			typeof d.icon === 'string' && d.icon !== '',
	},
	{
		field: 'mount',
		message: 'not a function',
		valid: ( d: Partial< WidgetDef > ) => typeof d.mount === 'function',
	},
];

function isValidDef( def: unknown ): def is WidgetDef {
	return collectRegistrationErrors< WidgetDef >( def, WIDGET_CHECKS ).length === 0;
}
