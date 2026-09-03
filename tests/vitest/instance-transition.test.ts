/**
 * The instance hop's two halves: the desk slides out towards the site
 * picked, and the shell that arrives slides its desk in from the same
 * side once overview is up. A desk never stays hidden.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	HOP_OUT_MS,
	REVEAL_MS,
	leaveInstance,
	revealInstance,
	stampArrival,
} from '../../src/multisite/instance-transition';

function mountShell( arriving = false ): HTMLElement {
	const el = document.createElement( 'div' );
	el.id = 'os-shell';
	el.className = 'os-shell' + ( arriving ? ' os-shell--arriving' : '' );
	document.body.appendChild( el );
	return el;
}

describe( 'the instance hop transition', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		sessionStorage.clear();
	} );

	afterEach( () => {
		vi.useRealTimers();
		document.body.innerHTML = '';
	} );

	test( 'leaving slides the desk out towards the pick and leaves the direction for the next shell', async () => {
		const shell = mountShell();
		let done = false;
		void leaveInstance( 'next' ).then( () => {
			done = true;
		} );

		expect( shell.classList.contains( 'os-shell--hop-out-next' ) ).toBe( true );
		expect( sessionStorage.getItem( 'openstation-hop-direction' ) ).toBe( 'next' );
		await vi.advanceTimersByTimeAsync( HOP_OUT_MS - 1 );
		expect( done ).toBe( false );
		await vi.advanceTimersByTimeAsync( 1 );
		expect( done ).toBe( true );
	} );

	test( 'arriving stamps the side to enter from, and the reveal lets the desk in', () => {
		sessionStorage.setItem( 'openstation-hop-direction', 'prev' );
		const shell = mountShell( true );

		stampArrival();
		expect( shell.classList.contains( 'os-shell--arriving-prev' ) ).toBe( true );
		// One-shot: a reload of this shell fades in plainly.
		expect( sessionStorage.getItem( 'openstation-hop-direction' ) ).toBeNull();

		revealInstance();
		expect( shell.classList.contains( 'os-shell--arriving' ) ).toBe( false );
		expect( shell.classList.contains( 'os-shell--arriving-prev' ) ).toBe( false );
		expect( shell.classList.contains( 'os-shell--revealing' ) ).toBe( true );
		vi.advanceTimersByTime( REVEAL_MS );
		expect( shell.classList.contains( 'os-shell--revealing' ) ).toBe( false );
	} );

	test( 'a shell that did not arrive from a switch is left alone', () => {
		const shell = mountShell();
		stampArrival();
		revealInstance();
		expect( shell.className ).toBe( 'os-shell' );
	} );

	test( 'the desk never stays hidden: the reveal runs on its own if boot never asks', () => {
		const shell = mountShell( true );
		stampArrival();
		vi.advanceTimersByTime( 4000 );
		expect( shell.classList.contains( 'os-shell--arriving' ) ).toBe( false );
	} );
} );
