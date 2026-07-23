import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-button';

const tick = (): Promise<void> => Promise.resolve();

describe( '<wpd-button>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders slotted text + bubbles native clicks', async () => {
		host.innerHTML = `<wpd-button variant="primary">Save</wpd-button>`;
		await tick();
		const btn = host.querySelector( 'wpd-button' )!;
		expect( btn.textContent?.trim() ).toBe( 'Save' );
		let clicked = false;
		btn.addEventListener( 'click', () => {
			clicked = true;
		} );
		btn.shadowRoot!.querySelector( 'button' )!.click();
		expect( clicked ).toBe( true );
	} );

	test( '?disabled attribute disables the inner button', async () => {
		host.innerHTML = `<wpd-button disabled>Save</wpd-button>`;
		await tick();
		const inner = host
			.querySelector( 'wpd-button' )!
			.shadowRoot!.querySelector( 'button' ) as HTMLButtonElement;
		expect( inner.disabled ).toBe( true );
	} );

	test( '?busy attribute disables the button, sets aria-busy, and renders a spinner', async () => {
		host.innerHTML = `<wpd-button busy>Save</wpd-button>`;
		await tick();
		const inner = host
			.querySelector( 'wpd-button' )!
			.shadowRoot!.querySelector( 'button' ) as HTMLButtonElement;
		expect( inner.disabled ).toBe( true );
		expect( inner.getAttribute( 'aria-busy' ) ).toBe( 'true' );
		expect( inner.querySelector( '.wpd-button__spinner' ) ).toBeTruthy();
	} );
} );
