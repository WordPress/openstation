import * as registry from './registry';
import { launchGame } from './launch';
import { fetchPlaytime } from './rest';
import type { GameChallengeContext, GameRegistryEntry } from './types';

export interface GamesApi {

	register: ( entry: GameRegistryEntry ) => void;

	unregister: ( id: string ) => void;

	list: () => GameRegistryEntry[];

	get: ( id: string ) => GameRegistryEntry | undefined;

	subscribe: ( cb: () => void ) => () => void;

	launch: (
		id: string,
		opts?: { challenge?: GameChallengeContext },
	) => Promise< void >;

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
