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

/**
 * The refactor itself, proved rather than inspected.
 *
 * `applyFlagMessage()` was lifted out of two inline branches in the
 * worker's message listener. A refactor of the service worker is not
 * something to take on trust — a wrong decision here does not throw,
 * it silently leaves prewarming on for someone who turned it off, or
 * strands a cache nobody clears.
 *
 * `legacyApply` below is those two branches transcribed verbatim from
 * before the extraction. Every reachable input is run through both and
 * the four observable outcomes compared: the two flags, whether the
 * speculation store is cleared, whether the session cache is deleted,
 * and whether the listener returned early (which decides if the
 * message reaches the handlers underneath).
 */
interface LegacyOutcome {
	flags: SwFlags;
	clearSpeculative: boolean;
	dropSessionCache: boolean;
	handled: boolean;
}

function legacyApply( data: unknown, current: SwFlags ): LegacyOutcome {
	let windowPrewarmEnabled = current.windowPrewarm;
	let adminAssetCacheEnabled = current.adminAssetCache;
	let clearSpeculative = false;
	let dropSessionCache = false;
	const d = data as
		| { type?: string; enabled?: unknown; adminAssetCache?: unknown; windowPrewarm?: unknown }
		| undefined;

	if ( d && d.type === 'os-sw-set-prewarm' ) {
		windowPrewarmEnabled = ( d as { enabled?: unknown } ).enabled === true;
		if ( ! windowPrewarmEnabled ) {
			clearSpeculative = true;
			dropSessionCache = true;
		}
		return {
			flags: {
				windowPrewarm: windowPrewarmEnabled,
				adminAssetCache: adminAssetCacheEnabled,
			},
			clearSpeculative,
			dropSessionCache,
			handled: true,
		};
	}

	if ( d && d.type === 'os-sw-config' ) {
		const cfg = d as { adminAssetCache?: unknown; windowPrewarm?: unknown };
		if ( typeof cfg.adminAssetCache === 'boolean' ) {
			adminAssetCacheEnabled = cfg.adminAssetCache;
		}
		if ( typeof cfg.windowPrewarm === 'boolean' ) {
			windowPrewarmEnabled = cfg.windowPrewarm;
			if ( ! windowPrewarmEnabled ) {
				clearSpeculative = true;
			}
		}
		return {
			flags: {
				windowPrewarm: windowPrewarmEnabled,
				adminAssetCache: adminAssetCacheEnabled,
			},
			clearSpeculative,
			dropSessionCache,
			handled: true,
		};
	}

	return {
		flags: { windowPrewarm: windowPrewarmEnabled, adminAssetCache: adminAssetCacheEnabled },
		clearSpeculative,
		dropSessionCache,
		handled: false,
	};
}

describe( 'applyFlagMessage is equivalent to the branches it replaced', () => {
	// Every flag state the worker can be in.
	const STATES: SwFlags[] = [
		{ windowPrewarm: false, adminAssetCache: false },
		{ windowPrewarm: true, adminAssetCache: false },
		{ windowPrewarm: false, adminAssetCache: true },
		{ windowPrewarm: true, adminAssetCache: true },
	];

	// Values a field can carry once structured-cloned through
	// postMessage, boolean and not.
	const VALUES: unknown[] = [ true, false, 'true', 'yes', 1, 0, null, undefined, {}, [] ];

	function messages(): unknown[] {
		const out: unknown[] = [
			undefined,
			null,
			'os-sw-config',
			42,
			true,
			{},
			[],
			{ type: undefined },
			{ type: 'os-remember-session', urls: [ '/wp-admin/' ] },
			{ type: 'os-speculate-doc', url: '/wp-admin/edit.php' },
			{ type: 'os-sw-set-prewarm' },
			{ type: 'os-sw-config' },
		];
		for ( const value of VALUES ) {
			out.push( { type: 'os-sw-set-prewarm', enabled: value } );
			// The config message carries both fields; cross them so a
			// boolean in one position is checked against every value in
			// the other.
			for ( const other of VALUES ) {
				out.push( {
					type: 'os-sw-config',
					adminAssetCache: value,
					windowPrewarm: other,
				} );
			}
			out.push( { type: 'os-sw-config', adminAssetCache: value } );
			out.push( { type: 'os-sw-config', windowPrewarm: value } );
		}
		return out;
	}

	it( 'agrees on every reachable input', () => {
		const inputs = messages();
		// Guard the guard: a shrunken matrix would pass vacuously.
		expect( inputs.length ).toBeGreaterThan( 130 );

		let compared = 0;
		for ( const state of STATES ) {
			for ( const data of inputs ) {
				const legacy = legacyApply( data, state );
				const update = applyFlagMessage( data, state );

				const actual: LegacyOutcome = update
					? { ...update, handled: true }
					: {
							flags: state,
							clearSpeculative: false,
							dropSessionCache: false,
							handled: false,
					  };

				expect(
					actual,
					`diverged on ${ JSON.stringify( data ) } from ${ JSON.stringify( state ) }`,
				).toEqual( legacy );
				compared++;
			}
		}
		expect( compared ).toBe( STATES.length * inputs.length );
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
