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
