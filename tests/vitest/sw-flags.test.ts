/**
 * The two per-user PWA flags, and both halves of the contract that
 * moves them.
 *
 * The flags used to be baked into the served worker bytes. That made
 * the body differ between an anonymous and a logged-in request, so any
 * in-scope logged-out navigation served different bytes, the browser
 * installed them as an update, and `controllerchange` hard-reloaded
 * the desktop out from under the user. Identical bytes for everyone
 * now, per-user values over a message — which means the message IS the
 * mechanism, and a drift between sender and receiver silently leaves
 * every worker on its defaults with nothing to notice.
 *
 * So both sides are pinned here: `applyFlagMessage` (what the worker
 * does with a message) and the two `notify*` senders (what the shell
 * actually posts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFlagMessage, type SwFlags } from '../../src/pwa/sw-flags';
import {
	notifyServiceWorkerConfig,
	notifyServiceWorkerPrewarm,
} from '../../src/pwa/sw-register';

/** Both flags off — how every worker starts. */
const OFF: SwFlags = { windowPrewarm: false, adminAssetCache: false };
/** Both flags on. */
const ON: SwFlags = { windowPrewarm: true, adminAssetCache: true };

describe( 'applyFlagMessage — os-sw-set-prewarm', () => {
	it( 'turns prewarming on and holds what it has', () => {
		expect( applyFlagMessage( { type: 'os-sw-set-prewarm', enabled: true }, OFF ) ).toEqual( {
			flags: { windowPrewarm: true, adminAssetCache: false },
			clearSpeculative: false,
			dropSessionCache: false,
		} );
	} );

	it( 'turning it off drops the in-memory AND on-disk copies', () => {
		// The one thing the toggle exists to prevent is rendered pages
		// outliving the opt-out.
		expect( applyFlagMessage( { type: 'os-sw-set-prewarm', enabled: false }, ON ) ).toEqual( {
			flags: { windowPrewarm: false, adminAssetCache: true },
			clearSpeculative: true,
			dropSessionCache: true,
		} );
	} );

	it( 'treats a non-boolean `enabled` as off rather than as absent', () => {
		// `enabled === true` is the whole test in the worker; anything
		// else is a malformed message and off is the safe reading.
		const update = applyFlagMessage( { type: 'os-sw-set-prewarm', enabled: 'yes' }, ON );
		expect( update?.flags.windowPrewarm ).toBe( false );
		expect( update?.dropSessionCache ).toBe( true );
	} );

	it( 'never touches the admin-asset cache flag', () => {
		expect(
			applyFlagMessage( { type: 'os-sw-set-prewarm', enabled: true }, ON )?.flags
				.adminAssetCache,
		).toBe( true );
		expect(
			applyFlagMessage( { type: 'os-sw-set-prewarm', enabled: true }, OFF )?.flags
				.adminAssetCache,
		).toBe( false );
	} );
} );

describe( 'applyFlagMessage — os-sw-config', () => {
	it( 'applies both flags', () => {
		expect(
			applyFlagMessage(
				{ type: 'os-sw-config', adminAssetCache: true, windowPrewarm: true },
				OFF,
			),
		).toEqual( {
			flags: ON,
			clearSpeculative: false,
			dropSessionCache: false,
		} );
	} );

	it( 'clears speculations but keeps the session cache when prewarm is off', () => {
		// The asymmetry with the toggle is deliberate: this is a state
		// sync at boot, not a user action, and the session cache is
		// what a restore reads on the NEXT boot.
		expect(
			applyFlagMessage(
				{ type: 'os-sw-config', adminAssetCache: true, windowPrewarm: false },
				ON,
			),
		).toEqual( {
			flags: { windowPrewarm: false, adminAssetCache: true },
			clearSpeculative: true,
			dropSessionCache: false,
		} );
	} );

	it( 'leaves an omitted field alone rather than resetting it', () => {
		// A partial message must not read as "the other flag is false",
		// or a sender that learns one flag would silently disable the
		// other.
		const update = applyFlagMessage( { type: 'os-sw-config', windowPrewarm: false }, ON );
		expect( update?.flags.adminAssetCache ).toBe( true );

		const other = applyFlagMessage( { type: 'os-sw-config', adminAssetCache: false }, ON );
		expect( other?.flags.windowPrewarm ).toBe( true );
		expect( other?.clearSpeculative ).toBe( false );
	} );

	it( 'ignores non-boolean fields', () => {
		expect(
			applyFlagMessage(
				{ type: 'os-sw-config', adminAssetCache: 1, windowPrewarm: 'true' },
				OFF,
			)?.flags,
		).toEqual( OFF );
	} );
} );

describe( 'applyFlagMessage — everything else', () => {
	it( 'returns null so the worker keeps handling its other messages', () => {
		for ( const data of [
			undefined,
			null,
			'os-sw-config',
			42,
			{},
			{ type: 'os-remember-session', urls: [ '/wp-admin/' ] },
			{ type: 'os-speculate-doc', url: '/wp-admin/edit.php' },
		] ) {
			expect( applyFlagMessage( data, ON ) ).toBeNull();
		}
	} );

	it( 'does not mutate the flags it was given', () => {
		const current: SwFlags = { windowPrewarm: true, adminAssetCache: true };
		applyFlagMessage( { type: 'os-sw-set-prewarm', enabled: false }, current );
		applyFlagMessage( { type: 'os-sw-config', windowPrewarm: false }, current );
		expect( current ).toEqual( ON );
	} );
} );

describe( 'the shell side of the contract', () => {
	let posted: unknown[];

	beforeEach( () => {
		posted = [];
		vi.stubGlobal( 'navigator', {
			serviceWorker: {
				controller: {
					postMessage: ( message: unknown ) => {
						posted.push( message );
					},
				},
			},
		} );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'posts a message the worker recognises as a prewarm toggle', () => {
		notifyServiceWorkerPrewarm( true );

		expect( posted ).toEqual( [ { type: 'os-sw-set-prewarm', enabled: true } ] );
		expect( applyFlagMessage( posted[ 0 ], OFF )?.flags.windowPrewarm ).toBe( true );
	} );

	it( 'posts a config message the worker reads as both flags', () => {
		notifyServiceWorkerConfig( { adminAssetCache: true, windowPrewarm: true } );

		expect( posted ).toEqual( [
			{ type: 'os-sw-config', adminAssetCache: true, windowPrewarm: true },
		] );
		expect( applyFlagMessage( posted[ 0 ], OFF )?.flags ).toEqual( ON );
	} );

	it( 'is a no-op with no controller rather than throwing at boot', () => {
		vi.stubGlobal( 'navigator', { serviceWorker: { controller: null } } );
		expect( () => notifyServiceWorkerPrewarm( true ) ).not.toThrow();
		expect( () =>
			notifyServiceWorkerConfig( { adminAssetCache: true, windowPrewarm: true } ),
		).not.toThrow();

		vi.stubGlobal( 'navigator', {} );
		expect( () => notifyServiceWorkerPrewarm( false ) ).not.toThrow();
		expect( () =>
			notifyServiceWorkerConfig( { adminAssetCache: false, windowPrewarm: false } ),
		).not.toThrow();
	} );
} );
