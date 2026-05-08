/**
 * `<wpd-confirm-dialog>` + `wpdConfirm()` tests.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

async function load() {
	return await import( './wpd-confirm-dialog' );
}

describe( 'wpd-confirm-dialog', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
	} );
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'wpdConfirm resolves true when the confirm button is clicked', async () => {
		const { wpdConfirm } = await load();
		const promise = wpdConfirm( { message: 'Are you sure?' } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'wpd-confirm-dialog' );
		expect( dialog ).not.toBeNull();
		const confirmBtn = dialog!.shadowRoot!.querySelector< HTMLButtonElement >(
			'.btn--primary',
		);
		confirmBtn!.click();
		await expect( promise ).resolves.toBe( true );
		expect( document.querySelector( 'wpd-confirm-dialog' ) ).toBeNull();
	} );

	test( 'wpdConfirm resolves false when the cancel button is clicked', async () => {
		const { wpdConfirm } = await load();
		const promise = wpdConfirm( { message: 'Are you sure?' } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'wpd-confirm-dialog' );
		const cancelBtn = dialog!.shadowRoot!.querySelector< HTMLButtonElement >(
			'.btn--secondary',
		);
		cancelBtn!.click();
		await expect( promise ).resolves.toBe( false );
	} );

	test( 'Escape key cancels', async () => {
		const { wpdConfirm } = await load();
		const promise = wpdConfirm( { message: 'X' } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'wpd-confirm-dialog' );
		dialog!.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		await expect( promise ).resolves.toBe( false );
	} );

	test( 'Enter key confirms', async () => {
		const { wpdConfirm } = await load();
		const promise = wpdConfirm( { message: 'X' } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'wpd-confirm-dialog' );
		dialog!.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ) );
		await expect( promise ).resolves.toBe( true );
	} );

	test( 'danger flag toggles the danger class on the confirm button', async () => {
		const { wpdConfirm } = await load();
		const promise = wpdConfirm( { message: 'X', danger: true } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'wpd-confirm-dialog' );
		const confirmBtn = dialog!.shadowRoot!.querySelector< HTMLButtonElement >(
			'.btn--danger',
		);
		expect( confirmBtn ).not.toBeNull();
		confirmBtn!.click();
		await promise;
	} );

	test( 'custom labels render', async () => {
		const { wpdConfirm } = await load();
		const promise = wpdConfirm( {
			message: 'X',
			confirmLabel: 'Yes please',
			cancelLabel: 'No thanks',
		} );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'wpd-confirm-dialog' );
		const buttons = dialog!.shadowRoot!.querySelectorAll< HTMLButtonElement >( '.btn' );
		const labels = Array.from( buttons ).map( ( b ) => b.textContent?.trim() );
		expect( labels ).toContain( 'Yes please' );
		expect( labels ).toContain( 'No thanks' );
		buttons[ 0 ].click();
		await promise;
	} );

	test( 'backdrop click cancels (clicking dialog body does not)', async () => {
		const { wpdConfirm } = await load();
		const promise = wpdConfirm( { message: 'X' } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'wpd-confirm-dialog' )!;
		// Click on the dialog inner (target inside the shadow): should not close.
		const inner = dialog.shadowRoot!.querySelector< HTMLElement >( '.dialog' )!;
		inner.click();
		expect( document.querySelector( 'wpd-confirm-dialog' ) ).not.toBeNull();
		// Click on the host (backdrop): closes.
		dialog.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		await expect( promise ).resolves.toBe( false );
	} );
} );
