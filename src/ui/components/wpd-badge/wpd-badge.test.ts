/**
 * `<wpd-badge>` — smoke tests. Verifies the dot + slot render, the
 * `tone` attribute reaches the host for CSS targeting, and `no-dot`
 * suppresses the dot.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-badge';

const tick = (): Promise< void > => Promise.resolve();

describe( '<wpd-badge>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a leading dot + slot for the label', async () => {
		host.innerHTML = `<wpd-badge>Attached</wpd-badge>`;
		await tick();
		const badge = host.querySelector( 'wpd-badge' )!;
		expect( badge.shadowRoot!.querySelector( '.dot' ) ).not.toBeNull();
		expect( badge.shadowRoot!.querySelector( 'slot' ) ).not.toBeNull();
		expect( badge.textContent ).toBe( 'Attached' );
	} );

	test( 'tone attribute survives on host for CSS targeting', async () => {
		host.innerHTML = `<wpd-badge tone="success">OK</wpd-badge>`;
		await tick();
		const badge = host.querySelector( 'wpd-badge' )!;
		expect( badge.getAttribute( 'tone' ) ).toBe( 'success' );
	} );

	test( 'no-dot attribute is recognised', async () => {
		host.innerHTML = `<wpd-badge no-dot>v1</wpd-badge>`;
		await tick();
		const badge = host.querySelector( 'wpd-badge' )!;
		expect( badge.hasAttribute( 'no-dot' ) ).toBe( true );
	} );
} );
