import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-release-card';

const tick = (): Promise< void > => Promise.resolve();

describe( '<wpd-release-card>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	function mount(): HTMLElement {
		host.innerHTML =
			'<wpd-release-card art="/art/7.0.jpg" version="7.0" name="Armstrong" ' +
			'accent="#ef5a3c" accent-ink="#171717"></wpd-release-card>';
		return host.querySelector( 'wpd-release-card' ) as HTMLElement;
	}

	test( 'renders the sleeve art, label version, and message', async () => {
		const card = mount();
		await tick();
		const sr = card.shadowRoot!;
		expect( sr.querySelector( 'img' )!.getAttribute( 'src' ) ).toBe( '/art/7.0.jpg' );
		expect( sr.querySelector( '.label .lv' )!.textContent ).toContain( '7.0' );
		const msg = sr.querySelector( '.mtext' )!.textContent || '';
		expect( msg ).toContain( '7.0' );
		expect( msg ).toContain( 'Armstrong' );
	} );

	test( 'mirrors accent attributes onto host custom properties', async () => {
		const card = mount();
		await tick();
		expect( card.style.getPropertyValue( '--accent' ) ).toBe( '#ef5a3c' );
		expect( card.style.getPropertyValue( '--accent-ink' ) ).toBe( '#171717' );
	} );

	test( 'sets role=status on connection', async () => {
		const card = mount();
		await tick();
		expect( card.getAttribute( 'role' ) ).toBe( 'status' );
	} );

	test( 'the Update button emits wpd-release-update', async () => {
		const card = mount();
		await tick();
		const btn = card.shadowRoot!.querySelector( '.btn' ) as HTMLButtonElement;
		let fired = false;
		card.addEventListener( 'wpd-release-update', () => {
			fired = true;
		} );
		btn.click();
		expect( fired ).toBe( true );
	} );
} );
