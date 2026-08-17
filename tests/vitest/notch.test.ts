/**
 * The notch — the shell's top-centre surface.
 *
 * What is pinned here is the contract that makes it safe to put
 * something back at the top edge at all:
 *
 * - It never reserves work area. A 32px full-width bar that stole
 *   height is what OpenStation removed; an element that reserved
 *   space would be the same mistake in a nicer shape. This is the one
 *   test that would fail loudly if someone "fixed" the overlap by
 *   padding the desk.
 * - It loses to the windows. The pill hangs over the strip a title bar
 *   occupies, so it stacks below the window band rather than over it.
 * - It opens the assistant, through the same document event any
 *   plugin would use, without importing the lazy assistant bundle.
 * - It speaks and then stops. `say()` expands the pill with a live
 *   region and collapses it again on its own.
 */

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountNotch, type NotchApi } from '../../src/notch';

const ROOT = resolve( __dirname, '../..' );

/** The number `variables.css` declares for a z-index token. */
function zToken( token: string ): number {
	const css = readFileSync(
		resolve( ROOT, 'assets/css/variables.css' ),
		'utf8'
	);
	const match = new RegExp( `\\n\\t${ token }:\\s*([^;]+);` ).exec( css );
	return Number( match?.[ 1 ].trim() );
}

describe( 'the notch', () => {
	let shell: HTMLElement;
	let notch: NotchApi | null = null;
	let opened: number;

	beforeEach( () => {
		vi.useFakeTimers();
		opened = 0;
		shell = document.createElement( 'div' );
		shell.className = 'os-shell';
		document.body.appendChild( shell );
	} );

	afterEach( () => {
		notch?.destroy();
		notch = null;
		vi.useRealTimers();
		document.body.innerHTML = '';
	} );

	const mount = (): HTMLElement => {
		notch = mountNotch( shell, () => {
			opened += 1;
		} );
		return shell.querySelector< HTMLElement >( '.os-notch' )!;
	};

	test( 'mounts a labelled button on the shell', () => {
		const el = mount();
		expect( el ).not.toBeNull();
		expect( el.tagName ).toBe( 'BUTTON' );
		expect( el.getAttribute( 'aria-label' ) ).toBeTruthy();
	} );

	test( 'clicking it opens the assistant', () => {
		mount().click();
		expect( opened ).toBe( 1 );
	} );

	/*
	 * The load-bearing one. The notch overlaps the top edge on purpose
	 * and gets out of the way (CSS stacks it under the windows) rather
	 * than pushing the desk down — so it must not touch the work area,
	 * in either direction.
	 */
	test( 'reserves no work area', () => {
		const area = document.createElement( 'div' );
		area.className = 'os-area';
		shell.appendChild( area );
		const before = area.getAttribute( 'style' );

		mount();

		expect( area.getAttribute( 'style' ) ).toBe( before );
		expect( area.style.paddingTop ).toBe( '' );
		expect( document.documentElement.style.paddingTop ).toBe( '' );
		expect( document.body.style.paddingTop ).toBe( '' );
	} );

	/*
	 * The other half of "gets out of the way": the notch hangs over the
	 * strip a window's title bar occupies, so it has to lose to that
	 * window. Above the window band it reads as the shell talking over
	 * whatever the user is working in — and the pill would also eat the
	 * clicks meant for the title bar underneath it.
	 */
	test( 'stacks under the window band, above the window-link wires', () => {
		const notchZ = zToken( '--os-z-notch' );

		expect( notchZ ).toBeLessThan( zToken( '--os-z-base' ) );
		expect( notchZ ).toBeGreaterThan( zToken( '--os-z-window-links' ) );

		// The fallback literal in the consuming rule is the floor if
		// `variables.css` never loads, so it has to say the same thing.
		const notchCss = readFileSync(
			resolve( ROOT, 'assets/css/notch.css' ),
			'utf8'
		);
		expect( notchCss ).toContain( `var( --os-z-notch, ${ notchZ } )` );
	} );

	test( 'say() expands it, then collapses on its own', () => {
		const el = mount();
		expect( el.classList.contains( 'os-notch--speaking' ) ).toBe( false );

		notch!.say( 'Saving…' );
		expect( el.classList.contains( 'os-notch--speaking' ) ).toBe( true );
		expect(
			el.querySelector( '.os-notch__message' )?.textContent,
		).toBe( 'Saving…' );

		vi.advanceTimersByTime( 3000 );
		expect( el.classList.contains( 'os-notch--speaking' ) ).toBe( false );
	} );

	test( 'a second message replaces the first rather than queueing', () => {
		const el = mount();
		notch!.say( 'First' );
		vi.advanceTimersByTime( 1000 );
		notch!.say( 'Second' );

		expect(
			el.querySelector( '.os-notch__message' )?.textContent,
		).toBe( 'Second' );

		// The first message's timer must not collapse the second one.
		vi.advanceTimersByTime( 1600 );
		expect( el.classList.contains( 'os-notch--speaking' ) ).toBe( true );
	} );

	/*
	 * The message region exists before it has anything to say. A live
	 * region created at the moment it gains text is announced
	 * unreliably, and the point of the surface is that it speaks.
	 */
	test( 'the live region is present from the start', () => {
		const message = mount().querySelector( '.os-notch__message' );
		expect( message?.getAttribute( 'aria-live' ) ).toBe( 'polite' );
	} );

	/*
	 * The resting label is a SEPARATE element from the live region.
	 * Reusing one element for both would announce "Site assistant"
	 * every time a message finished, which is the opposite of polite.
	 */
	test( 'the resting label is not inside the live region', () => {
		const el = mount();
		const label = el.querySelector( '.os-notch__label' );

		expect( label?.textContent ).toBe( 'Site assistant' );
		expect( label?.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		expect(
			el.querySelector( '.os-notch__message' )?.textContent,
		).toBe( '' );
	} );

	test( 'destroy removes it', () => {
		mount();
		notch!.destroy();
		notch = null;
		expect( shell.querySelector( '.os-notch' ) ).toBeNull();
	} );

	test( 'mounting twice leaves one notch', () => {
		mount();
		const second = mountNotch( shell, () => {} );
		expect( document.querySelectorAll( '.os-notch' ) ).toHaveLength( 1 );
		second.destroy();
	} );
} );
