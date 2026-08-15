/**
 * `<os-field-row>` — the part worth testing is the wiring it does to
 * a control it does not own.
 *
 * A `<label for>` in a shadow root cannot reference a light-DOM
 * child; that pairing does not cross the boundary. This component
 * exists to close that gap by reaching out to the control, and every
 * test here is about doing so without trampling what the consumer
 * already set.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-field-row';

const tick = async (): Promise< void > => {
	// Two turns: one for the render, one for the `queueMicrotask`
	// the render schedules to re-sync the control.
	await Promise.resolve();
	await Promise.resolve();
};

describe( '<os-field-row>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => {
		host.remove();
	} );

	function row(): HTMLElement {
		return host.querySelector( 'os-field-row' ) as HTMLElement;
	}
	function input(): HTMLInputElement {
		return host.querySelector( 'input' ) as HTMLInputElement;
	}

	test( 'points the control at the hint through aria-describedby', async () => {
		host.innerHTML = `<os-field-row label="Key" hint="Found under Account"><input /></os-field-row>`;
		await tick();

		const described = input().getAttribute( 'aria-describedby' ) ?? '';
		const hint = row().shadowRoot!.querySelector( '.os-field-row__hint' )!;
		expect( described ).toContain( hint.id );
		expect( hint.textContent?.trim() ).toBe( 'Found under Account' );
	} );

	test( 'an error replaces the hint and marks the control invalid', async () => {
		host.innerHTML = `<os-field-row label="Key" hint="Found under Account"><input /></os-field-row>`;
		await tick();
		row().setAttribute( 'error', 'Required' );
		await tick();

		const shadow = row().shadowRoot!;
		expect( shadow.querySelector( '.os-field-row__hint' ) ).toBeNull();
		const error = shadow.querySelector( '.os-field-row__error' )!;
		expect( error.getAttribute( 'role' ) ).toBe( 'alert' );
		expect( input().getAttribute( 'aria-invalid' ) ).toBe( 'true' );
		expect( input().getAttribute( 'aria-describedby' ) ).toContain( error.id );
	} );

	test( 'clearing the error clears aria-invalid', async () => {
		host.innerHTML = `<os-field-row error="Required"><input /></os-field-row>`;
		await tick();
		expect( input().getAttribute( 'aria-invalid' ) ).toBe( 'true' );

		row().removeAttribute( 'error' );
		await tick();
		expect( input().hasAttribute( 'aria-invalid' ) ).toBe( false );
	} );

	test( "extends the consumer's aria-describedby rather than replacing it", async () => {
		host.innerHTML = `
			<os-field-row hint="Ours">
				<input aria-describedby="theirs" />
			</os-field-row>
			<span id="theirs">Consumer text</span>
		`;
		await tick();

		const described = input().getAttribute( 'aria-describedby' )!.split( /\s+/ );
		expect( described ).toContain( 'theirs' );
		expect( described.length ).toBe( 2 );
	} );

	test( 'does not accumulate its own id across re-syncs', async () => {
		host.innerHTML = `<os-field-row hint="Ours"><input /></os-field-row>`;
		await tick();
		row().setAttribute( 'label', 'Poke' );
		await tick();
		row().setAttribute( 'label', 'Poke again' );
		await tick();

		const described = input().getAttribute( 'aria-describedby' )!.split( /\s+/ );
		expect( described.length ).toBe( 1 );
	} );

	test( 'required marks the label and mirrors onto the control', async () => {
		host.innerHTML = `<os-field-row label="Key" required><input /></os-field-row>`;
		await tick();

		expect(
			row().shadowRoot!.querySelector( '.os-field-row__required' ),
		).not.toBeNull();
		expect( input().hasAttribute( 'required' ) ).toBe( true );
		expect( input().getAttribute( 'aria-required' ) ).toBe( 'true' );
	} );

	test( 'clicking the label focuses the control', async () => {
		host.innerHTML = `<os-field-row label="Key"><input /></os-field-row>`;
		await tick();

		const label = row().shadowRoot!.querySelector(
			'.os-field-row__label',
		) as HTMLElement;
		label.click();

		// The control is a light-DOM child, so it is the document's
		// active element directly — no shadow retargeting involved.
		expect( input().ownerDocument.activeElement ).toBe( input() );
	} );

	test( 'control-id picks a specific control when several are present', async () => {
		host.innerHTML = `
			<os-field-row hint="Ours" control-id="second">
				<input id="first" />
				<input id="second" />
			</os-field-row>
		`;
		await tick();

		expect(
			host.querySelector( '#first' )!.hasAttribute( 'aria-describedby' ),
		).toBe( false );
		expect(
			host.querySelector( '#second' )!.hasAttribute( 'aria-describedby' ),
		).toBe( true );
	} );

	test( 'a row with no control is inert rather than throwing', async () => {
		host.innerHTML = `<os-field-row label="Nothing here" hint="…"></os-field-row>`;
		await expect( tick() ).resolves.toBeUndefined();
		expect( row().shadowRoot!.querySelector( '.os-field-row__hint' ) )
			.not.toBeNull();
	} );
} );
