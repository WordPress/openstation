import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-release-card';

// Flush the base's render microtask + the component's deferred image
// setup (both scheduled via queueMicrotask / rAF).
const tick = (): Promise< void > =>
	new Promise( ( r ) => setTimeout( r, 0 ) );

describe( '<wpd-release-card>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	function mount( attrs: Record< string, string > ): HTMLElement {
		const el = document.createElement( 'wpd-release-card' );
		Object.entries( attrs ).forEach( ( [ k, v ] ) => el.setAttribute( k, v ) );
		host.appendChild( el );
		return el;
	}

	test( 'label shows the branch and the message shows version + codename', async () => {
		const card = mount( {
			art: 'https://example.com/7.0.png',
			version: '7.0',
			name: 'Armstrong',
			branch: '7.0',
		} );
		await tick();
		const sr = card.shadowRoot!;
		expect( sr.querySelector( '.label .lv' )!.textContent ).toContain( '7.0' );
		const msg = sr.querySelector( '.mtext' )!.textContent || '';
		expect( msg ).toContain( '7.0' );
		expect( msg ).toContain( 'Armstrong' );
		expect( msg ).toContain( 'is available' );
	} );

	test( 'same-branch minor: exact version, no codename', async () => {
		const card = mount( {
			art: 'https://example.com/7.0.png',
			version: '7.0.1',
			name: '',
			branch: '7.0',
		} );
		await tick();
		const sr = card.shadowRoot!;
		expect( sr.querySelector( '.label .lv' )!.textContent ).toContain( '7.0' );
		const msg = sr.querySelector( '.mtext' )!.textContent || '';
		expect( msg ).toContain( '7.0.1' );
		expect( msg ).not.toContain( '"' );
	} );

	test( 'wires the sleeve image with CORS + src (for accent sampling)', async () => {
		const card = mount( {
			art: 'https://example.com/7.0.png',
			version: '7.0',
			branch: '7.0',
		} );
		await tick();
		const img = card.shadowRoot!.querySelector( '.cover-img' ) as HTMLImageElement;
		expect( img.getAttribute( 'crossorigin' ) ).toBe( 'anonymous' );
		expect( img.getAttribute( 'src' ) ).toBe( 'https://example.com/7.0.png' );
	} );

	test( 'an explicit accent attribute is mirrored onto the host', async () => {
		const card = mount( {
			art: 'https://example.com/7.0.png',
			version: '7.0',
			branch: '7.0',
			accent: '#ef5a3c',
			'accent-ink': '#171717',
		} );
		await tick();
		expect( card.style.getPropertyValue( '--accent' ) ).toBe( '#ef5a3c' );
		expect( card.style.getPropertyValue( '--accent-ink' ) ).toBe( '#171717' );
	} );

	test( 'sets role=status and emits wpd-release-update on the button', async () => {
		const card = mount( { art: 'https://example.com/7.0.png', version: '7.0', branch: '7.0' } );
		await tick();
		expect( card.getAttribute( 'role' ) ).toBe( 'status' );
		let fired = false;
		card.addEventListener( 'wpd-release-update', () => {
			fired = true;
		} );
		( card.shadowRoot!.querySelector( '.btn' ) as HTMLButtonElement ).click();
		expect( fired ).toBe( true );
	} );
} );
