import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { OsForm } from './os-form';
import type { OsTagInput } from '../os-tag-input/os-tag-input';
import './os-form';
import '../os-switch/os-switch';
import '../os-range-field/os-range-field';
import '../os-color-field/os-color-field';
import '../os-tag-input/os-tag-input';
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
	test( 'round-trips and resets switches and structured tag values', async () => {
		host.innerHTML = `<os-form>
			<os-switch name="pinned" checked></os-switch>
			<os-tag-input name="tags"></os-tag-input>
		</os-form>`;
		const form = host.querySelector< OsForm >( 'os-form' )!;
		const tags = host.querySelector( 'os-tag-input' )! as HTMLElement & { value: { label: string }[] };
		tags.value = [ { label: 'Initial' } ];
		await tick();
		expect( form.getValues() ).toEqual( { pinned: true, tags: [ { label: 'Initial' } ] } );
		form.setValues( { pinned: false, tags: [ { label: 'Changed' } ] } );
		expect( form.getValues() ).toEqual( { pinned: false, tags: [ { label: 'Changed' } ] } );
		expect( tags.hasAttribute( 'value' ) ).toBe( false );
		form.reset();
		expect( form.getValues() ).toEqual( { pinned: true, tags: [ { label: 'Initial' } ] } );
		form.setValues( { pinned: false, tags: [] } );
		expect( form.getValues() ).toEqual( { pinned: false, tags: [] } );
	} );

	test( 'busy blocks Enter and programmatic duplicate submission, and makes fields inert', async () => {
		host.innerHTML = `<os-form><os-text-field name="title" value="Saved"></os-text-field></os-form>`;
		const form = host.querySelector< OsForm >( 'os-form' )!;
		let submissions = 0;
		form.addEventListener( 'os-form-submit', () => {
			submissions++; form.setBusy( true );
		} );
		form.submit();
		form.submit();
		form.querySelector( 'os-text-field' )!.dispatchEvent( new CustomEvent( 'os-submit', { bubbles: true } ) );
		await tick();
		expect( submissions ).toBe( 1 );
		expect( form.shadowRoot!.querySelector( '.fields' )!.hasAttribute( 'inert' ) ).toBe( true );
		form.setBusy( false );
		await tick();
		expect( form.shadowRoot!.querySelector( '.fields' )!.hasAttribute( 'inert' ) ).toBe( false );
		form.submit();
		expect( submissions ).toBe( 2 );
	} );

	test( 'tag edits cannot mutate the initial snapshot, including after a reset', async () => {
		host.innerHTML = '<os-form><os-tag-input name="tags"></os-tag-input></os-form>';
		const form = host.querySelector< OsForm >( 'os-form' )!;
		const tags = host.querySelector< OsTagInput >( 'os-tag-input' )!;
		tags.value = [ { id: 7, label: 'Initial' } ];
		await tick();

		for ( let attempt = 0; attempt < 2; attempt++ ) {
			const values = form.getValues().tags as OsTagInput[ 'value' ];
			values[ 0 ].label = 'Edited';
			values.push( { label: 'Added' } );
			tags.value = values;
			form.reset();
			expect( tags.value ).toEqual( [ { id: 7, label: 'Initial' } ] );
		}
	} );

	test( 'busy preserves field disabled settings when cleared', async () => {
		host.innerHTML = `<os-form>
			<os-text-field name="editable" value="Keep"></os-text-field>
			<os-text-field name="locked" value="Locked" disabled></os-text-field>
		</os-form>`;
		const form = host.querySelector< OsForm >( 'os-form' )!;
		form.setBusy( true );
		await tick();
		form.setBusy( false );
		await tick();
		expect( form.querySelector( '[name="editable"]' )!.hasAttribute( 'disabled' ) ).toBe( false );
		expect( form.querySelector( '[name="locked"]' )!.hasAttribute( 'disabled' ) ).toBe( true );
		expect( form.getValues() ).toEqual( { editable: 'Keep', locked: 'Locked' } );
	} );

	test( 'forwards real slider and color changes to the form input bus', async () => {
		host.innerHTML = `<os-form><os-range-field name="progress"></os-range-field><os-color-field name="color"></os-color-field></os-form>`;
		await tick();
		const form = host.querySelector< OsForm >( 'os-form' )!;
		const changes: unknown[] = [];
		form.addEventListener( 'os-form-input', ( event ) => {
			const { name, value } = ( event as CustomEvent ).detail;
			changes.push( { name, value } );
		} );
		for ( const [ tag, value ] of [ [ 'os-range-field', '65' ], [ 'os-color-field', '#cc3344' ] ] ) {
			const input = form.querySelector( tag )!.shadowRoot!.querySelector( 'input' )!;
			input.value = value;
			input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		}
		expect( changes ).toEqual( [ { name: 'progress', value: '65' }, { name: 'color', value: '#cc3344' } ] );
	} );
} );
