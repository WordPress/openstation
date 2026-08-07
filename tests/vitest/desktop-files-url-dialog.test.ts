/**
 * Tests for the "New web link / window" dialog.
 *
 * Shares its surface classes — and now its control components and
 * field plumbing — with the create-folder / rename dialog, so the
 * two look and behave like one dialog system. The raw-control guard
 * is the same one that file carries, for the same reason: core's
 * `forms.css` reaches raw inputs in the parent shell and repaints
 * them as white core chrome on this dark surface.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

async function load() {
	vi.resetModules();
	return await import( '../../src/desktop-files/url-dialog' );
}

function fields() {
	return document.querySelectorAll< HTMLElement & { value: string } >(
		'os-text-field.os-create-folder-dialog__field',
	);
}

function primary() {
	return document.querySelector< HTMLElement >(
		'.os-create-folder-dialog__btn--primary',
	)!;
}

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

const open = ( over: Record< string, unknown > = {} ) => ( {
	title: 'New web link',
	onSubmit: vi.fn().mockResolvedValue( undefined ),
	...over,
} );

describe( 'url dialog', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'renders its controls as os-* components, never raw inputs', async () => {
		const mod = await load();
		mod.openUrlDialog( open() as never );
		const dialog = document.querySelector( '.os-create-folder-dialog' )!;
		expect( dialog.querySelector( 'input' ) ).toBeNull();
		expect( dialog.querySelector( 'button' ) ).toBeNull();
		expect( fields().length ).toBe( 2 );
		expect( primary().tagName.toLowerCase() ).toBe( 'os-button' );
	} );

	test( 'opens with the name field focused', async () => {
		const mod = await load();
		mod.openUrlDialog( open( { initialName: 'Docs' } ) as never );
		await settle();
		expect( document.activeElement ).toBe( fields()[ 0 ] );
	} );

	test( 'submits name + URL, coercing a bare hostname to https', async () => {
		const mod = await load();
		const onSubmit = vi.fn().mockResolvedValue( undefined );
		mod.openUrlDialog( open( { onSubmit } ) as never );
		await settle();
		const [ nameField, urlField ] = Array.from( fields() );
		nameField.value = '  Docs  ';
		urlField.value = 'example.com/handbook';
		primary().click();
		await settle();
		expect( onSubmit ).toHaveBeenCalledWith( {
			name: 'Docs',
			url: 'https://example.com/handbook',
		} );
		expect( document.querySelector( '.os-create-folder-dialog' ) ).toBeNull();
	} );

	test( 'an empty URL errors and keeps the dialog open', async () => {
		const mod = await load();
		const onSubmit = vi.fn();
		mod.openUrlDialog( open( { onSubmit, initialUrl: '' } ) as never );
		await settle();
		primary().click();
		await settle();
		expect( onSubmit ).not.toHaveBeenCalled();
		expect(
			document.querySelector< HTMLElement >(
				'.os-create-folder-dialog__error',
			)!.hidden,
		).toBe( false );
		expect( document.querySelector( '.os-create-folder-dialog' ) ).not.toBeNull();
	} );

	test( 'a failing submit re-enables the controls so the user can retry', async () => {
		const mod = await load();
		const onSubmit = vi.fn().mockRejectedValue( new Error( 'Nope' ) );
		mod.openUrlDialog( open( { onSubmit, initialUrl: 'https://a.test' } ) as never );
		await settle();
		primary().click();
		await settle();
		expect(
			document.querySelector< HTMLElement >(
				'.os-create-folder-dialog__error',
			)!.textContent,
		).toBe( 'Nope' );
		for ( const el of Array.from( fields() ) ) {
			expect( el.hasAttribute( 'disabled' ) ).toBe( false );
		}
		expect( primary().hasAttribute( 'disabled' ) ).toBe( false );
	} );

	test( 'Escape cancels and fires onCancel', async () => {
		const mod = await load();
		const onCancel = vi.fn();
		mod.openUrlDialog( open( { onCancel } ) as never );
		document
			.querySelector< HTMLElement >( '.os-create-folder-dialog' )!
			.dispatchEvent(
				new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
			);
		expect( onCancel ).toHaveBeenCalledTimes( 1 );
		expect( document.querySelector( '.os-create-folder-dialog' ) ).toBeNull();
	} );

	test( 'url-dialog filter returning false suppresses the built-in', async () => {
		const mod = await load();
		const stub = ( window.wp as { hooks: { addFilter: ( ...a: unknown[] ) => void } } ).hooks;
		stub.addFilter( 'os.files.url-dialog', 'test/own', () => false );
		mod.openUrlDialog( open() as never );
		expect( document.querySelector( '.os-create-folder-dialog' ) ).toBeNull();
	} );
} );
