import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-text-field';

const tick = (): Promise<void> => Promise.resolve();

describe( '<wpd-text-field>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'emits wpd-input-change on every keystroke and reflects value', async () => {
		host.innerHTML = `<wpd-text-field label="Title" value=""></wpd-text-field>`;
		await tick();

		const el = host.querySelector( 'wpd-text-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let heard: string | null = null;
		el.addEventListener( 'wpd-input-change', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );

		input.value = 'Hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		expect( heard ).toBe( 'Hello' );
		expect( el.getAttribute( 'value' ) ).toBe( 'Hello' );
	} );

	test( 'emits wpd-input-commit on change (blur) in addition to wpd-input-change', async () => {
		host.innerHTML = `<wpd-text-field value="before"></wpd-text-field>`;
		await tick();

		const el = host.querySelector( 'wpd-text-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let commit: string | null = null;
		el.addEventListener( 'wpd-input-commit', ( e ) => {
			commit = ( e as CustomEvent ).detail.value;
		} );

		input.value = 'after';
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		expect( commit ).toBe( 'after' );
	} );

	test( 'Enter without modifiers emits wpd-submit', async () => {
		host.innerHTML = `<wpd-text-field value="search query"></wpd-text-field>`;
		await tick();

		const el = host.querySelector( 'wpd-text-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let submitted: string | null = null;
		el.addEventListener( 'wpd-submit', ( e ) => {
			submitted = ( e as CustomEvent ).detail.value;
		} );

		input.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ),
		);
		expect( submitted ).toBe( 'search query' );
	} );

	test( 'Shift+Enter does not trigger wpd-submit', async () => {
		host.innerHTML = `<wpd-text-field value="multi line"></wpd-text-field>`;
		await tick();

		const el = host.querySelector( 'wpd-text-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let fired = 0;
		el.addEventListener( 'wpd-submit', () => fired++ );

		input.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Enter',
				shiftKey: true,
				bubbles: true,
			} ),
		);
		expect( fired ).toBe( 0 );
	} );

	test( 'invalid attribute surfaces aria-invalid on the native input', async () => {
		host.innerHTML = `<wpd-text-field value="x" invalid></wpd-text-field>`;
		await tick();

		const input = host
			.querySelector( 'wpd-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.getAttribute( 'aria-invalid' ) ).toBe( 'true' );
	} );

	test( 'suffix attribute renders inline trailing text', async () => {
		host.innerHTML = `<wpd-text-field value="42" suffix="kg"></wpd-text-field>`;
		await tick();

		const suffix = host
			.querySelector( 'wpd-text-field' )!
			.shadowRoot!.querySelector( '.wpd-text-field__suffix' );
		expect( suffix?.textContent ).toBe( 'kg' );
	} );

	test( 'type=email propagates to the native input', async () => {
		host.innerHTML = `<wpd-text-field type="email" value="a@b.c"></wpd-text-field>`;
		await tick();

		const input = host
			.querySelector( 'wpd-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.type ).toBe( 'email' );
	} );

	test( 'type=password renders as type=text with the mask class — Chrome / Edge / Firefox password managers only inspect type=password inputs, so this sidesteps the save / update / autofill prompts entirely', async () => {
		host.innerHTML = `<wpd-text-field type="password"></wpd-text-field>`;
		await tick();

		const input = host
			.querySelector( 'wpd-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.type ).toBe( 'text' );
		expect( input.classList.contains( 'wpd-text-field__input--masked' ) ).toBe( true );
	} );

	test( 'type=password autocomplete defaults to new-password (defense-in-depth — kept in case a future caller bypasses the type swap)', async () => {
		host.innerHTML = `<wpd-text-field type="password"></wpd-text-field>`;
		await tick();

		const input = host
			.querySelector( 'wpd-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.getAttribute( 'autocomplete' ) ).toBe( 'new-password' );
	} );

	test( 'type=password autocomplete=off upgrades to new-password', async () => {
		host.innerHTML = `<wpd-text-field type="password" autocomplete="off"></wpd-text-field>`;
		await tick();

		const input = host
			.querySelector( 'wpd-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.getAttribute( 'autocomplete' ) ).toBe( 'new-password' );
	} );

	test( 'type=password respects explicit current-password (login flow opt-in)', async () => {
		host.innerHTML = `<wpd-text-field type="password" autocomplete="current-password"></wpd-text-field>`;
		await tick();

		const input = host
			.querySelector( 'wpd-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.getAttribute( 'autocomplete' ) ).toBe( 'current-password' );
	} );

	test( 'type=text with autocomplete=off forwards verbatim (no upgrade for non-password fields)', async () => {
		host.innerHTML = `<wpd-text-field type="text" autocomplete="off"></wpd-text-field>`;
		await tick();

		const input = host
			.querySelector( 'wpd-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.getAttribute( 'autocomplete' ) ).toBe( 'off' );
		expect( input.classList.contains( 'wpd-text-field__input--masked' ) ).toBe( false );
	} );

	test( 'auto-id pulls window + tab + label ancestry', async () => {
		host.innerHTML = `
			<div id="wp-window-calc">
				<wpd-tabpanel for="convert">
					<wpd-text-field label="Amount" value="0"></wpd-text-field>
				</wpd-tabpanel>
			</div>
		`;
		await tick();

		const field = host.querySelector( 'wpd-text-field' ) as HTMLElement;
		expect( field.id ).toBe( 'wpd-calc-tab-convert-amount' );

		const input = field.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		const label = field.shadowRoot!.querySelector( 'label' ) as HTMLLabelElement;
		expect( input.id ).toBe( 'wpd-calc-tab-convert-amount__input' );
		expect( label.htmlFor ).toBe(
			'wpd-calc-tab-convert-amount__input',
		);
	} );
} );
