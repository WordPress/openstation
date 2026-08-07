/**
 * `<os-user-search>` tests.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

async function load() {
	return await import( './os-user-search' );
}

declare global {
	interface Window {
		__searchFetchCalls?: number;
	}
}

describe( 'os-user-search', () => {
	beforeEach( async () => {
		document.body.innerHTML = '';
		await load();
		( window as unknown as { openStationConfig: Record< string, unknown > } ).openStationConfig = {
			filesUsersSearchUrl: 'https://example.test/files/users/search',
			restNonce: 'nonce',
		};
		window.__searchFetchCalls = 0;
	} );
	afterEach( () => {
		document.body.innerHTML = '';
		vi.restoreAllMocks();
	} );

	test( 'renders the input with placeholder', async () => {
		const el = document.createElement( 'os-user-search' );
		el.setAttribute( 'placeholder', 'Find people' );
		document.body.appendChild( el );
		await new Promise( ( r ) => queueMicrotask( () => r( null ) ) );
		const input = el.shadowRoot!.querySelector< HTMLInputElement >( '.input' );
		expect( input?.placeholder ).toBe( 'Find people' );
	} );

	test( 'debounces requests then renders results', async () => {
		const fetchSpy = vi.fn( async () =>
			new Response(
				JSON.stringify( {
					users: [ { id: 1, name: 'Alice', slug: 'alice', avatarUrl: '' } ],
				} ),
				{ headers: { 'Content-Type': 'application/json' } },
			),
		);
		// eslint-disable-next-line no-restricted-syntax -- test mock
		( globalThis as unknown as { fetch: typeof fetch } ).fetch = fetchSpy as unknown as typeof fetch;

		const el = document.createElement( 'os-user-search' );
		document.body.appendChild( el );
		await new Promise( ( r ) => queueMicrotask( () => r( null ) ) );

		const input = el.shadowRoot!.querySelector< HTMLInputElement >( '.input' )!;
		input.value = 'ali';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		// Wait for debounce + fetch.
		await new Promise( ( r ) => setTimeout( r, 250 ) );
		await new Promise( ( r ) => queueMicrotask( () => r( null ) ) );

		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
		const dropdown = el.shadowRoot!.querySelector( '.dropdown' );
		expect( dropdown ).not.toBeNull();
		const items = el.shadowRoot!.querySelectorAll( '.item' );
		expect( items.length ).toBe( 1 );
		expect( items[ 0 ].textContent ).toContain( 'Alice' );
	} );

	test( 'emits os-user-pick when a result is clicked', async () => {
		const fetchSpy = vi.fn( async () =>
			new Response(
				JSON.stringify( {
					users: [ { id: 2, name: 'Bob', slug: 'bob', avatarUrl: '' } ],
				} ),
				{ headers: { 'Content-Type': 'application/json' } },
			),
		);
		// eslint-disable-next-line no-restricted-syntax -- test mock
		( globalThis as unknown as { fetch: typeof fetch } ).fetch = fetchSpy as unknown as typeof fetch;

		const el = document.createElement( 'os-user-search' );
		const picks: unknown[] = [];
		el.addEventListener( 'os-user-pick', ( e ) => picks.push( ( e as CustomEvent ).detail ) );
		document.body.appendChild( el );
		await new Promise( ( r ) => queueMicrotask( () => r( null ) ) );

		const input = el.shadowRoot!.querySelector< HTMLInputElement >( '.input' )!;
		input.value = 'bob';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		await new Promise( ( r ) => setTimeout( r, 250 ) );
		await new Promise( ( r ) => queueMicrotask( () => r( null ) ) );

		const item = el.shadowRoot!.querySelector< HTMLButtonElement >( '.item' );
		item!.click();
		expect( picks.length ).toBe( 1 );
		expect( ( picks[ 0 ] as { user: { id: number } } ).user.id ).toBe( 2 );
	} );
} );
