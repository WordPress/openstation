/**
 * Extended Options — save coalescing.
 *
 * The controls in this section stay live while a save is in flight,
 * which is deliberate: a site-wide toggle should never feel like it
 * locked up. The consequence is that the values on screen can move
 * past the values the in-flight request is carrying, and the section
 * has to notice.
 *
 * The failure this pins is silent, which is what makes it worth a
 * test: toggling off and straight back on left the checkbox enabled,
 * the server holding `false`, and no error anywhere — the divergence
 * only surfaced on the next reload.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildExtendedSection } from '../../src/settings/sections/extended';
import type { SettingsCtx } from '../../src/settings/types';

type FetchMock = ReturnType< typeof vi.fn >;

let fetchMock: FetchMock;

function ctxStub(): SettingsCtx {
	return {
		config: {
			extendedOptionsUrl: '/wp-json/desktop-mode/v1/extended-options',
			restNonce: 'nonce',
			extendedOptions: {
				media_library_enhanced: true,
				games: false,
				agents: false,
			},
		},
	} as unknown as SettingsCtx;
}

/** Options POSTed by the nth request, in call order. */
function bodyOf( call: number ): Record< string, boolean > {
	const init = fetchMock.mock.calls[ call ][ 1 ] as { body: string };
	return ( JSON.parse( init.body ) as { options: Record< string, boolean > } )
		.options;
}

/** Drive a checkbox the way the component does when a user clicks it. */
function toggle( el: HTMLElement, index: number, checked: boolean ): void {
	const boxes = el.querySelectorAll( 'os-checkbox-label' );
	boxes[ index ].dispatchEvent(
		new CustomEvent( 'os-checkbox-change', {
			detail: { checked },
			bubbles: true,
			composed: true,
		} ),
	);
}

/** A response whose body echoes the options the request sent. */
function echo( init: { body: string } ): Response {
	const { options } = JSON.parse( init.body ) as {
		options: Record< string, boolean >;
	};
	return {
		ok: true,
		status: 200,
		json: async () => options,
	} as unknown as Response;
}

beforeEach( () => {
	fetchMock = vi.fn();
	( window as unknown as { wp?: unknown } ).wp = { os: { fetch: fetchMock } };
} );

afterEach( () => {
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'Extended Options — saving', () => {
	test( 'a toggle POSTs the full option set', async () => {
		fetchMock.mockImplementation( ( _url: string, init: { body: string } ) =>
			Promise.resolve( echo( init ) ),
		);
		const el = buildExtendedSection( ctxStub() );

		toggle( el, 0, false );
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalledOnce() );

		expect( bodyOf( 0 ) ).toEqual( {
			media_library_enhanced: false,
			games: false,
			agents: false,
		} );
	} );

	test( 'a toggle during an in-flight save is persisted, not dropped', async () => {
		let releaseFirst: () => void = () => undefined;
		const first = new Promise< void >( ( resolve ) => {
			releaseFirst = resolve;
		} );
		fetchMock.mockImplementation(
			async ( _url: string, init: { body: string } ) => {
				if ( fetchMock.mock.calls.length === 1 ) {
					await first;
				}
				return echo( init );
			},
		);

		const ctx = ctxStub();
		const el = buildExtendedSection( ctx );

		toggle( el, 0, false );
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalledOnce() );

		// Second click lands while the first request is still open.
		toggle( el, 0, true );
		expect( fetchMock ).toHaveBeenCalledOnce();

		releaseFirst();
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalledTimes( 2 ) );

		expect( bodyOf( 0 ).media_library_enhanced ).toBe( false );
		expect( bodyOf( 1 ).media_library_enhanced ).toBe( true );
		// The panel's cached copy ends on the value the server kept,
		// so re-opening Preferences shows the same state as a reload.
		expect( ctx.config.extendedOptions?.media_library_enhanced ).toBe(
			true,
		);
	} );

	test( 'several mid-flight toggles coalesce into one trailing save', async () => {
		let releaseFirst: () => void = () => undefined;
		const first = new Promise< void >( ( resolve ) => {
			releaseFirst = resolve;
		} );
		fetchMock.mockImplementation(
			async ( _url: string, init: { body: string } ) => {
				if ( fetchMock.mock.calls.length === 1 ) {
					await first;
				}
				return echo( init );
			},
		);

		const el = buildExtendedSection( ctxStub() );

		toggle( el, 1, true );
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalledOnce() );

		// Three more changes, across two different controls, while
		// the first request is open.
		toggle( el, 1, false );
		toggle( el, 2, true );
		toggle( el, 0, false );

		releaseFirst();
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalledTimes( 2 ) );

		expect( bodyOf( 1 ) ).toEqual( {
			media_library_enhanced: false,
			games: false,
			agents: true,
		} );
	} );

	test( 'a failed save leaves the queued change to the trailing request', async () => {
		let releaseFirst: () => void = () => undefined;
		const first = new Promise< void >( ( resolve ) => {
			releaseFirst = resolve;
		} );
		fetchMock.mockImplementation(
			async ( _url: string, init: { body: string } ) => {
				if ( fetchMock.mock.calls.length === 1 ) {
					await first;
					return {
						ok: false,
						status: 500,
						json: async () => ( { message: 'boom' } ),
					} as unknown as Response;
				}
				return echo( init );
			},
		);

		const el = buildExtendedSection( ctxStub() );

		toggle( el, 0, false );
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalledOnce() );
		toggle( el, 0, true );

		releaseFirst();
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalledTimes( 2 ) );

		expect( bodyOf( 1 ).media_library_enhanced ).toBe( true );
		// The trailing save succeeded, so the error from the first
		// attempt must not be left on screen.
		expect( el.querySelector( '.os-ext__error' ) ).toBeNull();
	} );

	test( 'nothing is sent without an endpoint and a nonce', () => {
		const ctx = ctxStub();
		ctx.config.extendedOptionsUrl = '';
		const el = buildExtendedSection( ctx );

		toggle( el, 0, false );
		toggle( el, 0, true );

		expect( fetchMock ).not.toHaveBeenCalled();
	} );
} );
