/**
 * Tests for the inline "New folder" / "Rename" dialog (replaces
 * window.prompt).
 *
 * The name field is an `<os-text-field>`, not a raw `<input>` —
 * deliberately, because core's `forms.css` reaches every raw input
 * in the parent shell and repaints it as a white core-chrome box on
 * the dialog's dark surface. `assertsNoRawInput` below is the guard:
 * if someone swaps the component back out for a plain input, that is
 * the regression, and it is invisible in a unit test otherwise.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

async function load() {
	vi.resetModules();
	return await import( '../../src/desktop-files/create-folder-dialog' );
}

/** The dialog's name field, as the component element. */
function field() {
	return document.querySelector< HTMLElement & { value: string } >(
		'os-text-field.os-create-folder-dialog__field',
	);
}

/** The primary (Create / Rename) button. */
function primary() {
	return document.querySelector< HTMLElement >(
		'.os-create-folder-dialog__btn--primary',
	)!;
}

/** Let the component render and the focus retry land. */
async function settle() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe( 'create-folder dialog', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'renders its controls as os-* components, never raw inputs', async () => {
		const mod = await load();
		mod.openCreateFolderDialog( { onSubmit: () => undefined } );
		const dialog = document.querySelector( '.os-create-folder-dialog' )!;
		// Core's forms.css outranks any single class of ours, so a raw
		// control here would come out as white core chrome.
		expect( dialog.querySelector( 'input' ) ).toBeNull();
		expect( dialog.querySelector( 'button' ) ).toBeNull();
		expect( field() ).not.toBeNull();
		expect( primary().tagName.toLowerCase() ).toBe( 'os-button' );
	} );

	test( 'opens with the field focused and its value selected', async () => {
		const mod = await load();
		mod.openCreateFolderDialog( { onSubmit: () => undefined } );
		await settle();
		const el = field()!;
		expect( el.value ).toBe( 'Untitled folder' );
		// Focus inside a shadow root surfaces as the host element.
		expect( document.activeElement ).toBe( el );
		const inner = el.shadowRoot!.querySelector< HTMLInputElement >( 'input' )!;
		expect( inner.selectionStart ).toBe( 0 );
		expect( inner.selectionEnd ).toBe( 'Untitled folder'.length );
	} );

	test( 'submit invokes onSubmit with trimmed name + closes', async () => {
		const mod = await load();
		const onSubmit = vi.fn().mockResolvedValue( undefined );
		mod.openCreateFolderDialog( { onSubmit } );
		await settle();
		field()!.value = '  Projects  ';
		primary().click();
		await settle();
		expect( onSubmit ).toHaveBeenCalledWith( 'Projects' );
		expect( document.querySelector( '.os-create-folder-dialog' ) ).toBeNull();
	} );

	test( 'typing in the field is what submit reads', async () => {
		const mod = await load();
		const onSubmit = vi.fn().mockResolvedValue( undefined );
		mod.openCreateFolderDialog( { onSubmit, initialName: 'Old name' } );
		await settle();
		const inner = field()!.shadowRoot!.querySelector< HTMLInputElement >( 'input' )!;
		inner.value = 'New name';
		inner.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		primary().click();
		await settle();
		expect( onSubmit ).toHaveBeenCalledWith( 'New name' );
	} );

	test( 'empty name shows error and does not submit', async () => {
		const mod = await load();
		const onSubmit = vi.fn();
		mod.openCreateFolderDialog( { onSubmit } );
		await settle();
		field()!.value = '   ';
		primary().click();
		expect( onSubmit ).not.toHaveBeenCalled();
		expect(
			document.querySelector< HTMLElement >(
				'.os-create-folder-dialog__error',
			)!.hidden,
		).toBe( false );
	} );

	test( 'Escape cancels and fires onCancel', async () => {
		const mod = await load();
		const onCancel = vi.fn();
		mod.openCreateFolderDialog( { onSubmit: () => undefined, onCancel } );
		const dialog = document.querySelector< HTMLElement >(
			'.os-create-folder-dialog',
		)!;
		dialog.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
		);
		expect( onCancel ).toHaveBeenCalledTimes( 1 );
		expect( document.querySelector( '.os-create-folder-dialog' ) ).toBeNull();
	} );

	test( 'Enter inside the dialog submits', async () => {
		const mod = await load();
		const onSubmit = vi.fn().mockResolvedValue( undefined );
		mod.openCreateFolderDialog( { onSubmit } );
		await settle();
		const el = field()!;
		el.value = 'Quick';
		// Composed keyboard events cross the shadow boundary, which is
		// what the dialog's own keydown listener relies on.
		el.shadowRoot!.querySelector< HTMLInputElement >( 'input' )!.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Enter',
				bubbles: true,
				composed: true,
			} ),
		);
		await settle();
		expect( onSubmit ).toHaveBeenCalledWith( 'Quick' );
	} );

	test( 'overlay click cancels (clicking on the dialog itself does not)', async () => {
		const mod = await load();
		const onCancel = vi.fn();
		mod.openCreateFolderDialog( { onSubmit: () => undefined, onCancel } );
		const overlay = document.querySelector< HTMLElement >(
			'.os-create-folder-dialog__overlay',
		)!;
		const dialog = overlay.querySelector< HTMLElement >(
			'.os-create-folder-dialog',
		)!;
		// Clicking the dialog body should not close.
		dialog.click();
		expect( document.querySelector( '.os-create-folder-dialog' ) ).not.toBeNull();
		// Clicking the overlay should.
		overlay.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		// Need to dispatch with the overlay as the actual target — `.click()` would target the overlay too.
		expect( document.querySelector( '.os-create-folder-dialog' ) ).toBeNull();
		expect( onCancel ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'submit error path reports the message and stays open', async () => {
		const mod = await load();
		const onSubmit = vi.fn().mockRejectedValue( new Error( 'Boom' ) );
		mod.openCreateFolderDialog( { onSubmit } );
		await settle();
		primary().click();
		await settle();
		const err = document.querySelector< HTMLElement >(
			'.os-create-folder-dialog__error',
		)!;
		expect( err.hidden ).toBe( false );
		expect( err.textContent ).toBe( 'Boom' );
		expect( document.querySelector( '.os-create-folder-dialog' ) ).not.toBeNull();
	} );

	test( 'create-folder.dialog filter returning false suppresses the built-in', async () => {
		const mod = await load();
		const stub = ( window.wp as { hooks: { addFilter: ( ...a: unknown[] ) => void } } ).hooks;
		stub.addFilter(
			'os.files.create-folder.dialog',
			'test/own',
			() => false,
		);
		mod.openCreateFolderDialog( { onSubmit: () => undefined } );
		expect( document.querySelector( '.os-create-folder-dialog' ) ).toBeNull();
	} );

	test( 'opening twice replaces the existing dialog', async () => {
		const mod = await load();
		mod.openCreateFolderDialog( { onSubmit: () => undefined, initialName: 'A' } );
		mod.openCreateFolderDialog( { onSubmit: () => undefined, initialName: 'B' } );
		await settle();
		const fields = document.querySelectorAll< HTMLElement & { value: string } >(
			'os-text-field.os-create-folder-dialog__field',
		);
		expect( fields.length ).toBe( 1 );
		expect( fields[ 0 ].value ).toBe( 'B' );
	} );
} );
