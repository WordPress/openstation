/**
 * Alphabet Soup — bundle entry.
 *
 * Lazy-loaded by the games framework the first time Alphabet Soup
 * launches. Publishes the game def on `window.desktopModeGames`;
 * the framework merges the server-registered metadata with the
 * `render` callback + window sizing declared here.
 *
 * @public
 * @since 0.9.8
 */

import { __ } from '../../i18n';
import type { GameDef } from '../types';
import { mountAlphabetSoup } from './game';

interface GamesGlobal {
	desktopModeGames?: Record< string, GameDef | undefined >;
}

const def: GameDef = {
	id: 'alphabet-soup',
	title: __( 'Alphabet Soup' ),
	icon: 'dashicons-carrot',
	scoreColumns: [
		{ key: 'score', label: __( 'Score' ), type: 'number' },
		{ key: 'mode', label: __( 'Mode' ), type: 'text' },
		{ key: 'size', label: __( 'Size' ), type: 'text' },
		{ key: 'words', label: __( 'Words' ), type: 'number' },
		{ key: 'wpm', label: __( 'WPM' ), type: 'number' },
		{ key: 'accuracy', label: __( 'Accuracy' ), type: 'number' },
		{ key: 'streak', label: __( 'Streak' ), type: 'number' },
		{ key: 'wave', label: __( 'Wave' ), type: 'number' },
		{ key: 'time', label: __( 'Time' ), type: 'time' },
	],
	window: {
		width: 860,
		height: 660,
		minWidth: 600,
		minHeight: 500,
	},
	render: ( ctx ) => mountAlphabetSoup( ctx ),
};

const globals = window as unknown as GamesGlobal;
globals.desktopModeGames = globals.desktopModeGames || {};
globals.desktopModeGames[ def.id ] = def;
