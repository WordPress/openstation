/**
 * `<os-modal>` tests.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

async function load() {
	return await import( './os-modal' );
}

/** Settle async rendering — enough for `_focusFirst` retries to complete. */
const tick = () => new Promise< void >( ( r ) => setTimeout( r, 10 ) );

function mount( attrs: Record< string, string > = {}, body: string = '' ): HTMLElement {
	const el = document.createElement( 'os-modal' );
	for ( const [ k, v ] of Object.entries( attrs ) ) {
		el.setAttribute( k, v );
	}
	el.innerHTML = body;
	document.body.appendChild( el );
	return el;
}

describe( 'os-modal', () => {
	beforeEach( async () => {
		document.body.innerHTML = '';
		await load();
	} );
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'opens when the open attribute is set', async () => {
		const el = mount( { open: '', title: 'Hi' } );
		await new Promise( ( r ) => queueMicrotask( () => r( null ) ) );
		expect( el.hasAttribute( 'open' ) ).toBe( true );
		const dialog = el.shadowRoot!.querySelector( '.dialog' );
		expect( dialog ).not.toBeNull();
		const title = el.shadowRoot!.querySelector( '.title' );
		expect( title?.textContent?.trim() ).toBe( 'Hi' );
	} );

	test( 'Escape key cancels and fires os-modal-cancel', async () => {
		const el = mount( { open: '', title: 'Hi' } );
		const events: Event[] = [];
		el.addEventListener( 'os-modal-cancel', ( e ) => events.push( e ) );
		el.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		expect( events.length ).toBe( 1 );
		expect( el.hasAttribute( 'open' ) ).toBe( false );
	} );

	test( 'click outside (host = backdrop) closes the modal', () => {
		const el = mount( { open: '', title: 'Hi' } );
		el.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( el.hasAttribute( 'open' ) ).toBe( false );
	} );

	test( 'click inside the dialog body does not close', async () => {
		const el = mount( { open: '', title: 'Hi' } );
		await new Promise( ( r ) => queueMicrotask( () => r( null ) ) );
		const inner = el.shadowRoot!.querySelector< HTMLElement >( '.dialog' )!;
		inner.click();
		expect( el.hasAttribute( 'open' ) ).toBe( true );
	} );

	test( 'mandatory disables Escape and click-outside and hides the close button', () => {
		const el = mount( { open: '', title: 'Hi', mandatory: '' } );
		el.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		expect( el.hasAttribute( 'open' ) ).toBe( true );
		el.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( el.hasAttribute( 'open' ) ).toBe( true );
		const closeBtn = el.shadowRoot!.querySelector< HTMLElement >( '.close' );
		expect( closeBtn ).toBeNull();
	} );

	test( 'os-modal-cancel is cancelable — preventDefault keeps the modal open', () => {
		const el = mount( { open: '', title: 'Hi' } );
		el.addEventListener( 'os-modal-cancel', ( e ) => e.preventDefault() );
		el.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		expect( el.hasAttribute( 'open' ) ).toBe( true );
	} );

	test( 'showModal() and hideModal() toggle the open attribute', () => {
		const el = mount( {}, '<button id="x">x</button>' );
		( el as unknown as { showModal: () => void } ).showModal();
		expect( el.hasAttribute( 'open' ) ).toBe( true );
		( el as unknown as { hideModal: () => void } ).hideModal();
		expect( el.hasAttribute( 'open' ) ).toBe( false );
	} );

	test( 'renders default slot content', () => {
		const el = mount( { open: '' }, '<p class="bodytext">hello</p>' );
		const bodyText = el.querySelector( '.bodytext' );
		expect( bodyText ).not.toBeNull();
		expect( bodyText?.textContent ).toBe( 'hello' );
	} );

	test( 'size attribute controls width preset (sm/lg variants apply)', () => {
		const sm = mount( { open: '', size: 'sm' } );
		expect( sm.getAttribute( 'size' ) ).toBe( 'sm' );
		const lg = mount( { open: '', size: 'lg' } );
		expect( lg.getAttribute( 'size' ) ).toBe( 'lg' );
	} );

	test( 'focuses first interactive element in modal body on open', async () => {
		await import( '../os-button/os-button' );
		const el = mount(
			{ open: '', title: 'Settings' },
			'<button id="first-btn">First</button><button id="second-btn">Second</button>',
		);
		await tick();
		const firstBtn = el.querySelector< HTMLButtonElement >( '#first-btn' );
		expect( el.ownerDocument.activeElement ).toBe( firstBtn );
	} );

	test( 'focuses element with autofocus when specified', async () => {
		const el = mount(
			{ open: '', title: 'Settings' },
			'<button id="first-btn">First</button><button id="second-btn" autofocus>Second</button>',
		);
		await tick();
		const secondBtn = el.querySelector< HTMLButtonElement >( '#second-btn' );
		expect( el.ownerDocument.activeElement ).toBe( secondBtn );
	} );

	test( 'discovers focusable elements inside slotted custom components with shadow DOM', async () => {
		await Promise.all( [
			import( '../os-range-field/os-range-field' ),
			import( '../os-color-field/os-color-field' ),
			import( '../os-button/os-button' ),
			import( '../os-cluster/os-cluster' ),
		] );

		const el = mount(
			{ open: '', title: 'Wallpaper Settings' },
			`
			<os-range-field label="Wind" value="22"></os-range-field>
			<os-color-field label="Background" value="#0c1a36"></os-color-field>
			<os-cluster>
				<os-button id="reset-btn">Reset</os-button>
			</os-cluster>
			`,
		);
		await tick();

		const rangeField = el.querySelector< HTMLElement >( 'os-range-field' );
		const colorField = el.querySelector< HTMLElement >( 'os-color-field' );
		const resetBtn = el.querySelector< HTMLElement >( '#reset-btn' );

		const rangeInput = rangeField?.shadowRoot?.querySelector( 'input' );
		const colorInput = colorField?.shadowRoot?.querySelector( 'input' );
		const resetNativeBtn = resetBtn?.shadowRoot?.querySelector( 'button' );
		const closeBtn = el.shadowRoot?.querySelector( 'button.close' );

		expect( rangeInput ).not.toBeNull();
		expect( colorInput ).not.toBeNull();
		expect( resetNativeBtn ).not.toBeNull();
		expect( closeBtn ).not.toBeNull();

		// Initial focus lands on the first body field (range input), not stuck on close button
		expect( rangeField?.shadowRoot?.activeElement || el.ownerDocument.activeElement ).toBe( rangeInput );

		// Tabbing from the last element (reset button) wraps back to the first element (close button in header)
		resetNativeBtn!.focus();
		resetNativeBtn!.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Tab', bubbles: true, composed: true } ),
		);
		expect( el.shadowRoot?.activeElement ).toBe( closeBtn );

		// Shift+Tab from the first element (close button) wraps back to the last element (reset button)
		closeBtn!.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Tab', shiftKey: true, bubbles: true, composed: true } ),
		);
		expect( resetBtn?.shadowRoot?.activeElement || el.ownerDocument.activeElement ).toBe( resetNativeBtn );
	} );

	test( 'closing modal restores focus to previously active element', async () => {
		const opener = document.createElement( 'button' );
		opener.id = 'opener-btn';
		document.body.appendChild( opener );
		opener.focus();
		expect( opener.ownerDocument.activeElement ).toBe( opener );

		const el = mount( { open: '', title: 'Dialog' }, '<button id="modal-btn">Inside</button>' );
		await tick();

		expect( el.ownerDocument.activeElement ).toBe( el.querySelector( '#modal-btn' ) );

		el.removeAttribute( 'open' );
		expect( opener.ownerDocument.activeElement ).toBe( opener );
	} );

	test( 'focus trap works when modal has only close button', async () => {
		const el = mount( { open: '', title: 'Empty Info' }, '<p>Just text</p>' );
		await tick();

		const closeBtn = el.shadowRoot?.querySelector< HTMLButtonElement >( 'button.close' );
		expect( el.shadowRoot?.activeElement ).toBe( closeBtn );

		// Tabbing stays on close button
		closeBtn!.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Tab', bubbles: true, composed: true } ),
		);
		expect( el.shadowRoot?.activeElement ).toBe( closeBtn );
	} );
} );

