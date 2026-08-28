/**
 * OS Settings — two quick changes must both survive.
 *
 * `_buildPayload()` diffs against `_lastConfirmedState`, which only
 * advances when a response comes back. Two changes far enough apart to
 * survive the 250 ms debounce but close enough that the first is still
 * in flight therefore both diffed against the same stale baseline, and
 * the server kept whichever response happened to land last.
 *
 * Measured on the live instance: `dockSize: large`, then
 * `windowRadius: sharp` 400 ms later. The lifecycle reported pending →
 * saving → pending → saved → saved and the local snapshot held both,
 * while user meta ended with `dockSize: large, windowRadius: round` —
 * the second change reported saved, and was not.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OsSettingsState } from '../../src/settings/types';

const SYNC_DEBOUNCE_MS = 250;

type FetchMock = ReturnType< typeof vi.fn >;
type StateModule = typeof import( '../../src/settings/state' );

let fetchMock: FetchMock;
let state_: StateModule;
/** Resolvers for each in-flight request, so a test can hold one open. */
let resolvers: Array< ( v: unknown ) => void >;

function sentSettings( call: number ): Partial< OsSettingsState > {
	const init = fetchMock.mock.calls[ call ][ 1 ] as { body: string };
	return ( JSON.parse( init.body ) as { settings: Partial< OsSettingsState > } )
		.settings;
}

function bootedSession(): OsSettingsState {
	const state = state_.structuredDefaults();
	state_.setLastConfirmedState( state );
	return state;
}

beforeEach( async () => {
	vi.resetModules();
	state_ = await import( '../../src/settings/state' );
	vi.useFakeTimers();
	resolvers = [];
	// Requests stay open until the test resolves them by hand — that
	// is the whole point: the second save is attempted while the first
	// is still in flight.
	fetchMock = vi.fn(
		() =>
			new Promise( ( resolve ) => {
				resolvers.push( resolve as ( v: unknown ) => void );
			} ),
	);
	( window as unknown as { wp?: unknown } ).wp = { os: { fetch: fetchMock } };
	( window as unknown as { openStationConfig?: unknown } ).openStationConfig = {
		osSettingsUrl: '/wp-json/desktop-mode/v1/os-settings',
		restNonce: 'nonce',
	};
} );

afterEach( () => {
	vi.useRealTimers();
	delete ( window as unknown as { wp?: unknown } ).wp;
	delete ( window as unknown as { openStationConfig?: unknown } )
		.openStationConfig;
	window.localStorage.clear();
} );

/** Settle the debounce without resolving any request. */
async function tick(): Promise< void > {
	await vi.advanceTimersByTimeAsync( SYNC_DEBOUNCE_MS + 10 );
}

/** Answer the nth open request with a 200. */
async function respond( n: number ): Promise< void > {
	resolvers[ n ]( { ok: true, status: 200 } as unknown as Response );
	await vi.advanceTimersByTimeAsync( 0 );
}

describe( 'OS Settings — overlapping saves', () => {
	test( 'a second change does not start while the first is in flight', async () => {
		const state = bootedSession();

		state.dockSize = 'large';
		state_.saveState( state );
		await tick();
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );

		// 400 ms later, first request still open.
		state.windowRadius = 'sharp';
		state_.saveState( state );
		await tick();

		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'the queued change is sent once the first save is confirmed', async () => {
		const state = bootedSession();

		state.dockSize = 'large';
		state_.saveState( state );
		await tick();

		state.windowRadius = 'sharp';
		state_.saveState( state );
		await tick();

		await respond( 0 );

		expect( fetchMock ).toHaveBeenCalledTimes( 2 );
		// Diffed against the baseline the first save confirmed, so it
		// carries only what changed since — and it cannot be lost to a
		// response ordering race, because it started after that
		// response.
		expect( sentSettings( 1 ) ).toEqual( { windowRadius: 'sharp' } );
	} );

	test( 'both values are on the wire across the two requests', async () => {
		const state = bootedSession();

		state.dockSize = 'large';
		state_.saveState( state );
		await tick();
		state.windowRadius = 'sharp';
		state_.saveState( state );
		await tick();
		await respond( 0 );

		expect( sentSettings( 0 ) ).toEqual( { dockSize: 'large' } );
		expect( sentSettings( 1 ) ).toEqual( { windowRadius: 'sharp' } );
	} );

	test( 'only the newest queued snapshot is sent, not every intermediate one', async () => {
		const state = bootedSession();

		state.dockSize = 'large';
		state_.saveState( state );
		await tick();

		state.windowRadius = 'sharp';
		state_.saveState( state );
		await tick();
		state.accent = 'wp-midnight';
		state_.saveState( state );
		await tick();

		await respond( 0 );

		// One follow-up carrying both, not two round trips.
		expect( fetchMock ).toHaveBeenCalledTimes( 2 );
		expect( sentSettings( 1 ) ).toEqual( {
			windowRadius: 'sharp',
			accent: 'wp-midnight',
		} );
	} );

	test( 'a failed save does not then post the snapshot it rolled back', async () => {
		const state = bootedSession();

		state.dockSize = 'large';
		state_.saveState( state );
		await tick();
		state.windowRadius = 'sharp';
		state_.saveState( state );
		await tick();

		// First save fails: state and localStorage are rolled back to
		// the confirmed baseline and listeners repaint. Sending the
		// queued snapshot now would post values the user has just been
		// shown as reverted.
		resolvers[ 0 ]( { ok: false, status: 500, statusText: 'Err' } as unknown as Response );
		await vi.advanceTimersByTimeAsync( 0 );

		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );
} );
