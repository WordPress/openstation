/**
 * `<wpd-ribbon>` — smoke tests. Confirms the wrapper + rotated banner
 * render, slot projection works, and the `placement` / `tone`
 * attributes survive on the host so the shadow-DOM stylesheet's
 * `[placement='…']` / `[tone='…']` selectors can match.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-ribbon';

const tick = (): Promise< void > => Promise.resolve();

describe( '<wpd-ribbon>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		host.style.position = 'relative';
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a banner span + default slot for the label', async () => {
		host.innerHTML = `<wpd-ribbon>Featured</wpd-ribbon>`;
		await tick();
		const ribbon = host.querySelector( 'wpd-ribbon' )!;
		expect( ribbon.shadowRoot ).not.toBeNull();
		expect( ribbon.shadowRoot!.querySelector( '.banner' ) ).not.toBeNull();
		expect( ribbon.shadowRoot!.querySelector( 'slot' ) ).not.toBeNull();
		expect( ribbon.textContent ).toBe( 'Featured' );
	} );

	test( 'default has no placement attribute — styles target :not([placement])', async () => {
		host.innerHTML = `<wpd-ribbon>X</wpd-ribbon>`;
		await tick();
		const ribbon = host.querySelector( 'wpd-ribbon' )!;
		expect( ribbon.hasAttribute( 'placement' ) ).toBe( false );
	} );

	test( 'placement attribute survives on host for CSS targeting', async () => {
		host.innerHTML = `<wpd-ribbon placement="bottom-start">X</wpd-ribbon>`;
		await tick();
		const ribbon = host.querySelector( 'wpd-ribbon' )!;
		expect( ribbon.getAttribute( 'placement' ) ).toBe( 'bottom-start' );
	} );

	test( 'tone attribute survives on host', async () => {
		host.innerHTML = `<wpd-ribbon tone="success">X</wpd-ribbon>`;
		await tick();
		const ribbon = host.querySelector( 'wpd-ribbon' )!;
		expect( ribbon.getAttribute( 'tone' ) ).toBe( 'success' );
	} );

	test( 'banner part is exposed so consumers can ::part() override', async () => {
		host.innerHTML = `<wpd-ribbon>X</wpd-ribbon>`;
		await tick();
		const ribbon = host.querySelector( 'wpd-ribbon' )!;
		const banner = ribbon.shadowRoot!.querySelector( '.banner' )!;
		expect( banner.getAttribute( 'part' ) ).toBe( 'banner' );
	} );
} );
