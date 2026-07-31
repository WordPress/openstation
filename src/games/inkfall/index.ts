/**
 * Inkfall — bundle entry.
 *
 * Lazy-loaded by the games framework the first time Inkfall
 * launches. Publishes the game def on `window.desktopModeGames`
 * (the games analogue of `window.desktopModeWallpapers`); the
 * framework merges the server-registered metadata with the `render`
 * callback + window sizing declared here.
 *
 * @public
 */

import { __ } from '../../i18n';
import type { GameDef } from '../types';
import { mountInkfall } from './game';

interface GamesGlobal {
	desktopModeGames?: Record< string, GameDef | undefined >;
}

const def: GameDef = {
	id: 'inkfall',
	title: __( 'Inkfall' ),
	icon: 'dashicons-edit',
	scoreColumns: [
		{ key: 'score', label: __( 'Score' ), type: 'number' },
		{ key: 'mode', label: __( 'Difficulty' ), type: 'text' },
		{ key: 'words', label: __( 'Words' ), type: 'number' },
		{ key: 'wpm', label: __( 'WPM' ), type: 'number' },
		{ key: 'accuracy', label: __( 'Accuracy' ), type: 'number' },
		{ key: 'time', label: __( 'Time' ), type: 'time' },
		{ key: 'level', label: __( 'Level' ), type: 'number' },
	],
	window: {
		width: 820,
		height: 620,
		minWidth: 520,
		minHeight: 420,
	},
	render: ( ctx ) => mountInkfall( ctx ),
};

const globals = window as unknown as GamesGlobal;
globals.desktopModeGames = globals.desktopModeGames || {};
globals.desktopModeGames[ def.id ] = def;
