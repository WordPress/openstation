import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-checkbox';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-checkbox>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'unchecked by default; toggling emits os-checkbox-change + sets checked attribute', async () => {
		host.innerHTML = `<os-checkbox label="HD only" value="hd"></os-checkbox>`;
		await tick();

		const el = host.querySelector( 'os-checkbox' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.checked ).toBe( false );
		expect( el.hasAttribute( 'checked' ) ).toBe( false );

		let heard: { checked: boolean; value: string | null } | null = null;
		el.addEventListener( 'os-checkbox-change', ( e ) => {
			heard = ( e as CustomEvent ).detail;
		} );

		input.checked = true;
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		expect( heard ).toEqual( { checked: true, value: 'hd' } );
		expect( el.hasAttribute( 'checked' ) ).toBe( true );
	} );

	test( '`checked` attribute reflects into the native input', async () => {
		host.innerHTML = `<os-checkbox checked label="Default on"></os-checkbox>`;
		await tick();

		const input = host
			.querySelector( 'os-checkbox' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.checked ).toBe( true );
	} );

	test( '`disabled` attribute propagates to the native input', async () => {
		host.innerHTML = `<os-checkbox disabled label="Can't touch this"></os-checkbox>`;
		await tick();

		const input = host
			.querySelector( 'os-checkbox' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.disabled ).toBe( true );
	} );

	test( 'emits value=null when no value attribute is set', async () => {
		host.innerHTML = `<os-checkbox></os-checkbox>`;
		await tick();

		const el = host.querySelector( 'os-checkbox' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let heard: { checked: boolean; value: string | null } | null = null;
		el.addEventListener( 'os-checkbox-change', ( e ) => {
			heard = ( e as CustomEvent ).detail;
		} );

		input.checked = true;
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		expect( heard ).toEqual( { checked: true, value: null } );
	} );

	test( 'unchecking removes the checked attribute', async () => {
		host.innerHTML = `<os-checkbox checked></os-checkbox>`;
		await tick();

		const el = host.querySelector( 'os-checkbox' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;

		input.checked = false;
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		expect( el.hasAttribute( 'checked' ) ).toBe( false );
	} );
} );
