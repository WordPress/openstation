import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OsSettingsState } from '../../src/settings/types';

const SYNC_DEBOUNCE_MS = 250;

type FetchMock = ReturnType< typeof vi.fn >;
type StateModule = typeof import( '../../src/settings/state' );

let fetchMock: FetchMock;
let state_: StateModule;

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

async function tick(): Promise< void > {
	await vi.advanceTimersByTimeAsync( SYNC_DEBOUNCE_MS + 10 );
}

async function respond( n: number ): Promise< void > {
	resolvers[ n ]( { ok: true, status: 200 } as unknown as Response );
	await vi.advanceTimersByTimeAsync( 0 );
}

describe( 'OS Settings — overlapping saves', () => {
	test( 'saved events expose only the submitted snapshot, without aliasing queued changes', async () => {
		const state = bootedSession();
		state.windowRadius = 'sharp';
		const snapshots: OsSettingsState[] = [];
		const listener = ( event: Event ) => {
			const detail = ( event as CustomEvent ).detail;
			if ( detail.phase === 'saved' ) { snapshots.push( detail.savedSettings ); }
		};
		document.addEventListener( 'os-settings-save-lifecycle', listener );
		try {
			state.dockSize = 'large'; state_.saveState( state ); await tick();
			state.windowRadius = 'round'; state_.saveState( state ); await tick();
			await respond( 0 );
			expect( snapshots[ 0 ].windowRadius ).toBe( 'sharp' );
			snapshots[ 0 ].windowRadius = 'default';
			await respond( 1 );
			expect( snapshots[ 1 ].windowRadius ).toBe( 'round' );
			expect( state.windowRadius ).toBe( 'round' );
		} finally { document.removeEventListener( 'os-settings-save-lifecycle', listener ); }
	} );
	test( 'a second change does not start while the first is in flight', async () => {
		const state = bootedSession();

		state.dockSize = 'large';
		state_.saveState( state );
		await tick();
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );

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

		resolvers[ 0 ]( { ok: false, status: 500, statusText: 'Err' } as unknown as Response );
		await vi.advanceTimersByTimeAsync( 0 );

		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );
} );
