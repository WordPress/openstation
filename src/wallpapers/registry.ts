import { applyFilters, HOOKS } from '../hooks';
import {
	collectRegistrationErrors,
	throwOnRegistrationErrors,
} from '../registration-errors';
import { createSharedStore } from '../shared-store';
import type { WallpaperDef } from './types';

type RegistryListener = () => void;

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

export function register( def: WallpaperDef ): void {
	throwOnRegistrationErrors(
		'Wallpaper',
		collectRegistrationErrors< WallpaperDef >( def, WALLPAPER_CHECKS ),
		def,
	);

	const idx = seed.findIndex( ( w ) => w.id === def.id );
	if ( idx >= 0 ) {
		seed[ idx ] = def;
	} else {
		seed.push( def );
	}
	notify();
}

export function unregister( id: string ): void {
	const idx = seed.findIndex( ( w ) => w.id === id );
	if ( idx >= 0 ) {
		seed.splice( idx, 1 );
		notify();
	}
}

export function subscribe( cb: RegistryListener ): () => void {
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
					'[openstation] wallpaper registry listener threw:',
					err,
				);
			}
		}
	}
}

export function all(): WallpaperDef[] {
	const copy = seed.slice();
	const filtered = applyFilters<WallpaperDef[]>( HOOKS.WALLPAPERS, copy );

	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] `os.wallpapers` filter ' +
					'returned a non-array; falling back to seed list.',
			);
		}
		return copy;
	}

	return filtered.filter( isValidDef );
}

export function get( id: string ): WallpaperDef | undefined {
	return all().find( ( w ) => w.id === id );
}

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

			return true;
		},
	},
];

function isValidDef( def: unknown ): def is WallpaperDef {
	return (
		collectRegistrationErrors< WallpaperDef >( def, WALLPAPER_CHECKS ).length === 0
	);
}
