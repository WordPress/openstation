import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-button';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-button>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders slotted text + bubbles native clicks', async () => {
		host.innerHTML = `<os-button variant="primary">Save</os-button>`;
		await tick();
		const btn = host.querySelector( 'os-button' )!;
		expect( btn.textContent?.trim() ).toBe( 'Save' );
		let clicked = false;
		btn.addEventListener( 'click', () => {
			clicked = true;
		} );
		btn.shadowRoot!.querySelector( 'button' )!.click();
		expect( clicked ).toBe( true );
	} );

	test( '?disabled attribute disables the inner button', async () => {
		host.innerHTML = `<os-button disabled>Save</os-button>`;
		await tick();
		const inner = host
			.querySelector( 'os-button' )!
			.shadowRoot!.querySelector( 'button' ) as HTMLButtonElement;
		expect( inner.disabled ).toBe( true );
	} );

	test( '?busy attribute disables the button, sets aria-busy, and renders a spinner', async () => {
		host.innerHTML = `<os-button busy>Save</os-button>`;
		await tick();
		const inner = host
			.querySelector( 'os-button' )!
			.shadowRoot!.querySelector( 'button' ) as HTMLButtonElement;
		expect( inner.disabled ).toBe( true );
		expect( inner.getAttribute( 'aria-busy' ) ).toBe( 'true' );
		expect( inner.querySelector( '.os-button__spinner' ) ).toBeTruthy();
	} );
} );
