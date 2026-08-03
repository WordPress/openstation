import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-range-field';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-range-field>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'emits os-range-change with a numeric value', async () => {
		host.innerHTML = `<os-range-field label="Angle" min="0" max="360" step="1" suffix="°" value="45"></os-range-field>`;
		await tick();
		const field = host.querySelector( 'os-range-field' )!;
		const input = field.shadowRoot!.querySelector(
			'input',
		) as HTMLInputElement;
		let heard: number | null = null;
		field.addEventListener( 'os-range-change', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );
		input.value = '180';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		expect( heard ).toBe( 180 );
	} );

	test( 'an integer step reads out as an integer', async () => {
		host.innerHTML = `<os-range-field min="0" max="360" step="1" value="45"></os-range-field>`;
		await tick();
		expect( readout().textContent ).toBe( '45' );
	} );

	test( 'a fractional step reads out to the step’s precision', async () => {
		host.innerHTML = `<os-range-field min="0" max="3" step="0.05" value="1.4"></os-range-field>`;
		await tick();
		expect( readout().textContent ).toBe( '1.40' );
	} );

	test( 'decimals overrides what the step implies', async () => {
		host.innerHTML = `<os-range-field min="0" max="360" step="1" decimals="2" value="45"></os-range-field>`;
		await tick();
		expect( readout().textContent ).toBe( '45.00' );
	} );

	test( 'the readout box is sized from the range, not the value', async () => {
		// The bug: a readout that fits only what it is showing is
		// exactly the readout that resizes mid-drag and shoves the
		// track sideways under the thumb.
		host.innerHTML = `<os-range-field min="0" max="360" step="0.5" suffix="°" value="5"></os-range-field>`;
		await tick();
		const field = host.querySelector( 'os-range-field' )!;
		const width = (): string | undefined =>
			readout().getAttribute( 'style' ) ?? undefined;
		// 3 digits + point + 1 decimal + 1 suffix char.
		expect( width() ).toContain( '6ch' );

		field.setAttribute( 'value', '359.5' );
		await tick();
		expect( width() ).toContain( '6ch' );
		expect( readout().textContent ).toBe( '359.5°' );
	} );

	function readout(): HTMLElement {
		return host
			.querySelector( 'os-range-field' )!
			.shadowRoot!.querySelector( '.os-range-field__value' ) as HTMLElement;
	}
} );
