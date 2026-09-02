/**
 * `<os-stat>` — smoke tests. The value/label/caption trio renders,
 * the caption stays absent until asked for, the swatch chip appears
 * only with the `swatch` attribute, and prop updates repaint.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-stat';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-stat>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders value + label, no caption or swatch by default', async () => {
		host.innerHTML = `<os-stat value="1,204" label="Events"></os-stat>`;
		await tick();
		const stat = host.querySelector( 'os-stat' )!;
		expect( stat.shadowRoot!.querySelector( '.value' )!.textContent ).toContain( '1,204' );
		expect( stat.shadowRoot!.querySelector( '.label' )!.textContent ).toContain( 'Events' );
		expect( stat.shadowRoot!.querySelector( '.caption' ) ).toBeNull();
		expect( stat.shadowRoot!.querySelector( '.swatch' ) ).toBeNull();
	} );

	test( 'caption renders when provided', async () => {
		host.innerHTML = `<os-stat value="9 days" label="Streak" caption="Mar 3 → Mar 12"></os-stat>`;
		await tick();
		const stat = host.querySelector( 'os-stat' )!;
		expect( stat.shadowRoot!.querySelector( '.caption' )!.textContent ).toContain(
			'Mar 3 → Mar 12',
		);
	} );

	test( 'swatch chip renders with the attribute, hidden from AT', async () => {
		host.innerHTML = `<os-stat value="3" label="Warnings" swatch data-tone="warning"></os-stat>`;
		await tick();
		const swatch = host
			.querySelector( 'os-stat' )!
			.shadowRoot!.querySelector( '.swatch' )!;
		expect( swatch.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
	} );

	test( 'a value prop update repaints', async () => {
		host.innerHTML = `<os-stat value="1" label="Events"></os-stat>`;
		await tick();
		const stat = host.querySelector( 'os-stat' )!;
		stat.setAttribute( 'value', '2' );
		await tick();
		expect( stat.shadowRoot!.querySelector( '.value' )!.textContent ).toContain( '2' );
	} );

	test( 'value and caption parts are exposed for ::part() overrides', async () => {
		host.innerHTML = `<os-stat value="1" label="L" caption="c"></os-stat>`;
		await tick();
		const root = host.querySelector( 'os-stat' )!.shadowRoot!;
		expect( root.querySelector( '.value' )!.getAttribute( 'part' ) ).toBe( 'value' );
		expect( root.querySelector( '.caption' )!.getAttribute( 'part' ) ).toBe( 'caption' );
	} );
} );
