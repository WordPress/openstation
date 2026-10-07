import { applyFilters, HOOKS } from '../hooks';
import {
	collectRegistrationErrors,
	throwOnRegistrationErrors,
} from '../registration-errors';
import type { WidgetDef } from './types';

const seed: WidgetDef[] = [];

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

export function unregister( id: string ): void {
	const idx = seed.findIndex( ( w ) => w.id === id );
	if ( idx >= 0 ) {
		seed.splice( idx, 1 );
	}
}

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

export function get( id: string ): WidgetDef | undefined {
	return all().find( ( w ) => w.id === id );
}

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
