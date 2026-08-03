import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-form';
import '../os-text-field/os-text-field';
import '../os-checkbox-label/os-checkbox-label';
import '../os-button/os-button';

const tick = (): Promise< void > => Promise.resolve();
const wait = ( ms = 0 ): Promise< void > =>
	new Promise( ( r ) => setTimeout( r, ms ) );

describe( '<os-form>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'collects named field values via getValues()', async () => {
		host.innerHTML = `
			<os-form>
				<os-text-field name="username" value="jane"></os-text-field>
				<os-text-field name="email" value="jane@example.com"></os-text-field>
				<os-checkbox-label name="notify" checked></os-checkbox-label>
			</os-form>
		`;
		await tick();
		const form = host.querySelector( 'os-form' )! as HTMLElement & {
			getValues: () => Record< string, unknown >;
		};
		const values = form.getValues();
		expect( values.username ).toBe( 'jane' );
		expect( values.email ).toBe( 'jane@example.com' );
		expect( values.notify ).toBe( true );
	} );

	test( 'fires os-form-submit on submit() with the values map', async () => {
		host.innerHTML = `
			<os-form>
				<os-text-field name="title" value="Hello"></os-text-field>
			</os-form>
		`;
		await tick();
		const form = host.querySelector( 'os-form' )! as HTMLElement & {
			submit: () => void;
		};
		let received: Record< string, unknown > | null = null;
		form.addEventListener( 'os-form-submit', ( e ) => {
			received = ( e as CustomEvent ).detail.values;
		} );
		form.submit();
		expect( received ).toEqual( { title: 'Hello' } );
	} );

	test( 'blocks submit + flags fields when required validation fails', async () => {
		host.innerHTML = `
			<os-form>
				<os-text-field name="username" label="Username" required></os-text-field>
				<os-text-field name="email" label="Email" required value="ok@x.com"></os-text-field>
			</os-form>
		`;
		await tick();
		const form = host.querySelector( 'os-form' )! as HTMLElement & {
			submit: () => void;
		};
		let fired = 0;
		form.addEventListener( 'os-form-submit', () => fired++ );
		form.submit();
		expect( fired ).toBe( 0 );
		const username = host.querySelector( 'os-text-field[name="username"]' )!;
		expect( username.hasAttribute( 'invalid' ) ).toBe( true );
		const email = host.querySelector( 'os-text-field[name="email"]' )!;
		expect( email.hasAttribute( 'invalid' ) ).toBe( false );
		// Form-level error shown.
		expect( form.getAttribute( 'error' ) ).toContain( 'Username' );
	} );

	test( 'setFieldInvalid + clearErrors round-trip', async () => {
		host.innerHTML = `
			<os-form>
				<os-text-field name="email" label="Email" value="x@y"></os-text-field>
			</os-form>
		`;
		await tick();
		const form = host.querySelector( 'os-form' )! as HTMLElement & {
			setFieldInvalid: ( name: string, invalid?: boolean ) => void;
			clearErrors: () => void;
		};
		form.setFieldInvalid( 'email' );
		const email = host.querySelector( 'os-text-field[name="email"]' )!;
		expect( email.hasAttribute( 'invalid' ) ).toBe( true );
		form.clearErrors();
		expect( email.hasAttribute( 'invalid' ) ).toBe( false );
	} );

	test( 'reset() restores the initial value snapshot', async () => {
		host.innerHTML = `
			<os-form>
				<os-text-field name="title" value="Initial"></os-text-field>
			</os-form>
		`;
		await tick();
		await wait( 0 );
		const form = host.querySelector( 'os-form' )! as HTMLElement & {
			setValues: ( v: Record< string, unknown > ) => void;
			reset: () => void;
		};
		form.setValues( { title: 'Changed' } );
		const field = host.querySelector( 'os-text-field[name="title"]' )!;
		expect( ( field as HTMLElement & { value: string } ).value ).toBe( 'Changed' );
		form.reset();
		expect( ( field as HTMLElement & { value: string } ).value ).toBe( 'Initial' );
	} );

	test( 'rebroadcasts descendant input events as os-form-input', async () => {
		host.innerHTML = `
			<os-form>
				<os-text-field name="title" value=""></os-text-field>
			</os-form>
		`;
		await tick();
		const form = host.querySelector( 'os-form' )!;
		let detail: { name: string; value: unknown } | null = null;
		form.addEventListener( 'os-form-input', ( e ) => {
			detail = ( e as CustomEvent ).detail;
		} );
		const field = host.querySelector( 'os-text-field[name="title"]' )!;
		const input = field.shadowRoot!.querySelector( 'input' )!;
		input.value = 'hi';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		expect( detail ).not.toBeNull();
		expect( detail!.name ).toBe( 'title' );
		expect( detail!.value ).toBe( 'hi' );
	} );

	test( 'setBusy adds/removes the busy attribute', async () => {
		host.innerHTML = `<os-form></os-form>`;
		await tick();
		const form = host.querySelector( 'os-form' )! as HTMLElement & {
			setBusy: ( b: boolean ) => void;
		};
		form.setBusy( true );
		expect( form.hasAttribute( 'busy' ) ).toBe( true );
		form.setBusy( false );
		expect( form.hasAttribute( 'busy' ) ).toBe( false );
	} );
} );
