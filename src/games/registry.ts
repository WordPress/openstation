/**
 * OpenStation — Games registry.
 *
 * Owns the in-memory list of registered games and applies the
 * `os.games` filter on every read, mirroring the wallpaper
 * registry it is modeled on.
 *
 * Cross-bundle by construction: the Games hub window ships in its
 * own Vite IIFE bundle (`games[.min].js`) while server-sync runs in
 * the main shell bundle, so the seed list AND the subscriber set
 * live in a `createSharedStore` record — both bundles mutate the
 * same arrays. See AGENTS.md ("Cross-bundle state") for why a plain
 * module-level array would silently split into per-bundle copies.
 */

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

/**
 * Register (or replace) a game entry. Stubs — entries without a
 * `render` callback but with a `scriptUrl` to load one from — are
 * legal; the launcher upgrades them on first launch.
 *
 * Late registrations win for a repeated id, matching WP's
 * `register_*` semantics — this is also the stub→full-def upgrade
 * path.
 */
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

/** Remove a game by id. */
export function unregister( id: string ): void {
	const idx = seed.findIndex( ( g ) => g.id === id );
	if ( idx >= 0 ) {
		seed.splice( idx, 1 );
		notify();
	}
}

/**
 * Subscribe to registry changes (register/unregister/stub upgrade).
 * Returns an unsubscribe function.
 */
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

/**
 * The current game list with the `os.games` filter
 * applied. The seed array is copied so filter callbacks can safely
 * mutate their input.
 */
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

/** Look up a game by id, post-filter. */
export function get( id: string ): GameRegistryEntry | undefined {
	return all().find( ( g ) => g.id === id );
}

/**
 * Minimum-viable validation. A registry entry needs the metadata
 * the launcher/scoreboard paint from, plus at least one way to
 * eventually render: a `render` callback or a `scriptUrl` to load
 * one from.
 */
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
