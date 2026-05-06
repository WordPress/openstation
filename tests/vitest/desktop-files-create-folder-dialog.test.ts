/**
 * Tests for the inline "New folder" dialog (replaces window.prompt).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

async function load() {
	vi.resetModules();
	return await import( '../../src/desktop-files/create-folder-dialog' );
}

describe( 'create-folder dialog', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'opens with the input focused and selected', async () => {
		const mod = await load();
		mod.openCreateFolderDialog( { onSubmit: () => undefined } );
		const input = document.querySelector< HTMLInputElement >(
			'.desktop-mode-create-folder-dialog__input',
		);
		expect( input ).not.toBeNull();
		expect( document.activeElement ).toBe( input );
		expect( input!.value ).toBe( 'Untitled folder' );
	} );

	test( 'submit invokes onSubmit with trimmed name + closes', async () => {
		const mod = await load();
		const onSubmit = vi.fn().mockResolvedValue( undefined );
		mod.openCreateFolderDialog( { onSubmit } );
		const input = document.querySelector< HTMLInputElement >(
			'.desktop-mode-create-folder-dialog__input',
		)!;
		input.value = '  Projects  ';
		document
			.querySelector< HTMLButtonElement >(
				'.desktop-mode-create-folder-dialog__btn--primary',
			)!
			.click();
		await Promise.resolve();
		await Promise.resolve();
		expect( onSubmit ).toHaveBeenCalledWith( 'Projects' );
		expect( document.querySelector( '.desktop-mode-create-folder-dialog' ) ).toBeNull();
	} );

	test( 'empty name shows error and does not submit', async () => {
		const mod = await load();
		const onSubmit = vi.fn();
		mod.openCreateFolderDialog( { onSubmit } );
		const input = document.querySelector< HTMLInputElement >(
			'.desktop-mode-create-folder-dialog__input',
		)!;
		input.value = '   ';
		document
			.querySelector< HTMLButtonElement >(
				'.desktop-mode-create-folder-dialog__btn--primary',
			)!
			.click();
		expect( onSubmit ).not.toHaveBeenCalled();
		expect(
			document.querySelector< HTMLElement >(
				'.desktop-mode-create-folder-dialog__error',
			)!.hidden,
		).toBe( false );
	} );

	test( 'Escape cancels and fires onCancel', async () => {
		const mod = await load();
		const onCancel = vi.fn();
		mod.openCreateFolderDialog( { onSubmit: () => undefined, onCancel } );
		const dialog = document.querySelector< HTMLElement >(
			'.desktop-mode-create-folder-dialog',
		)!;
		dialog.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
		);
		expect( onCancel ).toHaveBeenCalledTimes( 1 );
		expect( document.querySelector( '.desktop-mode-create-folder-dialog' ) ).toBeNull();
	} );

	test( 'Enter inside the dialog submits', async () => {
		const mod = await load();
		const onSubmit = vi.fn().mockResolvedValue( undefined );
		mod.openCreateFolderDialog( { onSubmit } );
		const input = document.querySelector< HTMLInputElement >(
			'.desktop-mode-create-folder-dialog__input',
		)!;
		input.value = 'Quick';
		input.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ),
		);
		await Promise.resolve();
		await Promise.resolve();
		expect( onSubmit ).toHaveBeenCalledWith( 'Quick' );
	} );

	test( 'overlay click cancels (clicking on the dialog itself does not)', async () => {
		const mod = await load();
		const onCancel = vi.fn();
		mod.openCreateFolderDialog( { onSubmit: () => undefined, onCancel } );
		const overlay = document.querySelector< HTMLElement >(
			'.desktop-mode-create-folder-dialog__overlay',
		)!;
		const dialog = overlay.querySelector< HTMLElement >(
			'.desktop-mode-create-folder-dialog',
		)!;
		// Clicking the dialog body should not close.
		dialog.click();
		expect( document.querySelector( '.desktop-mode-create-folder-dialog' ) ).not.toBeNull();
		// Clicking the overlay should.
		overlay.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		// Need to dispatch with the overlay as the actual target — `.click()` would target the overlay too.
		expect( document.querySelector( '.desktop-mode-create-folder-dialog' ) ).toBeNull();
		expect( onCancel ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'submit error path reports the message and stays open', async () => {
		const mod = await load();
		const onSubmit = vi.fn().mockRejectedValue( new Error( 'Boom' ) );
		mod.openCreateFolderDialog( { onSubmit } );
		document
			.querySelector< HTMLButtonElement >(
				'.desktop-mode-create-folder-dialog__btn--primary',
			)!
			.click();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		const err = document.querySelector< HTMLElement >(
			'.desktop-mode-create-folder-dialog__error',
		)!;
		expect( err.hidden ).toBe( false );
		expect( err.textContent ).toBe( 'Boom' );
		expect( document.querySelector( '.desktop-mode-create-folder-dialog' ) ).not.toBeNull();
	} );

	test( 'create-folder.dialog filter returning false suppresses the built-in', async () => {
		const mod = await load();
		const stub = ( window.wp as { hooks: { addFilter: ( ...a: unknown[] ) => void } } ).hooks;
		stub.addFilter(
			'desktop-mode.files.create-folder.dialog',
			'test/own',
			() => false,
		);
		mod.openCreateFolderDialog( { onSubmit: () => undefined } );
		expect( document.querySelector( '.desktop-mode-create-folder-dialog' ) ).toBeNull();
	} );

	test( 'opening twice replaces the existing dialog', async () => {
		const mod = await load();
		mod.openCreateFolderDialog( { onSubmit: () => undefined, initialName: 'A' } );
		mod.openCreateFolderDialog( { onSubmit: () => undefined, initialName: 'B' } );
		const inputs = document.querySelectorAll< HTMLInputElement >(
			'.desktop-mode-create-folder-dialog__input',
		);
		expect( inputs.length ).toBe( 1 );
		expect( inputs[ 0 ].value ).toBe( 'B' );
	} );
} );
