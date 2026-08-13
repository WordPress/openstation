/**
 * OS Settings — what a save actually puts on the wire.
 *
 * Every save used to POST the complete settings object, which made
 * one session's snapshot a weapon against another's. Session B boots,
 * session A changes the wallpaper, B changes only its accent — and
 * B's save carried its own stale wallpaper along with the accent,
 * silently reverting A.
 *
 * The contract pinned here: a save sends only the fields that moved
 * since the last state the server confirmed, so a field this session
 * never touched is absent from the request and the server keeps what
 * it holds. The server-side half of the deal — absent key means keep,
 * not reset — lives in `Tests_OpenStation_OsSettingsRest`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OsSettingsState } from '../../src/settings/types';

const SYNC_DEBOUNCE_MS = 250;

type FetchMock = ReturnType< typeof vi.fn >;
type StateModule = typeof import( '../../src/settings/state' );

let fetchMock: FetchMock;
let state_: StateModule;

/** Options POSTed by the nth request, in call order. */
function sentSettings( call = 0 ): Partial< OsSettingsState > {
	const init = fetchMock.mock.calls[ call ][ 1 ] as { body: string };
	return ( JSON.parse( init.body ) as { settings: Partial< OsSettingsState > } )
		.settings;
}

/** Let the 250 ms sync debounce elapse and the fetch promise settle. */
async function flush(): Promise< void > {
	await vi.advanceTimersByTimeAsync( SYNC_DEBOUNCE_MS + 10 );
}

/**
 * A session that booted from the server: state loaded, rollback
 * baseline primed from it (what `OsSettings`'s constructor does).
 */
function bootedSession(): OsSettingsState {
	const state = state_.structuredDefaults();
	state_.setLastConfirmedState( state );
	return state;
}

beforeEach( async () => {
	// The confirmed-state baseline is module-level, so each test gets
	// a fresh copy of the module rather than inheriting the previous
	// test's idea of what the server has agreed to.
	vi.resetModules();
	state_ = await import( '../../src/settings/state' );
	vi.useFakeTimers();
	fetchMock = vi.fn( () =>
		Promise.resolve( { ok: true, status: 200 } as unknown as Response ),
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

describe( 'OS Settings — partial saves', () => {
	test( 'only the changed field is sent', async () => {
		const state = bootedSession();

		state.accent = 'wp-midnight';
		state_.saveState( state );
		await flush();

		expect( fetchMock ).toHaveBeenCalledOnce();
		expect( sentSettings() ).toEqual( { accent: 'wp-midnight' } );
	} );

	test( 'an untouched field is absent, so it cannot overwrite another session', async () => {
		// Session B booted with the wallpaper it knew about, then
		// session A changed it server-side. B changes only its accent.
		const state = bootedSession();
		const bootWallpaper = state.wallpaper;

		state.accent = 'wp-midnight';
		state_.saveState( state );
		await flush();

		const sent = sentSettings();
		expect( sent.accent ).toBe( 'wp-midnight' );
		expect( 'wallpaper' in sent ).toBe( false );
		// The stale value is still in this session's own state — the
		// point is that it never reaches the wire.
		expect( state.wallpaper ).toBe( bootWallpaper );
	} );

	test( 'several fields changed in one debounce window travel together', async () => {
		const state = bootedSession();

		state.accent = 'wp-midnight';
		state_.saveState( state );
		state.dockSize = 'large';
		state_.saveState( state );
		await flush();

		expect( fetchMock ).toHaveBeenCalledOnce();
		expect( sentSettings() ).toEqual( {
			accent: 'wp-midnight',
			dockSize: 'large',
		} );
	} );

	test( 'nested and array fields are diffed by value, not identity', async () => {
		const state = bootedSession();

		// Re-assigned to an equal-but-distinct object: no change.
		state.customGradient = { ...state.customGradient };
		state.nativePostsHiddenColumns = state.nativePostsHiddenColumns.slice();
		state.accent = 'wp-midnight';
		state_.saveState( state );
		await flush();

		expect( sentSettings() ).toEqual( { accent: 'wp-midnight' } );

		// A real change inside the object does travel.
		state.customGradient = { ...state.customGradient, angle: 123 };
		state_.saveState( state );
		await flush();

		expect( sentSettings( 1 ) ).toEqual( {
			customGradient: state.customGradient,
		} );
	} );

	test( 'a save with nothing changed makes no request at all', async () => {
		const state = bootedSession();

		state_.saveState( state );
		await flush();

		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	test( 'the baseline advances, so a field is not re-sent on the next save', async () => {
		const state = bootedSession();

		state.accent = 'wp-midnight';
		state_.saveState( state );
		await flush();

		state.dockSize = 'large';
		state_.saveState( state );
		await flush();

		expect( fetchMock ).toHaveBeenCalledTimes( 2 );
		expect( sentSettings( 1 ) ).toEqual( { dockSize: 'large' } );
	} );

	test( 'a failed save does not advance the baseline — the field is retried', async () => {
		const state = bootedSession();

		fetchMock.mockImplementationOnce( () =>
			Promise.resolve( { ok: false, status: 500, statusText: 'Err' } as
				unknown as Response ),
		);
		state.accent = 'wp-midnight';
		state_.saveState( state );
		await flush();

		// Rollback reverted the cache; the panel re-applies the change.
		state.accent = 'wp-midnight';
		state.dockSize = 'large';
		state_.saveState( state );
		await flush();

		expect( sentSettings( 1 ) ).toEqual( {
			accent: 'wp-midnight',
			dockSize: 'large',
		} );
	} );

	test( 'without a primed baseline the full snapshot is sent', async () => {
		// Defensive path: no `setLastConfirmedState()` call, so there is
		// nothing to diff against and a partial payload would be a
		// guess. Falls back to the pre-existing behaviour.
		const fresh = state_.structuredDefaults();
		fresh.accent = 'wp-midnight';
		state_.saveState( fresh );
		await flush();

		expect( sentSettings() ).toEqual( fresh );
	} );

	test( 'localStorage still holds the complete state', async () => {
		const state = bootedSession();

		state.accent = 'wp-midnight';
		state_.saveState( state );
		await flush();

		const cached = JSON.parse(
			window.localStorage.getItem( 'desktop-mode-os-settings' ) ?? '{}',
		) as OsSettingsState;
		expect( cached ).toEqual( state );
	} );
} );
