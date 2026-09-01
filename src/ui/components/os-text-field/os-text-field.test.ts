import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-text-field';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-text-field>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'emits os-input-change on every keystroke and reflects value', async () => {
		host.innerHTML = `<os-text-field label="Title" value=""></os-text-field>`;
		await tick();

		const el = host.querySelector( 'os-text-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let heard: string | null = null;
		el.addEventListener( 'os-input-change', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );

		input.value = 'Hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		expect( heard ).toBe( 'Hello' );
		expect( el.getAttribute( 'value' ) ).toBe( 'Hello' );
	} );

	test( 'emits os-input-commit on change (blur) in addition to os-input-change', async () => {
		host.innerHTML = `<os-text-field value="before"></os-text-field>`;
		await tick();

		const el = host.querySelector( 'os-text-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let commit: string | null = null;
		el.addEventListener( 'os-input-commit', ( e ) => {
			commit = ( e as CustomEvent ).detail.value;
		} );

		input.value = 'after';
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		expect( commit ).toBe( 'after' );
	} );

	test( 'Enter without modifiers emits os-submit', async () => {
		host.innerHTML = `<os-text-field value="search query"></os-text-field>`;
		await tick();

		const el = host.querySelector( 'os-text-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let submitted: string | null = null;
		el.addEventListener( 'os-submit', ( e ) => {
			submitted = ( e as CustomEvent ).detail.value;
		} );

		input.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ),
		);
		expect( submitted ).toBe( 'search query' );
	} );

	test( 'Shift+Enter does not trigger os-submit', async () => {
		host.innerHTML = `<os-text-field value="multi line"></os-text-field>`;
		await tick();

		const el = host.querySelector( 'os-text-field' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let fired = 0;
		el.addEventListener( 'os-submit', () => fired++ );

		input.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Enter',
				shiftKey: true,
				bubbles: true,
			} ),
		);
		expect( fired ).toBe( 0 );
	} );

	test( 'clearable renders the clear button only while the field holds a value', async () => {
		host.innerHTML = `<os-text-field clearable value=""></os-text-field>`;
		await tick();

		const el = host.querySelector( 'os-text-field' )!;
		expect( el.shadowRoot!.querySelector( '.os-text-field__clear' ) ).toBeNull();

		el.setAttribute( 'value', 'sofia' );
		await tick();
		expect( el.shadowRoot!.querySelector( '.os-text-field__clear' ) ).not.toBeNull();
	} );

	test( 'clearing empties the value, emits change AND commit, and refocuses the input', async () => {
		host.innerHTML = `<os-text-field clearable value="sofia"></os-text-field>`;
		await tick();

		const el = host.querySelector( 'os-text-field' )!;
		const heard: string[] = [];
		el.addEventListener( 'os-input-change', ( e ) => {
			heard.push( `change:${ ( e as CustomEvent ).detail.value }` );
		} );
		el.addEventListener( 'os-input-commit', ( e ) => {
			heard.push( `commit:${ ( e as CustomEvent ).detail.value }` );
		} );

		( el.shadowRoot!.querySelector( '.os-text-field__clear' ) as HTMLButtonElement ).click();
		await tick();

		// Both events, deliberately: a clear is a keystroke-shaped edit
		// and a commit point — an explicit clear must not wait out a
		// caller's keystroke debounce.
		expect( heard ).toEqual( [ 'change:', 'commit:' ] );
		expect( el.getAttribute( 'value' ) ).toBe( '' );
		expect( el.shadowRoot!.querySelector( '.os-text-field__clear' ) ).toBeNull();
		expect( el.shadowRoot!.activeElement ).toBe( el.shadowRoot!.querySelector( 'input' ) );
	} );

	test( 'a plain field renders no clear button, value or not', async () => {
		host.innerHTML = `<os-text-field value="sofia"></os-text-field>`;
		await tick();

		const el = host.querySelector( 'os-text-field' )!;
		expect( el.shadowRoot!.querySelector( '.os-text-field__clear' ) ).toBeNull();
	} );

	test( 'invalid attribute surfaces aria-invalid on the native input', async () => {
		host.innerHTML = `<os-text-field value="x" invalid></os-text-field>`;
		await tick();

		const input = host
			.querySelector( 'os-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.getAttribute( 'aria-invalid' ) ).toBe( 'true' );
	} );

	test( 'suffix attribute renders inline trailing text', async () => {
		host.innerHTML = `<os-text-field value="42" suffix="kg"></os-text-field>`;
		await tick();

		const suffix = host
			.querySelector( 'os-text-field' )!
			.shadowRoot!.querySelector( '.os-text-field__suffix' );
		expect( suffix?.textContent ).toBe( 'kg' );
	} );

	test( 'type=email propagates to the native input', async () => {
		host.innerHTML = `<os-text-field type="email" value="a@b.c"></os-text-field>`;
		await tick();

		const input = host
			.querySelector( 'os-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.type ).toBe( 'email' );
	} );

	test( 'type=password renders as type=text with the mask class — Chrome / Edge / Firefox password managers only inspect type=password inputs, so this sidesteps the save / update / autofill prompts entirely', async () => {
		host.innerHTML = `<os-text-field type="password"></os-text-field>`;
		await tick();

		const input = host
			.querySelector( 'os-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.type ).toBe( 'text' );
		expect( input.classList.contains( 'os-text-field__input--masked' ) ).toBe( true );
	} );

	test( 'type=password autocomplete defaults to new-password (defense-in-depth — kept in case a future caller bypasses the type swap)', async () => {
		host.innerHTML = `<os-text-field type="password"></os-text-field>`;
		await tick();

		const input = host
			.querySelector( 'os-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.getAttribute( 'autocomplete' ) ).toBe( 'new-password' );
	} );

	test( 'type=password autocomplete=off upgrades to new-password', async () => {
		host.innerHTML = `<os-text-field type="password" autocomplete="off"></os-text-field>`;
		await tick();

		const input = host
			.querySelector( 'os-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.getAttribute( 'autocomplete' ) ).toBe( 'new-password' );
	} );

	test( 'type=password respects explicit current-password (login flow opt-in)', async () => {
		host.innerHTML = `<os-text-field type="password" autocomplete="current-password"></os-text-field>`;
		await tick();

		const input = host
			.querySelector( 'os-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.getAttribute( 'autocomplete' ) ).toBe( 'current-password' );
	} );

	test( 'type=text with autocomplete=off forwards verbatim (no upgrade for non-password fields)', async () => {
		host.innerHTML = `<os-text-field type="text" autocomplete="off"></os-text-field>`;
		await tick();

		const input = host
			.querySelector( 'os-text-field' )!
			.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		expect( input.getAttribute( 'autocomplete' ) ).toBe( 'off' );
		expect( input.classList.contains( 'os-text-field__input--masked' ) ).toBe( false );
	} );

	test( 'auto-id pulls window + tab + label ancestry', async () => {
		host.innerHTML = `
			<div id="wp-window-calc">
				<os-tabpanel for="convert">
					<os-text-field label="Amount" value="0"></os-text-field>
				</os-tabpanel>
			</div>
		`;
		await tick();

		const field = host.querySelector( 'os-text-field' ) as HTMLElement;
		expect( field.id ).toBe( 'os-calc-tab-convert-amount' );

		const input = field.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		const label = field.shadowRoot!.querySelector( 'label' ) as HTMLLabelElement;
		expect( input.id ).toBe( 'os-calc-tab-convert-amount__input' );
		expect( label.htmlFor ).toBe(
			'os-calc-tab-convert-amount__input',
		);
	} );
} );
