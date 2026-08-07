/**
 * `<os-ribbon>` — smoke tests. Confirms the wrapper + rotated banner
 * render, slot projection works, and the `placement` / `tone`
 * attributes survive on the host so the shadow-DOM stylesheet's
 * `[placement='…']` / `[tone='…']` selectors can match.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-ribbon';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-ribbon>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		host.style.position = 'relative';
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a banner span + default slot for the label', async () => {
		host.innerHTML = `<os-ribbon>Featured</os-ribbon>`;
		await tick();
		const ribbon = host.querySelector( 'os-ribbon' )!;
		expect( ribbon.shadowRoot ).not.toBeNull();
		expect( ribbon.shadowRoot!.querySelector( '.banner' ) ).not.toBeNull();
		expect( ribbon.shadowRoot!.querySelector( 'slot' ) ).not.toBeNull();
		expect( ribbon.textContent ).toBe( 'Featured' );
	} );

	test( 'default has no placement attribute — styles target :not([placement])', async () => {
		host.innerHTML = `<os-ribbon>X</os-ribbon>`;
		await tick();
		const ribbon = host.querySelector( 'os-ribbon' )!;
		expect( ribbon.hasAttribute( 'placement' ) ).toBe( false );
	} );

	test( 'placement attribute survives on host for CSS targeting', async () => {
		host.innerHTML = `<os-ribbon placement="bottom-start">X</os-ribbon>`;
		await tick();
		const ribbon = host.querySelector( 'os-ribbon' )!;
		expect( ribbon.getAttribute( 'placement' ) ).toBe( 'bottom-start' );
	} );

	test( 'tone attribute survives on host', async () => {
		host.innerHTML = `<os-ribbon tone="success">X</os-ribbon>`;
		await tick();
		const ribbon = host.querySelector( 'os-ribbon' )!;
		expect( ribbon.getAttribute( 'tone' ) ).toBe( 'success' );
	} );

	test( 'banner part is exposed so consumers can ::part() override', async () => {
		host.innerHTML = `<os-ribbon>X</os-ribbon>`;
		await tick();
		const ribbon = host.querySelector( 'os-ribbon' )!;
		const banner = ribbon.shadowRoot!.querySelector( '.banner' )!;
		expect( banner.getAttribute( 'part' ) ).toBe( 'banner' );
	} );
} );
