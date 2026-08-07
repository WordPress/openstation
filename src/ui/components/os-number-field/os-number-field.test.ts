import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-number-field';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-number-field>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'emits os-input-change with a parsed number', async () => {
		host.innerHTML = `<os-number-field value="0" label="Amount"></os-number-field>`;
		await tick();

		const el = host.querySelector( 'os-number-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let heard: number | null = null;
		el.addEventListener( 'os-input-change', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );

		input.value = '42.5';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		expect( heard ).toBe( 42.5 );
	} );

	test( 'non-numeric typing is dropped from the event stream', async () => {
		host.innerHTML = `<os-number-field></os-number-field>`;
		await tick();

		const el = host.querySelector( 'os-number-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let fired = 0;
		el.addEventListener( 'os-input-change', () => fired++ );

		// Mid-typing "abc" wouldn't parse as a number; we simulate by
		// setting an empty string (native number inputs reject letters
		// anyway but jsdom is permissive).
		input.value = '';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		expect( fired ).toBe( 0 );
	} );

	test( 'commit clamps to max and reflects the clamped value back', async () => {
		host.innerHTML = `<os-number-field value="5" min="0" max="100"></os-number-field>`;
		await tick();

		const el = host.querySelector( 'os-number-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let commit: number | null = null;
		el.addEventListener( 'os-input-commit', ( e ) => {
			commit = ( e as CustomEvent ).detail.value;
		} );

		input.value = '9999';
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		expect( commit ).toBe( 100 );
		expect( input.value ).toBe( '100' );
	} );

	test( 'commit clamps to min', async () => {
		host.innerHTML = `<os-number-field value="5" min="10"></os-number-field>`;
		await tick();

		const el = host.querySelector( 'os-number-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let commit: number | null = null;
		el.addEventListener( 'os-input-commit', ( e ) => {
			commit = ( e as CustomEvent ).detail.value;
		} );

		input.value = '-50';
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		expect( commit ).toBe( 10 );
	} );

	test( 'Enter emits os-submit with the clamped value', async () => {
		host.innerHTML = `<os-number-field value="5" min="0" max="10"></os-number-field>`;
		await tick();

		const el = host.querySelector( 'os-number-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let submit: number | null = null;
		el.addEventListener( 'os-submit', ( e ) => {
			submit = ( e as CustomEvent ).detail.value;
		} );

		input.value = '42';
		input.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ),
		);
		expect( submit ).toBe( 10 );
	} );

	test( 'suffix attribute renders the unit badge', async () => {
		host.innerHTML = `<os-number-field value="100" suffix="€"></os-number-field>`;
		await tick();

		const suffix = host
			.querySelector( 'os-number-field' )!
			.shadowRoot!.querySelector( '.os-text-field__suffix' );
		expect( suffix?.textContent ).toBe( '€' );
	} );

	test( 'auto-id threads through for <label for> pairing', async () => {
		host.innerHTML = `
			<div id="wp-window-calc">
				<os-number-field label="Amount" value="0"></os-number-field>
			</div>
		`;
		await tick();

		const field = host.querySelector( 'os-number-field' ) as HTMLElement;
		expect( field.id ).toBe( 'os-calc-amount' );

		const input = field.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		const label = field.shadowRoot!.querySelector( 'label' ) as HTMLLabelElement;
		expect( input.id ).toBe( 'os-calc-amount__input' );
		expect( label.htmlFor ).toBe( 'os-calc-amount__input' );
	} );
} );
