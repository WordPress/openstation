/**
 * Unit tests for `src/toast.ts`. Uses jsdom's fake timers so the
 * dismiss timeout is deterministic without actually waiting.
 *
 * The DOM now renders via `<os-toast-container>` + `<os-toast>`
 * web components — tests interact with tag names rather than the
 * old class-based selectors.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { showToast } from '../../src/toast';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

describe( 'toast.ts', () => {
	beforeEach( () => {
		// `showToast` filters through `wp.os.activity`, which
		// in turn calls `wp.hooks.applyFilters` — install the hooks
		// stub so the call has a runtime to talk to.
		installHooksStub();
		document.body.innerHTML = '';
		vi.useFakeTimers();
	} );

	afterEach( () => {
		vi.useRealTimers();
		document.body.innerHTML = '';
		clearHooksStub();
	} );

	test( 'showToast creates a container + toast element', () => {
		showToast( { message: 'hello' } );
		const container = document.querySelector( 'os-toast-container' );
		expect( container ).not.toBeNull();
		const toast = container?.querySelector( 'os-toast' );
		expect( toast ).not.toBeNull();
		expect( toast?.textContent?.includes( 'hello' ) ).toBe( true );
	} );

	test( 'showToast reuses an existing container for stacking', () => {
		showToast( { message: 'one' } );
		showToast( { message: 'two' } );
		const containers = document.querySelectorAll(
			'os-toast-container',
		);
		expect( containers ).toHaveLength( 1 );
		const toasts = containers[ 0 ].querySelectorAll( 'os-toast' );
		expect( toasts ).toHaveLength( 2 );
	} );

	test( 'auto-dismisses after the default duration', () => {
		showToast( { message: 'bye' } );
		const container = document.querySelector( 'os-toast-container' )!;
		expect( container.querySelectorAll( 'os-toast' ) ).toHaveLength( 1 );

		// Default duration (4000 ms) kicks the fade; fade takes 200 ms
		// to complete and remove the element.
		vi.advanceTimersByTime( 4000 );
		vi.advanceTimersByTime( 200 );
		expect( container.querySelectorAll( 'os-toast' ) ).toHaveLength( 0 );
	} );

	test( 'custom duration is honored', () => {
		showToast( { message: 'quick', duration: 500 } );
		const container = document.querySelector( 'os-toast-container' )!;
		vi.advanceTimersByTime( 400 );
		expect( container.querySelectorAll( 'os-toast' ) ).toHaveLength( 1 );
		// Advance past (500 duration + 200 fade) to guarantee removal.
		vi.advanceTimersByTime( 400 );
		expect( container.querySelectorAll( 'os-toast' ) ).toHaveLength( 0 );
	} );

	test( 'action dispatches os-toast-action + fires the callback on click', async () => {
		let clicked = false;
		showToast( {
			message: 'retry?',
			action: {
				label: 'Retry',
				onClick: () => {
					clicked = true;
				},
			},
		} );
		// Drain the component's first render so the shadow-DOM
		// button exists to query + click.
		vi.useRealTimers();
		await Promise.resolve();
		vi.useFakeTimers();

		const toast = document.querySelector( 'os-toast' )!;
		const button = toast.shadowRoot!.querySelector< HTMLButtonElement >(
			'button',
		);
		expect( button ).not.toBeNull();
		expect( button?.textContent?.trim() ).toBe( 'Retry' );

		button?.click();
		expect( clicked ).toBe( true );

		// After the action callback fires, the toast starts fading.
		vi.advanceTimersByTime( 200 );
		expect(
			document.querySelectorAll( 'os-toast' ),
		).toHaveLength( 0 );
	} );

	test( 'persistent toast does not auto-dismiss', () => {
		showToast( { message: 'stays', persistent: true } );
		const container = document.querySelector( 'os-toast-container' )!;
		// Well past the default duration — a persistent toast stays put.
		vi.advanceTimersByTime( 60000 );
		expect( container.querySelectorAll( 'os-toast' ) ).toHaveLength( 1 );
	} );

	test( 'dismissible toast renders a close button that fires onDismiss + removes it', async () => {
		let dismissed = false;
		showToast( {
			message: 'closeable',
			persistent: true,
			dismissible: true,
			onDismiss: () => {
				dismissed = true;
			},
		} );
		// Drain the component's first render so the shadow-DOM button exists.
		vi.useRealTimers();
		await Promise.resolve();
		vi.useFakeTimers();

		const toast = document.querySelector( 'os-toast' )!;
		const close = toast.shadowRoot!.querySelector< HTMLButtonElement >(
			'.os-toast__close',
		);
		expect( close ).not.toBeNull();

		close?.click();
		expect( dismissed ).toBe( true );

		vi.advanceTimersByTime( 200 );
		expect( document.querySelectorAll( 'os-toast' ) ).toHaveLength( 0 );
	} );

	test( 'the returned dismiss function removes the toast early', () => {
		const dismiss = showToast( { message: 'ephemeral', duration: 10000 } );
		const container = document.querySelector( 'os-toast-container' )!;
		expect( container.querySelectorAll( 'os-toast' ) ).toHaveLength( 1 );
		dismiss();
		vi.advanceTimersByTime( 250 );
		expect( container.querySelectorAll( 'os-toast' ) ).toHaveLength( 0 );
	} );

	test( 'hover freezes the countdown until the pointer leaves', () => {
		showToast( { message: 'read me', duration: 1000 } );
		const toast = document.querySelector( 'os-toast' )!;

		toast.dispatchEvent( new Event( 'mouseenter' ) );
		expect( toast.hasAttribute( 'held' ) ).toBe( true );

		// Ten times the duration, with the pointer parked on it.
		vi.advanceTimersByTime( 10000 );
		expect( document.querySelectorAll( 'os-toast' ) ).toHaveLength( 1 );

		toast.dispatchEvent( new Event( 'mouseleave' ) );
		expect( toast.hasAttribute( 'held' ) ).toBe( false );
		// Released countdowns get a floor (1200 ms) so a toast that was
		// nearly expired doesn't vanish the instant the pointer leaves.
		vi.advanceTimersByTime( 1000 );
		expect( document.querySelectorAll( 'os-toast' ) ).toHaveLength( 1 );
		vi.advanceTimersByTime( 200 + 200 );
		expect( document.querySelectorAll( 'os-toast' ) ).toHaveLength( 0 );
	} );

	test( 'focus inside the toast freezes the countdown', () => {
		showToast( {
			message: 'undo?',
			duration: 1000,
			action: { label: 'Undo', onClick: () => undefined },
		} );
		const toast = document.querySelector( 'os-toast' )!;

		// The action button lives in the shadow root; `focusin` is
		// composed, so the host is where the hold is decided.
		toast.dispatchEvent( new FocusEvent( 'focusin', { bubbles: true } ) );
		vi.advanceTimersByTime( 10000 );
		expect( document.querySelectorAll( 'os-toast' ) ).toHaveLength( 1 );

		toast.dispatchEvent(
			new FocusEvent( 'focusout', { bubbles: true, relatedTarget: null } ),
		);
		vi.advanceTimersByTime( 1200 + 200 );
		expect( document.querySelectorAll( 'os-toast' ) ).toHaveLength( 0 );
	} );

	test( 'time already served is not refunded by a hold', () => {
		showToast( { message: 'tick', duration: 5000 } );
		const toast = document.querySelector( 'os-toast' )!;

		vi.advanceTimersByTime( 4000 );
		toast.dispatchEvent( new Event( 'mouseenter' ) );
		vi.advanceTimersByTime( 10000 );
		toast.dispatchEvent( new Event( 'mouseleave' ) );

		// 1000 ms were left, floored to 1200 — not restarted at 5000.
		vi.advanceTimersByTime( 1200 + 200 );
		expect( document.querySelectorAll( 'os-toast' ) ).toHaveLength( 0 );
	} );

	test( 'a persistent toast ignores holds entirely', () => {
		showToast( { message: 'stays', persistent: true } );
		const toast = document.querySelector( 'os-toast' )!;
		toast.dispatchEvent( new Event( 'mouseenter' ) );
		toast.dispatchEvent( new Event( 'mouseleave' ) );
		vi.advanceTimersByTime( 60000 );
		expect( document.querySelectorAll( 'os-toast' ) ).toHaveLength( 1 );
	} );

	test( 'dismissing a toast that holds focus hands focus back', async () => {
		const opener = document.createElement( 'button' );
		document.body.appendChild( opener );
		opener.focus();

		showToast( {
			message: 'saved',
			persistent: true,
			action: { label: 'Undo', onClick: () => undefined },
		} );
		// Drain the component's first render so the shadow button exists.
		vi.useRealTimers();
		await Promise.resolve();
		vi.useFakeTimers();

		const toast = document.querySelector( 'os-toast' )!;
		const button = toast.shadowRoot!.querySelector( 'button' )!;
		button.focus();
		expect( document.activeElement ).toBe( toast );

		button.click();
		// Without the hand-back the browser drops focus on <body> and
		// the next Tab restarts from the top of the admin.
		expect( document.activeElement ).toBe( opener );
	} );

	test( 'a dismissal that does not hold focus leaves the user where they are', async () => {
		const opener = document.createElement( 'button' );
		const elsewhere = document.createElement( 'button' );
		document.body.append( opener, elsewhere );
		opener.focus();

		const dismiss = showToast( { message: 'fyi', persistent: true } );
		elsewhere.focus();
		dismiss();
		expect( document.activeElement ).toBe( elsewhere );
	} );

	test( 'calling dismiss twice is a no-op (idempotent)', () => {
		const dismiss = showToast( { message: 'once', duration: 10000 } );
		expect( () => {
			dismiss();
			dismiss();
		} ).not.toThrow();
	} );
} );
