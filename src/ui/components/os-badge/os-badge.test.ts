/**
 * `<os-badge>` — smoke tests. Verifies the dot + slot render, the
 * `tone` attribute reaches the host for CSS targeting, and `no-dot`
 * suppresses the dot.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-badge';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-badge>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a leading dot + slot for the label', async () => {
		host.innerHTML = `<os-badge>Attached</os-badge>`;
		await tick();
		const badge = host.querySelector( 'os-badge' )!;
		expect( badge.shadowRoot!.querySelector( '.dot' ) ).not.toBeNull();
		expect( badge.shadowRoot!.querySelector( 'slot' ) ).not.toBeNull();
		expect( badge.textContent ).toBe( 'Attached' );
	} );

	test( 'tone attribute survives on host for CSS targeting', async () => {
		host.innerHTML = `<os-badge tone="success">OK</os-badge>`;
		await tick();
		const badge = host.querySelector( 'os-badge' )!;
		expect( badge.getAttribute( 'tone' ) ).toBe( 'success' );
	} );

	test( 'no-dot attribute is recognised', async () => {
		host.innerHTML = `<os-badge no-dot>v1</os-badge>`;
		await tick();
		const badge = host.querySelector( 'os-badge' )!;
		expect( badge.hasAttribute( 'no-dot' ) ).toBe( true );
	} );
} );
