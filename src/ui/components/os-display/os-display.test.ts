import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-display';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-display>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders the value attribute into the <output>', async () => {
		host.innerHTML = `<os-display value="1,234.00"></os-display>`;
		await tick();
		const output = host
			.querySelector( 'os-display' )!
			.shadowRoot!.querySelector( 'output' )!;
		expect( output.textContent?.trim() ).toBe( '1,234.00' );
	} );

	test( 'auto-labels role + aria-live on first connect', async () => {
		host.innerHTML = `<os-display value="0"></os-display>`;
		await tick();
		const display = host.querySelector( 'os-display' )!;
		expect( display.getAttribute( 'role' ) ).toBe( 'status' );
		expect( display.getAttribute( 'aria-live' ) ).toBe( 'polite' );
	} );

	test( 'size + align flow through to custom properties', async () => {
		host.innerHTML = `<os-display value="42" size="xl" align="center"></os-display>`;
		await tick();
		const display = host.querySelector< HTMLElement >( 'os-display' )!;
		expect( display.style.getPropertyValue( '--os-ui-display-size' ) ).toBe( '40px' );
		expect( display.style.getPropertyValue( '--os-ui-display-align' ) ).toBe(
			'center',
		);
	} );
} );
