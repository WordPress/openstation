import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-form';
import '../wpd-text-field/wpd-text-field';
import '../wpd-checkbox-label/wpd-checkbox-label';
import '../wpd-button/wpd-button';

const tick = (): Promise< void > => Promise.resolve();
const wait = ( ms = 0 ): Promise< void > =>
	new Promise( ( r ) => setTimeout( r, ms ) );

describe( '<wpd-form>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'collects named field values via getValues()', async () => {
		host.innerHTML = `
			<wpd-form>
				<wpd-text-field name="username" value="jane"></wpd-text-field>
				<wpd-text-field name="email" value="jane@example.com"></wpd-text-field>
				<wpd-checkbox-label name="notify" checked></wpd-checkbox-label>
			</wpd-form>
		`;
		await tick();
		const form = host.querySelector( 'wpd-form' )! as HTMLElement & {
			getValues: () => Record< string, unknown >;
		};
		const values = form.getValues();
		expect( values.username ).toBe( 'jane' );
		expect( values.email ).toBe( 'jane@example.com' );
		expect( values.notify ).toBe( true );
	} );

	test( 'fires wpd-form-submit on submit() with the values map', async () => {
		host.innerHTML = `
			<wpd-form>
				<wpd-text-field name="title" value="Hello"></wpd-text-field>
			</wpd-form>
		`;
		await tick();
		const form = host.querySelector( 'wpd-form' )! as HTMLElement & {
			submit: () => void;
		};
		let received: Record< string, unknown > | null = null;
		form.addEventListener( 'wpd-form-submit', ( e ) => {
			received = ( e as CustomEvent ).detail.values;
		} );
		form.submit();
		expect( received ).toEqual( { title: 'Hello' } );
	} );

	test( 'blocks submit + flags fields when required validation fails', async () => {
		host.innerHTML = `
			<wpd-form>
				<wpd-text-field name="username" label="Username" required></wpd-text-field>
				<wpd-text-field name="email" label="Email" required value="ok@x.com"></wpd-text-field>
			</wpd-form>
		`;
		await tick();
		const form = host.querySelector( 'wpd-form' )! as HTMLElement & {
			submit: () => void;
		};
		let fired = 0;
		form.addEventListener( 'wpd-form-submit', () => fired++ );
		form.submit();
		expect( fired ).toBe( 0 );
		const username = host.querySelector( 'wpd-text-field[name="username"]' )!;
		expect( username.hasAttribute( 'invalid' ) ).toBe( true );
		const email = host.querySelector( 'wpd-text-field[name="email"]' )!;
		expect( email.hasAttribute( 'invalid' ) ).toBe( false );
		// Form-level error shown.
		expect( form.getAttribute( 'error' ) ).toContain( 'Username' );
	} );

	test( 'setFieldInvalid + clearErrors round-trip', async () => {
		host.innerHTML = `
			<wpd-form>
				<wpd-text-field name="email" label="Email" value="x@y"></wpd-text-field>
			</wpd-form>
		`;
		await tick();
		const form = host.querySelector( 'wpd-form' )! as HTMLElement & {
			setFieldInvalid: ( name: string, invalid?: boolean ) => void;
			clearErrors: () => void;
		};
		form.setFieldInvalid( 'email' );
		const email = host.querySelector( 'wpd-text-field[name="email"]' )!;
		expect( email.hasAttribute( 'invalid' ) ).toBe( true );
		form.clearErrors();
		expect( email.hasAttribute( 'invalid' ) ).toBe( false );
	} );

	test( 'reset() restores the initial value snapshot', async () => {
		host.innerHTML = `
			<wpd-form>
				<wpd-text-field name="title" value="Initial"></wpd-text-field>
			</wpd-form>
		`;
		await tick();
		await wait( 0 );
		const form = host.querySelector( 'wpd-form' )! as HTMLElement & {
			setValues: ( v: Record< string, unknown > ) => void;
			reset: () => void;
		};
		form.setValues( { title: 'Changed' } );
		const field = host.querySelector( 'wpd-text-field[name="title"]' )!;
		expect( ( field as HTMLElement & { value: string } ).value ).toBe( 'Changed' );
		form.reset();
		expect( ( field as HTMLElement & { value: string } ).value ).toBe( 'Initial' );
	} );

	test( 'rebroadcasts descendant input events as wpd-form-input', async () => {
		host.innerHTML = `
			<wpd-form>
				<wpd-text-field name="title" value=""></wpd-text-field>
			</wpd-form>
		`;
		await tick();
		const form = host.querySelector( 'wpd-form' )!;
		let detail: { name: string; value: unknown } | null = null;
		form.addEventListener( 'wpd-form-input', ( e ) => {
			detail = ( e as CustomEvent ).detail;
		} );
		const field = host.querySelector( 'wpd-text-field[name="title"]' )!;
		const input = field.shadowRoot!.querySelector( 'input' )!;
		input.value = 'hi';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		expect( detail ).not.toBeNull();
		expect( detail!.name ).toBe( 'title' );
		expect( detail!.value ).toBe( 'hi' );
	} );

	test( 'setBusy adds/removes the busy attribute', async () => {
		host.innerHTML = `<wpd-form></wpd-form>`;
		await tick();
		const form = host.querySelector( 'wpd-form' )! as HTMLElement & {
			setBusy: ( b: boolean ) => void;
		};
		form.setBusy( true );
		expect( form.hasAttribute( 'busy' ) ).toBe( true );
		form.setBusy( false );
		expect( form.hasAttribute( 'busy' ) ).toBe( false );
	} );
} );
