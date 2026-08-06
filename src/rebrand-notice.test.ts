/**
 * Tests for the one-off rebrand announcement.
 *
 * The interesting surface is the gate, not the markup: this dialog is
 * allowed to interrupt someone exactly once, and every way of getting
 * that wrong is user-visible. Showing it to a fresh install explains a
 * rename that never happened to them; showing it twice makes the shell
 * look like it lost the dismissal; failing to record a dismissal that
 * came from Escape rather than the button does the same thing more
 * subtly.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

type FetchArgs = (
	url: string,
	init?: RequestInit,
	opts?: unknown,
) => Promise< unknown >;

const trackedFetch = vi.fn< FetchArgs >( () =>
	Promise.resolve( new Response( '{}' ) ),
);
vi.mock( './tracked-fetch', () => ( {
	trackedFetch: ( url: string, init?: RequestInit, opts?: unknown ) =>
		trackedFetch( url, init, opts ),
} ) );

import { maybeShowRebrandNotice, REBRAND_INTRO_SLUG } from './rebrand-notice';
import type { DesktopConfig } from './types';

function config( over: Partial< DesktopConfig > = {} ): DesktopConfig {
	return {
		rebrandNotice: true,
		seenIntros: [],
		seenIntrosUrl: 'https://example.test/wp-json/desktop-mode/v1/intros',
		restNonce: 'nonce123',
		...over,
	} as unknown as DesktopConfig;
}

/** The mounted dialog, if any. */
function dialog(): HTMLElement | null {
	return document.querySelector< HTMLElement >( '.os-announce' );
}

/**
 * The focused element, read through a node's `ownerDocument` rather
 * than the `document` global (house lint rule).
 */
function focused(): Element | null {
	return document.body.ownerDocument.activeElement;
}

/** The primary "Got it" button. */
function primary(): HTMLElement | null {
	return document.querySelector< HTMLElement >( '.os-announce__btn--primary' );
}

beforeEach( () => {
	document.body.innerHTML = '';
	trackedFetch.mockClear();
	vi.useFakeTimers();
} );

/** Run the announcement past its settle delay. */
async function show( cfg: DesktopConfig ): Promise< void > {
	const done = maybeShowRebrandNotice( { config: cfg } );
	await vi.runAllTimersAsync();
	await done;
}

/** Press a key on the document, the way the trap listens for it. */
function press( key: string, shiftKey = false ): void {
	document.dispatchEvent(
		new KeyboardEvent( 'keydown', { key, shiftKey, bubbles: true } ),
	);
}

describe( 'maybeShowRebrandNotice — the gate', () => {
	test( 'shows on an install that predates the rebrand', async () => {
		await show( config() );
		expect( dialog() ).not.toBeNull();
		expect(
			document.querySelector( '.os-announce__title' )?.textContent,
		).toContain( 'OpenStation' );
	} );

	test( 'stays silent on a fresh install', async () => {
		// `rebrandNotice: false` is what the server sends when no
		// migration ever ran here — nobody to explain a rename to.
		await show( config( { rebrandNotice: false } ) );
		expect( dialog() ).toBeNull();
	} );

	test( 'stays silent for a user who already dismissed it', async () => {
		await show( config( { seenIntros: [ REBRAND_INTRO_SLUG ] } ) );
		expect( dialog() ).toBeNull();
	} );

	test( 'stays silent on a shell whose PHP predates the field', async () => {
		await show( config( { rebrandNotice: undefined } ) );
		expect( dialog() ).toBeNull();
	} );
} );

describe( 'maybeShowRebrandNotice — dismissal', () => {
	test( 'the primary button records the intro as seen', async () => {
		await show( config() );
		primary()?.click();

		expect( trackedFetch ).toHaveBeenCalledTimes( 1 );
		const [ url, init ] = trackedFetch.mock.calls[ 0 ];
		expect( url ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/intros/seen',
		);
		expect( JSON.parse( String( init?.body ) ) ).toEqual( {
			slug: REBRAND_INTRO_SLUG,
		} );
		expect( dialog() ).toBeNull();
	} );

	test( 'Escape records it too', async () => {
		// Leaving this unhandled would bring the dialog back on the
		// next boot for anyone who dismisses with the keyboard.
		await show( config() );
		press( 'Escape' );

		expect( trackedFetch ).toHaveBeenCalledTimes( 1 );
		expect( dialog() ).toBeNull();
	} );

	test( 'a backdrop click closes, a click on the card does not', async () => {
		await show( config() );

		// Selecting text inside the card is not a request to leave.
		document
			.querySelector< HTMLElement >( '.os-announce__card' )
			?.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( dialog() ).not.toBeNull();

		dialog()?.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( dialog() ).toBeNull();
	} );

	test( 'closing twice writes the dismissal once', async () => {
		await show( config() );
		primary()?.click();
		press( 'Escape' );
		expect( trackedFetch ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'the Escape listener is removed on close', async () => {
		// A listener left bound on `document` would keep swallowing
		// Escape for the rest of the session, breaking every window
		// shortcut that uses it.
		await show( config() );
		primary()?.click();
		trackedFetch.mockClear();

		press( 'Escape' );
		expect( trackedFetch ).not.toHaveBeenCalled();
	} );

	test( 'a failed dismissal write is swallowed', async () => {
		// The user has read it and closed it; an error toast here would
		// be about our bookkeeping, not about them.
		trackedFetch.mockRejectedValueOnce( new Error( 'offline' ) );
		await show( config() );
		expect( () => primary()?.click() ).not.toThrow();
	} );
} );

describe( 'maybeShowRebrandNotice — the dialog', () => {
	test( 'is a labelled modal dialog', async () => {
		await show( config() );
		const el = dialog();

		expect( el?.getAttribute( 'role' ) ).toBe( 'dialog' );
		expect( el?.getAttribute( 'aria-modal' ) ).toBe( 'true' );
		// The labelling ids have to resolve, or a screen reader
		// announces an unnamed dialog.
		const labelledBy = el?.getAttribute( 'aria-labelledby' ) ?? '';
		const describedBy = el?.getAttribute( 'aria-describedby' ) ?? '';
		expect( el?.querySelector( `#${ labelledBy }` ) ).not.toBeNull();
		expect( el?.querySelector( `#${ describedBy }` ) ).not.toBeNull();
	} );

	test( 'moves focus to the primary action and restores it on close', async () => {
		const opener = document.createElement( 'button' );
		document.body.appendChild( opener );
		opener.focus();

		await show( config() );
		expect( focused() ).toBe( primary() );

		primary()?.click();
		// The desk is interactive behind the dialog and the user did
		// not choose to come here.
		expect( focused() ).toBe( opener );
	} );

	test( 'Tab keeps focus inside the dialog', async () => {
		await show( config() );
		const items = Array.from(
			document.querySelectorAll< HTMLElement >( '.os-announce button' ),
		);
		// "Got it" on its own. The trap still has to hold: with one
		// control it is both ends of the wrap, and Tab must not walk out
		// into the desk behind the dialog.
		expect( items ).toHaveLength( 1 );
		items[ 0 ].focus();

		press( 'Tab' );
		expect( focused() ).toBe( items[ 0 ] );

		press( 'Tab', true );
		expect( focused() ).toBe( items[ 0 ] );
	} );
} );

describe( 'the announcement copy', () => {
	test( 'the theme note is its own paragraph, after the explanation', async () => {
		await show( config() );
		const paras = Array.from(
			document.querySelectorAll< HTMLElement >( '.os-announce__body p' ),
		).map( ( p ) => p.textContent ?? '' );

		expect( paras ).toHaveLength( 3 );
		expect( paras[ 0 ] ).toContain( 'Why OpenStation?' );
		// Two separate pieces of news. Folded together, a translator
		// would have to guess where the rename ends and the theme
		// begins.
		expect( paras[ 0 ] ).not.toContain( 'default theme' );
		expect( paras[ 1 ] ).toContain( 'new default theme' );
	} );

	test( 'the reassurance line is the last thing in the body', async () => {
		// It answers "did my install change?", which only lands once the
		// rename itself has been explained.
		await show( config() );
		const paras = Array.from(
			document.querySelectorAll< HTMLElement >( '.os-announce__body p' ),
		);

		expect( paras[ paras.length - 1 ]?.className ).toBe(
			'os-announce__fine',
		);
	} );

	test( 'the hero opens on the eyebrow pill, not a logomark', async () => {
		// The headline is where the new name gets said; a mark above it
		// says it a beat early and buries the sentence that explains it.
		await show( config() );
		const hero = document.querySelector( '.os-announce__hero' );

		expect( hero?.firstElementChild?.className ).toBe(
			'os-announce__eyebrow',
		);
		expect( hero?.querySelector( 'svg' ) ).toBeNull();
		expect(
			hero?.querySelector( '.os-announce__eyebrow' )?.textContent,
		).toBe( 'New name' );
	} );

	test( 'the described-by target is the explanation, not the theme note', async () => {
		// A screen reader reading the theme note as the dialog's
		// description would say nothing about the rename.
		await show( config() );
		const describedBy =
			document
				.querySelector( '.os-announce' )
				?.getAttribute( 'aria-describedby' ) ?? '';

		expect( document.getElementById( describedBy )?.textContent ).toContain(
			'Why OpenStation?',
		);
	} );
} );
