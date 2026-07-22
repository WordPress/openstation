/**
 * Desktop Mode — public `wp.desktop.games` surface.
 *
 * Thin facade over the shared-store registry + launcher. Assembled
 * here (rather than inline in `src/api/facade.ts`) so the games
 * bundle and any tests can import the exact same object shape.
 *
 * @since 0.9.6
 */

import * as registry from './registry';
import { launchGame } from './launch';
import { fetchPlaytime } from './rest';
import type { GameChallengeContext, GameRegistryEntry } from './types';

export interface GamesApi {
	/** Register (or replace) a game in the shared registry. */
	register: ( entry: GameRegistryEntry ) => void;
	/** Remove a game by id. */
	unregister: ( id: string ) => void;
	/** The current game list, `desktop-mode.games` filter applied. */
	list: () => GameRegistryEntry[];
	/** Look up one game by id, post-filter. */
	get: ( id: string ) => GameRegistryEntry | undefined;
	/** Subscribe to registry changes. Returns an unsubscribe. */
	subscribe: ( cb: () => void ) => () => void;
	/** Open a game (lazily loading its bundle on first launch). */
	launch: (
		id: string,
		opts?: { challenge?: GameChallengeContext },
	) => Promise< void >;
	/**
	 * The current user's accumulated play time, as a
	 * `game id => total seconds` map. Tracked automatically by the
	 * launcher (the clock pauses while the game window is minimized).
	 */
	getPlaytime: () => Promise< Record< string, number > >;
}

export const gamesApi: GamesApi = {
	register: registry.register,
	unregister: registry.unregister,
	list: registry.all,
	get: registry.get,
	subscribe: registry.subscribe,
	launch: launchGame,
	getPlaytime: () => fetchPlaytime().then( ( res ) => res.playtime ),
};
