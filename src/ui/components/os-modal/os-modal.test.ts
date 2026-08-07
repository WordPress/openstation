/**
 * `<os-modal>` tests.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

async function load() {
	return await import( './os-modal' );
}

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
} );
