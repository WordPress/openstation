/**
 * `<os-confirm-dialog>` + `osConfirm()` tests.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

async function load() {
	return await import( './os-confirm-dialog' );
}

/** Flush the microtask hops the component's render + focus take. */
function tick() {
	return new Promise( ( r ) => setTimeout( r, 0 ) );
}

describe( 'os-confirm-dialog', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
	} );
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'osConfirm resolves true when the confirm button is clicked', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'Are you sure?' } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' );
		expect( dialog ).not.toBeNull();
		const confirmBtn = dialog!.shadowRoot!.querySelector< HTMLButtonElement >(
			'.btn--primary',
		);
		confirmBtn!.click();
		await expect( promise ).resolves.toBe( true );
		expect( document.querySelector( 'os-confirm-dialog' ) ).toBeNull();
	} );

	test( 'osConfirm resolves false when the cancel button is clicked', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'Are you sure?' } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' );
		const cancelBtn = dialog!.shadowRoot!.querySelector< HTMLButtonElement >(
			'.btn--secondary',
		);
		cancelBtn!.click();
		await expect( promise ).resolves.toBe( false );
	} );

	test( 'Escape key cancels', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'X' } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' );
		dialog!.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		await expect( promise ).resolves.toBe( false );
	} );

	test( 'Enter key confirms', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'X' } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' );
		dialog!.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ) );
		await expect( promise ).resolves.toBe( true );
	} );

	test( 'danger flag toggles the danger class on the confirm button', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'X', danger: true } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' );
		const confirmBtn = dialog!.shadowRoot!.querySelector< HTMLButtonElement >(
			'.btn--danger',
		);
		expect( confirmBtn ).not.toBeNull();
		confirmBtn!.click();
		await promise;
	} );

	test( 'custom labels render', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( {
			message: 'X',
			confirmLabel: 'Yes please',
			cancelLabel: 'No thanks',
		} );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' );
		const buttons = dialog!.shadowRoot!.querySelectorAll< HTMLButtonElement >( '.btn' );
		const labels = Array.from( buttons ).map( ( b ) => b.textContent?.trim() );
		expect( labels ).toContain( 'Yes please' );
		expect( labels ).toContain( 'No thanks' );
		buttons[ 0 ].click();
		await promise;
	} );

	test( 'backdrop click cancels (clicking dialog body does not)', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'X' } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		// Click on the dialog inner (target inside the shadow): should not close.
		const inner = dialog.shadowRoot!.querySelector< HTMLElement >( '.dialog' )!;
		inner.click();
		expect( document.querySelector( 'os-confirm-dialog' ) ).not.toBeNull();
		// Click on the host (backdrop): closes.
		dialog.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		await expect( promise ).resolves.toBe( false );
	} );

	test( 'hideCancel hides the cancel button entirely', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'X', hideCancel: true } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		const cancelBtn = dialog.shadowRoot!.querySelector< HTMLButtonElement >( '.btn--secondary' );
		expect( cancelBtn ).toBeNull();
		// Confirm still works.
		const confirmBtn = dialog.shadowRoot!.querySelector< HTMLButtonElement >( '.btn--primary' );
		expect( confirmBtn ).not.toBeNull();
		confirmBtn!.click();
		await expect( promise ).resolves.toBe( true );
	} );

	test( 'dismissable renders an X close button that emits cancel', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( {
			message: 'X',
			hideCancel: true,
			dismissable: true,
		} );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		const closeBtn = dialog.shadowRoot!.querySelector< HTMLButtonElement >( '.close' );
		expect( closeBtn ).not.toBeNull();
		expect( closeBtn!.getAttribute( 'aria-label' ) ).toBe( 'Close' );
		closeBtn!.click();
		await expect( promise ).resolves.toBe( false );
	} );

	test( 'opening moves focus onto the confirm button', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'X' } );
		await tick();
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		const confirmBtn = dialog.shadowRoot!.querySelector( '.btn--primary' );
		expect( dialog.shadowRoot!.activeElement ).toBe( confirmBtn );
		dialog.shadowRoot!.querySelector< HTMLButtonElement >( '.btn--secondary' )!.click();
		await promise;
	} );

	test( 'a danger dialog opens on cancel, not on the destructive button', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'X', danger: true } );
		await tick();
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		const cancelBtn = dialog.shadowRoot!.querySelector( '.btn--secondary' );
		expect( dialog.shadowRoot!.activeElement ).toBe( cancelBtn );
		( cancelBtn as HTMLButtonElement ).click();
		await expect( promise ).resolves.toBe( false );
	} );

	test( 'the host is programmatically focusable but not tab-reachable', async () => {
		// The last-resort focus target if the first render is ever slow
		// enough to outrun the retry — the host carries the keydown
		// listener, so Escape and the trap survive.
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'X' } );
		await tick();
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		expect( dialog.getAttribute( 'tabindex' ) ).toBe( '-1' );
		dialog.shadowRoot!.querySelector< HTMLButtonElement >( '.btn--secondary' )!.click();
		await promise;
	} );

	test( 'a danger dialog with hideCancel opens on the X, not the destructive button', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( {
			message: 'X',
			danger: true,
			hideCancel: true,
			dismissable: true,
		} );
		await tick();
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		const closeBtn = dialog.shadowRoot!.querySelector( '.close' );
		expect( dialog.shadowRoot!.activeElement ).toBe( closeBtn );
		( closeBtn as HTMLButtonElement ).click();
		await expect( promise ).resolves.toBe( false );
	} );

	test( 'a danger dialog with no safe control never focuses or Enter-fires the destructive button', async () => {
		const { osConfirm } = await load();
		let settled: boolean | null = null;
		const promise = osConfirm( {
			message: 'X',
			danger: true,
			hideCancel: true,
		} ).then( ( v ) => {
			settled = v;
			return v;
		} );
		await tick();
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		const dangerBtn = dialog.shadowRoot!.querySelector< HTMLButtonElement >(
			'.btn--danger',
		)!;
		// Nothing safe to open on, so the container holds focus — the
		// destructive button must not.
		expect( dialog.shadowRoot!.activeElement ).not.toBe( dangerBtn );
		// …and the container has no default action on a danger dialog.
		dialog.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ),
		);
		await tick();
		expect( settled ).toBeNull();
		expect( document.querySelector( 'os-confirm-dialog' ) ).not.toBeNull();
		// Reaching it has to be deliberate.
		dangerBtn.click();
		await expect( promise ).resolves.toBe( true );
	} );

	test( 'Enter on the focused cancel button does not confirm', async () => {
		const { osConfirm } = await load();
		let settled: boolean | null = null;
		const promise = osConfirm( { message: 'X', danger: true } ).then( ( v ) => {
			settled = v;
			return v;
		} );
		await tick();
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		const cancelBtn = dialog.shadowRoot!.querySelector< HTMLButtonElement >(
			'.btn--secondary',
		)!;
		cancelBtn.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Enter',
				bubbles: true,
				composed: true,
			} ),
		);
		await tick();
		// The dialog stays up and nothing was confirmed — the button
		// owns Enter, and in a real browser activates itself.
		expect( settled ).toBeNull();
		expect( document.querySelector( 'os-confirm-dialog' ) ).not.toBeNull();
		cancelBtn.click();
		await expect( promise ).resolves.toBe( false );
	} );

	test( 'Escape cancels while a button inside the dialog has focus', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'X' } );
		await tick();
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		const confirmBtn = dialog.shadowRoot!.querySelector< HTMLButtonElement >(
			'.btn--primary',
		)!;
		confirmBtn.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Escape',
				bubbles: true,
				composed: true,
			} ),
		);
		await expect( promise ).resolves.toBe( false );
	} );

	test( 'Tab wraps from the last control back to the first', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'X' } );
		await tick();
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		const buttons = Array.from(
			dialog.shadowRoot!.querySelectorAll< HTMLButtonElement >( '.btn' ),
		);
		const first = buttons[ 0 ];
		const last = buttons[ buttons.length - 1 ];
		last.focus();
		last.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Tab', bubbles: true, composed: true } ),
		);
		expect( dialog.shadowRoot!.activeElement ).toBe( first );
		// …and backwards off the first lands on the last.
		first.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Tab',
				shiftKey: true,
				bubbles: true,
				composed: true,
			} ),
		);
		expect( dialog.shadowRoot!.activeElement ).toBe( last );
		first.click();
		await promise;
	} );

	test( 'closing restores focus to whatever opened the dialog', async () => {
		const { osConfirm } = await load();
		const opener = document.createElement( 'button' );
		document.body.appendChild( opener );
		opener.focus();
		const promise = osConfirm( { message: 'X' } );
		await tick();
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		expect( opener.ownerDocument.activeElement ).toBe( dialog );
		dialog.shadowRoot!.querySelector< HTMLButtonElement >( '.btn--secondary' )!.click();
		await promise;
		expect( opener.ownerDocument.activeElement ).toBe( opener );
	} );

	test( 'without dismissable, the close button is absent', async () => {
		const { osConfirm } = await load();
		const promise = osConfirm( { message: 'X' } );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const dialog = document.querySelector< HTMLElement >( 'os-confirm-dialog' )!;
		expect( dialog.shadowRoot!.querySelector( '.close' ) ).toBeNull();
		// Tear down to avoid a dangling Promise.
		dialog.shadowRoot!.querySelector< HTMLButtonElement >( '.btn--secondary' )!.click();
		await promise;
	} );
} );
