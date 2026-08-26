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

	test( 'hover sets held + emits os-toast-hold once per transition', async () => {
		host.innerHTML = `<os-toast action="Undo">Moved to trash</os-toast>`;
		await tick();
		const toast = host.querySelector( 'os-toast' )!;
		const seen: boolean[] = [];
		toast.addEventListener( 'os-toast-hold', ( e ) => {
			seen.push( ( e as CustomEvent< { held: boolean } > ).detail.held );
		} );

		toast.dispatchEvent( new Event( 'mouseenter' ) );
		expect( toast.hasAttribute( 'held' ) ).toBe( true );
		// A second enter without an intervening leave is not a new
		// transition — re-emitting would reset showToast()'s countdown
		// on every pointer twitch.
		toast.dispatchEvent( new Event( 'mouseenter' ) );
		toast.dispatchEvent( new Event( 'mouseleave' ) );
		expect( toast.hasAttribute( 'held' ) ).toBe( false );
		expect( seen ).toEqual( [ true, false ] );
	} );

	test( 'hover and focus overlap without releasing early', async () => {
		host.innerHTML = `<os-toast action="Undo">Moved to trash</os-toast>`;
		await tick();
		const toast = host.querySelector( 'os-toast' )!;

		toast.dispatchEvent( new Event( 'mouseenter' ) );
		toast.dispatchEvent( new FocusEvent( 'focusin', { bubbles: true } ) );
		toast.dispatchEvent( new Event( 'mouseleave' ) );
		// Pointer gone, focus still inside → still held.
		expect( toast.hasAttribute( 'held' ) ).toBe( true );

		toast.dispatchEvent(
			new FocusEvent( 'focusout', { bubbles: true, relatedTarget: null } ),
		);
		expect( toast.hasAttribute( 'held' ) ).toBe( false );
	} );

	test( 'focus moving between the toast\'s own buttons is not a release', async () => {
		host.innerHTML = `<os-toast action="Undo" dismissible>Moved to trash</os-toast>`;
		await tick();
		const toast = host.querySelector( 'os-toast' )!;
		const close = toast.shadowRoot!.querySelector( '.os-toast__close' )!;

		toast.dispatchEvent( new FocusEvent( 'focusin', { bubbles: true } ) );
		// Both buttons live in the shadow root, where contains() stops
		// — the check has to walk out through the host.
		toast.dispatchEvent(
			new FocusEvent( 'focusout', {
				bubbles: true,
				relatedTarget: close,
			} ),
		);
		expect( toast.hasAttribute( 'held' ) ).toBe( true );
	} );

	test( 'role=status set on connection', async () => {
		host.innerHTML = `<os-toast>Hi</os-toast>`;
		await tick();
		expect(
			host.querySelector( 'os-toast' )!.getAttribute( 'role' ),
		).toBe( 'status' );
	} );
} );
