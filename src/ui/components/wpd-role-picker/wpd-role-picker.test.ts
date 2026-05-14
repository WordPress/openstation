/**
 * `<wpd-role-picker>` tests.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

async function load() {
	return await import( './wpd-role-picker' );
}

describe( 'wpd-role-picker', () => {
	beforeEach( async () => {
		document.body.innerHTML = '';
		await load();
		( window as unknown as { desktopModeConfig: Record< string, unknown > } ).desktopModeConfig = {
			shareEligibleRoles: [
				{ slug: 'editor', name: 'Editor' },
				{ slug: 'author', name: 'Author' },
			],
		};
	} );
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'renders one chip per eligible role', async () => {
		const el = document.createElement( 'wpd-role-picker' );
		document.body.appendChild( el );
		await new Promise( ( r ) => queueMicrotask( () => r( null ) ) );
		const chips = el.shadowRoot!.querySelectorAll< HTMLElement >( '.chip' );
		expect( chips.length ).toBe( 2 );
		expect( chips[ 0 ].textContent ).toBe( 'Editor' );
	} );

	test( 'reflects selected attribute via aria-pressed', async () => {
		const el = document.createElement( 'wpd-role-picker' );
		el.setAttribute( 'selected', 'editor' );
		document.body.appendChild( el );
		await new Promise( ( r ) => queueMicrotask( () => r( null ) ) );
		const chips = el.shadowRoot!.querySelectorAll< HTMLElement >( '.chip' );
		expect( chips[ 0 ].getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( chips[ 1 ].getAttribute( 'aria-pressed' ) ).toBe( 'false' );
	} );

	test( 'emits wpd-role-toggle on click with the inverse selected state', async () => {
		const el = document.createElement( 'wpd-role-picker' );
		el.setAttribute( 'selected', 'editor' );
		const events: unknown[] = [];
		el.addEventListener( 'wpd-role-toggle', ( e ) =>
			events.push( ( e as CustomEvent ).detail ),
		);
		document.body.appendChild( el );
		await new Promise( ( r ) => queueMicrotask( () => r( null ) ) );

		const chips = el.shadowRoot!.querySelectorAll< HTMLButtonElement >( '.chip' );
		chips[ 0 ].click(); // editor → deselect
		chips[ 1 ].click(); // author → select
		expect( events ).toEqual( [
			{ slug: 'editor', selected: false },
			{ slug: 'author', selected: true },
		] );
	} );
} );
