import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OsSettingsState } from '../../src/settings/types';

const SYNC_DEBOUNCE_MS = 250;

type FetchMock = ReturnType< typeof vi.fn >;
type StateModule = typeof import( '../../src/settings/state' );

let fetchMock: FetchMock;
let state_: StateModule;

function sentSettings( call = 0 ): Partial< OsSettingsState > {
	const init = fetchMock.mock.calls[ call ][ 1 ] as { body: string };
	return ( JSON.parse( init.body ) as { settings: Partial< OsSettingsState > } )
		.settings;
}

async function flush(): Promise< void > {
	await vi.advanceTimersByTimeAsync( SYNC_DEBOUNCE_MS + 10 );
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

		const state = bootedSession();
		const bootWallpaper = state.wallpaper;

		state.accent = 'wp-midnight';
		state_.saveState( state );
		await flush();

		const sent = sentSettings();
		expect( sent.accent ).toBe( 'wp-midnight' );
		expect( 'wallpaper' in sent ).toBe( false );

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

		state.customGradient = { ...state.customGradient };
		state.nativePostsHiddenColumns = state.nativePostsHiddenColumns.slice();
		state.nativePagesHiddenColumns = state.nativePagesHiddenColumns.slice();
		state.accent = 'wp-midnight';
		state_.saveState( state );
		await flush();

		expect( sentSettings() ).toEqual( { accent: 'wp-midnight' } );

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

		state.accent = 'wp-midnight';
		state.dockSize = 'large';
		state_.saveState( state );
		await flush();

		expect( sentSettings( 1 ) ).toEqual( {
			accent: 'wp-midnight',
			dockSize: 'large',
		} );
	} );

	test( 'a server-loaded boot primes the baseline, so the first save is a diff', async () => {
		( window as unknown as { openStationConfig?: unknown } ).openStationConfig = {
			osSettingsUrl: '/wp-json/desktop-mode/v1/os-settings',
			restNonce: 'nonce',
			osSettings: { wallpaper: 'dark' },
		};

		const state = state_.loadState();
		expect( state.wallpaper ).toBe( 'dark' );

		state.accent = 'wp-midnight';
		state_.saveState( state );
		await flush();

		expect( sentSettings() ).toEqual( { accent: 'wp-midnight' } );
	} );

	test( 'a cache-loaded boot does NOT prime the baseline — the first save heals it', async () => {

		window.localStorage.setItem(
			'desktop-mode-os-settings',
			JSON.stringify( { ...state_.structuredDefaults(), wallpaper: 'dark' } ),
		);
		( window as unknown as { openStationConfig?: unknown } ).openStationConfig = {
			osSettingsUrl: '/wp-json/desktop-mode/v1/os-settings',
			restNonce: 'nonce',
		};

		const state = state_.loadState();
		expect( state.wallpaper ).toBe( 'dark' );

		state.accent = 'wp-midnight';
		state_.saveState( state );
		await flush();

		const sent = sentSettings();
		expect( sent.accent ).toBe( 'wp-midnight' );
		expect( sent.wallpaper ).toBe( 'dark' );
		expect( sent ).toEqual( state );
	} );

	test( 'without a primed baseline the full snapshot is sent', async () => {

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
