/**
 * `<os-token-field>` — insertion lands at the caret, and the preview
 * is honest about what it doesn't know.
 *
 * The caret is the whole reason this is a component. By the time a
 * token is picked, the field has lost focus to the catalogue and
 * `selectionStart` reads 0, so the naive implementation inserts
 * every token at the very beginning of the value. The tests below
 * pin the remembered-caret behaviour, and the substitution rule that
 * leaves sample-less tokens visible rather than blanking them.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import './os-token-field';
import type { OsTokenField } from './os-token-field';

const tick = async (): Promise< void > => {
	await Promise.resolve();
	await Promise.resolve();
};

const TOKENS = [
	{
		group: 'Questions',
		label: 'Full name',
		token: '{field:1}',
		sample: 'Ada Lovelace',
	},
	{
		group: 'Questions',
		label: 'Email',
		token: '{field:2}',
		sample: 'ada@example.com',
	},
	// No sample: resolves somewhere this component can't see.
	{ group: 'Form', label: 'All answers', token: '{all_fields}' },
];

describe( '<os-token-field>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => {
		host.remove();
	} );

	async function mount( attrs = '' ): Promise< OsTokenField > {
		host.innerHTML = `<os-token-field ${ attrs }></os-token-field>`;
		const el = host.querySelector( 'os-token-field' ) as OsTokenField;
		el.tokens = TOKENS;
		await tick();
		return el;
	}

	function field( el: OsTokenField ): HTMLInputElement {
		return el.shadowRoot!.querySelector( '.os-token-field__input' ) as HTMLInputElement;
	}
	function options( el: OsTokenField ): HTMLButtonElement[] {
		return Array.from(
			el.shadowRoot!.querySelectorAll< HTMLButtonElement >(
				'.os-token-field__option',
			),
		);
	}
	function openCatalogue( el: OsTokenField ): void {
		( el.shadowRoot!.querySelector( 'os-button' ) as HTMLElement ).click();
	}

	test( 'the catalogue lists every token, grouped', async () => {
		const el = await mount();
		openCatalogue( el );
		await tick();

		expect( options( el ) ).toHaveLength( 3 );
		const groups = Array.from(
			el.shadowRoot!.querySelectorAll( '.os-token-field__group' ),
		).map( ( g ) => g.textContent?.trim() );
		expect( groups ).toEqual( [ 'Questions', 'Form' ] );
	} );

	test( 'inserts at the caret, not at the end', async () => {
		const el = await mount();
		el.value = 'Hi , thanks';
		await tick();

		// Put the caret after "Hi " — where a user would.
		const input = field( el );
		input.focus();
		input.setSelectionRange( 3, 3 );
		input.dispatchEvent( new Event( 'keyup', { bubbles: true } ) );

		openCatalogue( el );
		await tick();
		options( el )[ 0 ].click();

		expect( el.value ).toBe( 'Hi {field:1}, thanks' );
	} );

	test( 'a selection is replaced by the token', async () => {
		const el = await mount();
		el.value = 'Hi NAME, thanks';
		await tick();

		const input = field( el );
		input.focus();
		input.setSelectionRange( 3, 7 );
		input.dispatchEvent( new Event( 'keyup', { bubbles: true } ) );

		openCatalogue( el );
		await tick();
		options( el )[ 0 ].click();

		expect( el.value ).toBe( 'Hi {field:1}, thanks' );
	} );

	test( 'insertion emits both the insert and the input event', async () => {
		const el = await mount();
		const insert = vi.fn();
		const input = vi.fn();
		el.addEventListener( 'os-token-insert', ( e ) =>
			insert( ( e as CustomEvent ).detail ),
		);
		el.addEventListener( 'os-token-field-input', ( e ) =>
			input( ( e as CustomEvent ).detail ),
		);

		openCatalogue( el );
		await tick();
		options( el )[ 0 ].click();

		expect( insert ).toHaveBeenCalledWith( {
			token: '{field:1}',
			value: '{field:1}',
		} );
		expect( input ).toHaveBeenCalledWith( { value: '{field:1}' } );
	} );

	test( 'typing echoes on the input event', async () => {
		const el = await mount();
		const seen = vi.fn();
		el.addEventListener( 'os-token-field-input', ( e ) =>
			seen( ( e as CustomEvent ).detail ),
		);

		const input = field( el );
		input.value = 'typed';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		expect( seen ).toHaveBeenCalledWith( { value: 'typed' } );
		expect( el.value ).toBe( 'typed' );
	} );

	test( 'the preview substitutes samples', async () => {
		const el = await mount();
		el.value = 'Hi {field:1} at {field:2}';
		await tick();

		const preview = el.shadowRoot!.querySelector(
			'.os-token-field__preview-body',
		)!;
		expect( preview.textContent?.trim() ).toBe(
			'Hi Ada Lovelace at ada@example.com',
		);
	} );

	test( 'a token with no sample is left standing in the preview', async () => {
		const el = await mount();
		el.value = 'All of it: {all_fields} for {field:1}';
		await tick();

		const preview = el.shadowRoot!.querySelector(
			'.os-token-field__preview-body',
		)!;
		// The token stays visible — which reads correctly as "this
		// one resolves somewhere I can't show you", rather than
		// vanishing and implying it resolves to nothing.
		expect( preview.textContent?.trim() ).toBe(
			'All of it: {all_fields} for Ada Lovelace',
		);
	} );

	test( 'no preview when nothing would change', async () => {
		const el = await mount();
		el.value = 'Plain text with no tokens';
		await tick();
		expect(
			el.shadowRoot!.querySelector( '.os-token-field__preview' ),
		).toBeNull();

		// Same when the only token present has no sample to show.
		el.value = 'Only {all_fields}';
		await tick();
		expect(
			el.shadowRoot!.querySelector( '.os-token-field__preview' ),
		).toBeNull();
	} );

	test( 'Escape closes the catalogue', async () => {
		const el = await mount();
		openCatalogue( el );
		await tick();
		expect( el.hasAttribute( 'open' ) ).toBe( true );

		field( el ).dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Escape',
				bubbles: true,
				composed: true,
			} ),
		);
		expect( el.hasAttribute( 'open' ) ).toBe( false );
	} );

	test( 'multiline renders a textarea', async () => {
		const el = await mount( 'multiline rows="6"' );
		const control = field( el );
		expect( control.tagName ).toBe( 'TEXTAREA' );
		expect( control.getAttribute( 'rows' ) ).toBe( '6' );
	} );

	test( 'the trigger is disabled with an empty catalogue', async () => {
		host.innerHTML = `<os-token-field></os-token-field>`;
		const el = host.querySelector( 'os-token-field' ) as OsTokenField;
		await tick();

		expect(
			el.shadowRoot!.querySelector( 'os-button' )!.hasAttribute( 'disabled' ),
		).toBe( true );
	} );

	test( 'readonly keeps the catalogue shut', async () => {
		const el = await mount( 'readonly' );
		openCatalogue( el );
		await tick();
		// The trigger is disabled, so the click is inert — but assert
		// the state rather than the attribute, since that is what a
		// user would experience.
		expect( el.hasAttribute( 'open' ) ).toBe( false );
	} );
} );
