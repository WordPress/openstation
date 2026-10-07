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

function dialog(): HTMLElement | null {
	return document.querySelector< HTMLElement >( '.os-announce' );
}

function focused(): Element | null {
	return document.body.ownerDocument.activeElement;
}

function primary(): HTMLElement | null {
	return document.querySelector< HTMLElement >( '.os-announce__btn--primary' );
}

beforeEach( () => {
	document.body.innerHTML = '';
	trackedFetch.mockClear();
	vi.useFakeTimers();
} );

async function show( cfg: DesktopConfig ): Promise< void > {
	const done = maybeShowRebrandNotice( { config: cfg } );
	await vi.runAllTimersAsync();
	await done;
}

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
		await show( config() );
		press( 'Escape' );

		expect( trackedFetch ).toHaveBeenCalledTimes( 1 );
		expect( dialog() ).toBeNull();
	} );

	test( 'a backdrop click closes, a click on the card does not', async () => {
		await show( config() );

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
		await show( config() );
		primary()?.click();
		trackedFetch.mockClear();

		press( 'Escape' );
		expect( trackedFetch ).not.toHaveBeenCalled();
	} );

	test( 'a failed dismissal write is swallowed', async () => {
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

		expect( focused() ).toBe( opener );
	} );

	test( 'Tab keeps focus inside the dialog', async () => {
		await show( config() );
		const items = Array.from(
			document.querySelectorAll< HTMLElement >( '.os-announce button' ),
		);

		expect( items ).toHaveLength( 1 );
		items[ 0 ].focus();

		press( 'Tab' );
		expect( focused() ).toBe( items[ 0 ] );

		press( 'Tab', true );
		expect( focused() ).toBe( items[ 0 ] );
	} );

	test( 'Tab pulls focus back in when it is on neither end', async () => {
		const behind = document.createElement( 'button' );
		document.body.appendChild( behind );

		await show( config() );
		( focused() as HTMLElement | null )?.blur();
		expect( focused() ).toBe( document.body );

		press( 'Tab' );
		expect( focused() ).toBe( primary() );
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

		expect( paras[ 0 ] ).not.toContain( 'default theme' );
		expect( paras[ 1 ] ).toContain( 'new default theme' );
	} );

	test( 'the reassurance line is the last thing in the body', async () => {
		await show( config() );
		const paras = Array.from(
			document.querySelectorAll< HTMLElement >( '.os-announce__body p' ),
		);

		expect( paras[ paras.length - 1 ]?.className ).toBe(
			'os-announce__fine',
		);
	} );

	test( 'the hero opens on the eyebrow pill, not a logomark', async () => {
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
