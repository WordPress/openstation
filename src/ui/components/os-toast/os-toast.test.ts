import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-toast';
import { toastStyles } from './os-toast.styles';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-toast-container>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'sets aria-live=polite on connection', async () => {
		host.innerHTML = `<os-toast-container></os-toast-container>`;
		await tick();
		const el = host.querySelector( 'os-toast-container' )!;
		expect( el.getAttribute( 'aria-live' ) ).toBe( 'polite' );
	} );
} );

describe( '<os-toast>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'no action → button rendered hidden', async () => {
		host.innerHTML = `<os-toast>Hello</os-toast>`;
		await tick();
		const toast = host.querySelector( 'os-toast' )!;
		const btn = toast.shadowRoot!.querySelector(
			'button',
		) as HTMLButtonElement;
		expect( btn.hasAttribute( 'hidden' ) ).toBe( true );
	} );

	test( 'action attribute surfaces the button + click emits os-toast-action', async () => {
		host.innerHTML = `<os-toast action="Retry">Failed</os-toast>`;
		await tick();
		const toast = host.querySelector( 'os-toast' )!;
		const btn = toast.shadowRoot!.querySelector(
			'button',
		) as HTMLButtonElement;
		expect( btn.hasAttribute( 'hidden' ) ).toBe( false );
		expect( btn.textContent?.trim() ).toBe( 'Retry' );

		let fired = false;
		toast.addEventListener( 'os-toast-action', () => {
			fired = true;
		} );
		btn.click();
		expect( fired ).toBe( true );
	} );

	test( 'no dismissible → close button rendered hidden', async () => {
		host.innerHTML = `<os-toast>Hello</os-toast>`;
		await tick();
		const toast = host.querySelector( 'os-toast' )!;
		const close = toast.shadowRoot!.querySelector(
			'.os-toast__close',
		) as HTMLButtonElement;
		expect( close.hasAttribute( 'hidden' ) ).toBe( true );
	} );

	test( 'stylesheet actually hides a [hidden] button (author display must not win)', () => {
		// The close button sets `display`, which would override the UA
		// `[hidden]{display:none}` unless the stylesheet re-hides it — else
		// every persistent toast shows a × regardless of `dismissible`.
		expect( toastStyles.cssText ).toMatch(
			/button\[\s*hidden\s*\]\s*{[^}]*display:\s*none/,
		);
	} );

	test( 'dismissible surfaces the close button + click emits os-toast-dismiss', async () => {
		host.innerHTML = `<os-toast dismissible>Update available</os-toast>`;
		await tick();
		const toast = host.querySelector( 'os-toast' )!;
		const close = toast.shadowRoot!.querySelector(
			'.os-toast__close',
		) as HTMLButtonElement;
		expect( close.hasAttribute( 'hidden' ) ).toBe( false );
		expect( close.getAttribute( 'aria-label' ) ).toBe( 'Dismiss' );

		let fired = false;
		toast.addEventListener( 'os-toast-dismiss', () => {
			fired = true;
		} );
		close.click();
		expect( fired ).toBe( true );
	} );

	test( 'role=status set on connection', async () => {
		host.innerHTML = `<os-toast>Hi</os-toast>`;
		await tick();
		expect(
			host.querySelector( 'os-toast' )!.getAttribute( 'role' ),
		).toBe( 'status' );
	} );
} );
