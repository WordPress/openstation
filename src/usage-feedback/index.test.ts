/**
 * Tests for the one-time usage feedback prompt and its form.
 *
 * The gate and the consent are the surface that matters: the prompt
 * may appear for someone exactly once, nothing may leave the site
 * before Send, an email only travels when its owner typed it, and
 * every way of answering has to be recorded or the prompt comes back
 * on the next boot.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

type FetchArgs = ( url: string, init?: RequestInit, opts?: unknown ) => Promise< Response >;

const trackedFetch = vi.fn< FetchArgs >( () => Promise.resolve( new Response( '{}' ) ) );
vi.mock( '../tracked-fetch', () => ( {
	trackedFetch: ( url: string, init?: RequestInit, opts?: unknown ) => trackedFetch( url, init, opts ),
} ) );

type ToastFn = ( o: { message: string } ) => () => void;
const showToast = vi.fn< ToastFn >( () => () => undefined );
vi.mock( '../toast', () => ( {
	showToast: ( o: { message: string } ) => showToast( o ),
} ) );

import type { DesktopConfig } from '../types';
import { maybeAskForUsageFeedback, USAGE_FEEDBACK_INTRO_SLUG } from './index';
import { showUsageFeedbackPrompt } from './prompt';

const SEEN_URL = 'https://example.test/wp-json/desktop-mode/v1/intros';
const SEND_URL = 'https://example.test/wp-json/desktop-mode/v1/feedback/usage';

function config( over: Partial< DesktopConfig > = {} ): DesktopConfig {
	return {
		usageFeedback: { restUrl: SEND_URL },
		seenIntros: [],
		seenIntrosUrl: SEEN_URL,
		restNonce: 'nonce123',
		...over,
	} as unknown as DesktopConfig;
}

/** Run the prompt past its settle delay. */
async function ask( cfg: DesktopConfig ): Promise< void > {
	const done = maybeAskForUsageFeedback( {
		config: cfg,
		showPrompt: ( opts ) => {
			showUsageFeedbackPrompt( opts );
			return true;
		},
	} );
	await vi.runAllTimersAsync();
	await done;
}

/** The prompt card, if it is on screen. */
function prompt(): HTMLElement | null {
	return document.querySelector< HTMLElement >( '.os-usage-feedback-prompt' );
}

/** One of the card's two answers. */
function answer( which: 'accept' | 'decline' ): HTMLElement | null {
	return document.querySelector< HTMLElement >( `[data-usage-feedback-${ which }]` );
}

/** Say yes to the prompt and let the form mount. */
async function sayYes( cfg: DesktopConfig = config() ): Promise< void > {
	await ask( cfg );
	answer( 'accept' )?.click();
	await vi.runAllTimersAsync();
}

function form(): HTMLElement | null {
	return document.querySelector< HTMLElement >( 'os-modal.os-usage-feedback' );
}

function control( name: string ): HTMLElement | null {
	return form()?.querySelector< HTMLElement >( `[name="${ name }"]` ) ?? null;
}

function button( which: 'send' | 'cancel' ): HTMLElement | null {
	return document.querySelector< HTMLElement >( `[data-usage-feedback-${ which }]` );
}

function errorLine(): HTMLElement | null {
	return form()?.querySelector< HTMLElement >( '.os-usage-feedback__error' ) ?? null;
}

/** Type into a field the way the component reports it. */
function type( name: string, value: string ): void {
	control( name )?.dispatchEvent( new CustomEvent( 'os-input-change', { detail: { value }, bubbles: true } ) );
}

/** Click Send and let the request settle. */
async function send(): Promise< void > {
	button( 'send' )?.click();
	await vi.runAllTimersAsync();
}

/** Escape, the backdrop or the close button, as the modal reports them. */
function cancelModal(): void {
	form()?.dispatchEvent( new CustomEvent( 'os-modal-cancel', { bubbles: true, cancelable: true } ) );
}

/** The requests made so far, as `[ url, parsed body ]`. */
function requests(): Array< [ string, unknown ] > {
	return trackedFetch.mock.calls.map( ( [ url, init ] ) => [ url, JSON.parse( String( init?.body ?? 'null' ) ) ] );
}

const SEEN_WRITE: [ string, unknown ] = [ `${ SEEN_URL }/seen`, { slug: USAGE_FEEDBACK_INTRO_SLUG } ];

beforeEach( async () => {
	// A form left open by the previous test holds the module's
	// single-instance latch; close it the way a user would.
	button( 'cancel' )?.click();
	document.body.innerHTML = '';
	trackedFetch.mockClear();
	trackedFetch.mockImplementation( () => Promise.resolve( new Response( '{}' ) ) );
	showToast.mockClear();
	vi.useFakeTimers();
} );

describe( 'usage feedback — the prompt', () => {
	test( 'asks with a card offering both answers, and sends nothing', async () => {
		await ask( config() );

		expect( prompt() ).not.toBeNull();
		expect( answer( 'accept' ) ).not.toBeNull();
		expect( answer( 'decline' ) ).not.toBeNull();
		expect( form() ).toBeNull();
		expect( trackedFetch ).not.toHaveBeenCalled();
	} );

	test( 'stays silent when the server sent null', async () => {
		await ask( config( { usageFeedback: null } ) );
		expect( prompt() ).toBeNull();
	} );

	test( 'stays silent for a user who already answered', async () => {
		await ask( config( { seenIntros: [ USAGE_FEEDBACK_INTRO_SLUG ] } ) );
		expect( prompt() ).toBeNull();
	} );

	test( 'No thanks is recorded so the card never returns', async () => {
		await ask( config() );
		answer( 'decline' )?.click();

		expect( requests() ).toEqual( [ SEEN_WRITE ] );
		expect( prompt() ).toBeNull();
		expect( form() ).toBeNull();
	} );

	test( 'Sure swaps the card for the form and still sends nothing', async () => {
		await sayYes();

		expect( prompt() ).toBeNull();
		expect( form() ).not.toBeNull();
		expect( trackedFetch ).not.toHaveBeenCalled();
	} );
} );

describe( 'usage feedback — the form', () => {
	test( 'asks three questions and leaves the email empty', async () => {
		await sayYes();

		for ( const name of [ 'requests', 'use_case', 'blockers' ] ) {
			expect( control( name )?.tagName.toLowerCase() ).toBe( 'os-textarea' );
		}
		// Anonymous unless the author decides otherwise: never prefilled.
		expect( control( 'email' )?.getAttribute( 'value' ) ).toBeNull();
	} );

	test( 'Send forwards the answers without an email, closes and thanks', async () => {
		await sayYes();
		type( 'requests', '  Faster windows.  ' );
		await send();

		expect( requests() ).toEqual( [
			[ SEND_URL, { requests: 'Faster windows.', use_case: '', blockers: '', email: '' } ],
		] );
		expect( form() ).toBeNull();
		// No client-side seen write: the route records it in the same
		// request.
		expect( showToast ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'an email travels only when it was typed', async () => {
		await sayYes();
		type( 'use_case', 'Editing posts side by side.' );
		type( 'email', 'me@example.test' );
		await send();

		expect( requests()[ 0 ]?.[ 1 ] ).toMatchObject( { email: 'me@example.test' } );
	} );

	test( 'an empty form is not sent', async () => {
		await sayYes();
		await send();

		expect( trackedFetch ).not.toHaveBeenCalled();
		expect( errorLine()?.hidden ).toBe( false );
		expect( form() ).not.toBeNull();
	} );

	test( 'a malformed address is refused before anything is sent', async () => {
		await sayYes();
		type( 'requests', 'A better dock.' );
		type( 'email', 'not an email' );
		await send();

		expect( trackedFetch ).not.toHaveBeenCalled();
		expect( control( 'email' )?.hasAttribute( 'invalid' ) ).toBe( true );
	} );

	test( 'a failed send keeps the form open and records nothing', async () => {
		trackedFetch.mockImplementationOnce( () => Promise.resolve( new Response( '{}', { status: 502 } ) ) );
		await sayYes();
		type( 'blockers', 'Slow on my laptop.' );
		await send();

		expect( form() ).not.toBeNull();
		expect( errorLine()?.hidden ).toBe( false );
		// Only the attempt itself: they can retry or close.
		expect( trackedFetch ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'Cancel records the prompt as answered', async () => {
		await sayYes();
		button( 'cancel' )?.click();

		expect( requests() ).toEqual( [ SEEN_WRITE ] );
		expect( form() ).toBeNull();
	} );

	test( 'a stray Escape does not throw typed answers away', async () => {
		await sayYes();
		type( 'requests', 'Half a thought' );

		cancelModal();
		expect( form() ).not.toBeNull();
		expect( trackedFetch ).not.toHaveBeenCalled();

		// The second one means it.
		cancelModal();
		expect( form() ).toBeNull();
		expect( requests() ).toEqual( [ SEEN_WRITE ] );
	} );

	test( 'Escape on an untouched form closes at once', async () => {
		await sayYes();
		cancelModal();

		expect( form() ).toBeNull();
		expect( requests() ).toEqual( [ SEEN_WRITE ] );
	} );
} );
