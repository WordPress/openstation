/**
 * A game must arrive styled however it was launched.
 *
 * The Games hub carries the three sheets as companion styles, which is
 * right when the hub is what opened. It is not the only way in: the
 * challenge toast's "Accept & Play" is built to work with the hub
 * closed, solo mode boots straight to `?openstation_solo=os-game-<id>`,
 * and `wp.os.games.launch()` is documented for plugins. Each of those
 * runs `launchGame()` — which is compiled into the SHELL bundle as well
 * as the games one — with no hub window in the tab, and the HUD
 * rendered as raw text until the user happened to open the hub.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as deferredStyles from '../../src/deferred-styles';
import { ensureGameStyles } from '../../src/games/launch';

type Carrier = { openStationConfig?: { gameStyleHandles?: string[] } };

const w = window as unknown as Carrier;

describe( 'ensureGameStyles', () => {
	let ensured: string[];

	beforeEach( () => {
		ensured = [];
		vi.spyOn( deferredStyles, 'ensureDeferredStyle' ).mockImplementation(
			( handle: string ) => {
				ensured.push( handle );
			},
		);
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete w.openStationConfig;
	} );

	it( 'injects every configured game stylesheet', () => {
		w.openStationConfig = {
			gameStyleHandles: [
				'desktop-mode-games',
				'os-game-inkfall',
				'os-game-alphabet-soup',
			],
		};

		ensureGameStyles();

		expect( ensured ).toEqual( [
			'desktop-mode-games',
			'os-game-inkfall',
			'os-game-alphabet-soup',
		] );
	} );

	it( 'is a no-op when the games module is disabled', () => {
		// `openstation_games_load()` bails when the framework is off, so
		// the handle list is legitimately empty and there is nothing to
		// inject.
		w.openStationConfig = { gameStyleHandles: [] };

		ensureGameStyles();

		expect( ensured ).toEqual( [] );
	} );

	it( 'does not throw when the config key is missing entirely', () => {
		w.openStationConfig = {};

		expect( () => ensureGameStyles() ).not.toThrow();
		expect( ensured ).toEqual( [] );
	} );
} );
