import { applyFilters, HOOKS } from '../hooks';
import {
	collectRegistrationErrors,
	throwOnRegistrationErrors,
} from '../registration-errors';
import { createSharedStore } from '../shared-store';
import type { GameRegistryEntry } from './types';

type RegistryListener = () => void;

interface GamesRegistryStore {
	seed: GameRegistryEntry[];
	listeners: Set< RegistryListener >;
}

const store = createSharedStore< GamesRegistryStore >(
	'desktop-mode/games-registry',
	() => ( {
		seed: [],
		listeners: new Set< RegistryListener >(),
	} ),
);
const seed = store.state.seed;
const listeners = store.state.listeners;

export function register( entry: GameRegistryEntry ): void {
	throwOnRegistrationErrors(
		'Game',
		collectRegistrationErrors< GameRegistryEntry >( entry, GAME_CHECKS ),
		entry,
	);
	const idx = seed.findIndex( ( g ) => g.id === entry.id );
	if ( idx >= 0 ) {
		seed[ idx ] = entry;
	} else {
		seed.push( entry );
	}
	notify();
}

export function unregister( id: string ): void {
	const idx = seed.findIndex( ( g ) => g.id === id );
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
					'[openstation] games registry listener threw:',
					err,
				);
			}
		}
	}
}

export function all(): GameRegistryEntry[] {
	const copy = seed.slice();
	const filtered = applyFilters< GameRegistryEntry[] >( HOOKS.GAMES, copy );
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] `os.games` filter returned a ' +
					'non-array; falling back to seed list.',
			);
		}
		return copy;
	}
	return filtered.filter( isValidEntry );
}

export function get( id: string ): GameRegistryEntry | undefined {
	return all().find( ( g ) => g.id === id );
}

const GAME_CHECKS = [
	{
		field: 'id',
		message: 'missing or not a non-empty string',
		valid: ( g: Partial< GameRegistryEntry > ) =>
			typeof g.id === 'string' && g.id !== '',
	},
	{
		field: 'title',
		message: 'missing or not a non-empty string',
		valid: ( g: Partial< GameRegistryEntry > ) =>
			typeof g.title === 'string' && g.title !== '',
	},
	{
		field: 'scoreColumns',
		message: 'must be an array',
		valid: ( g: Partial< GameRegistryEntry > ) =>
			Array.isArray( g.scoreColumns ),
	},
	{
		field: 'render/scriptUrl',
		message: 'needs a `render` callback or a `scriptUrl` to lazily load one',
		valid: ( g: Partial< GameRegistryEntry > ) =>
			typeof g.render === 'function' ||
			( typeof g.scriptUrl === 'string' && g.scriptUrl !== '' ),
	},
];

function isValidEntry( entry: unknown ): entry is GameRegistryEntry {
	return (
		collectRegistrationErrors< GameRegistryEntry >( entry, GAME_CHECKS )
			.length === 0
	);
}
