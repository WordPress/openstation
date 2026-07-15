import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-toast';

const tick = (): Promise<void> => Promise.resolve();

describe( '<wpd-toast-container>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'sets aria-live=polite on connection', async () => {
		host.innerHTML = `<wpd-toast-container></wpd-toast-container>`;
		await tick();
		const el = host.querySelector( 'wpd-toast-container' )!;
		expect( el.getAttribute( 'aria-live' ) ).toBe( 'polite' );
	} );
} );

describe( '<wpd-toast>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'no action → button rendered hidden', async () => {
		host.innerHTML = `<wpd-toast>Hello</wpd-toast>`;
		await tick();
		const toast = host.querySelector( 'wpd-toast' )!;
		const btn = toast.shadowRoot!.querySelector(
			'button',
		) as HTMLButtonElement;
		expect( btn.hasAttribute( 'hidden' ) ).toBe( true );
	} );

	test( 'action attribute surfaces the button + click emits wpd-toast-action', async () => {
		host.innerHTML = `<wpd-toast action="Retry">Failed</wpd-toast>`;
		await tick();
		const toast = host.querySelector( 'wpd-toast' )!;
		const btn = toast.shadowRoot!.querySelector(
			'button',
		) as HTMLButtonElement;
		expect( btn.hasAttribute( 'hidden' ) ).toBe( false );
		expect( btn.textContent?.trim() ).toBe( 'Retry' );

		let fired = false;
		toast.addEventListener( 'wpd-toast-action', () => {
			fired = true;
		} );
		btn.click();
		expect( fired ).toBe( true );
	} );

	test( 'no dismissible → close button rendered hidden', async () => {
		host.innerHTML = `<wpd-toast>Hello</wpd-toast>`;
		await tick();
		const toast = host.querySelector( 'wpd-toast' )!;
		const close = toast.shadowRoot!.querySelector(
			'.wpd-toast__close',
		) as HTMLButtonElement;
		expect( close.hasAttribute( 'hidden' ) ).toBe( true );
	} );

	test( 'dismissible surfaces the close button + click emits wpd-toast-dismiss', async () => {
		host.innerHTML = `<wpd-toast dismissible>Update available</wpd-toast>`;
		await tick();
		const toast = host.querySelector( 'wpd-toast' )!;
		const close = toast.shadowRoot!.querySelector(
			'.wpd-toast__close',
		) as HTMLButtonElement;
		expect( close.hasAttribute( 'hidden' ) ).toBe( false );
		expect( close.getAttribute( 'aria-label' ) ).toBe( 'Dismiss' );

		let fired = false;
		toast.addEventListener( 'wpd-toast-dismiss', () => {
			fired = true;
		} );
		close.click();
		expect( fired ).toBe( true );
	} );

	test( 'role=status set on connection', async () => {
		host.innerHTML = `<wpd-toast>Hi</wpd-toast>`;
		await tick();
		expect(
			host.querySelector( 'wpd-toast' )!.getAttribute( 'role' ),
		).toBe( 'status' );
	} );
} );
