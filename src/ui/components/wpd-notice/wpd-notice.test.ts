import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-notice';
import { _resetNoticeDismissalsForTests } from './storage';

const tick = (): Promise< void > => Promise.resolve();

describe( '<wpd-notice>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		_resetNoticeDismissalsForTests();
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => {
		host.remove();
		_resetNoticeDismissalsForTests();
	} );

	test( 'role=status set on connection', async () => {
		host.innerHTML = `<wpd-notice>Hi</wpd-notice>`;
		await tick();
		expect( host.querySelector( 'wpd-notice' )!.getAttribute( 'role' ) ).toBe(
			'status',
		);
	} );

	test( 'defaults tone to info when no tone attribute set', async () => {
		host.innerHTML = `<wpd-notice>Hello</wpd-notice>`;
		await tick();
		expect( host.querySelector( 'wpd-notice' )!.getAttribute( 'tone' ) ).toBe(
			'info',
		);
	} );

	test( 'dismissible by default — close button visible', async () => {
		host.innerHTML = `<wpd-notice>Hello</wpd-notice>`;
		await tick();
		const btn = host
			.querySelector( 'wpd-notice' )!
			.shadowRoot!.querySelector( '.wpd-notice__close' ) as HTMLButtonElement;
		expect( btn.hasAttribute( 'hidden' ) ).toBe( false );
	} );

	test( 'not-dismissible attribute hides the close button', async () => {
		host.innerHTML = `<wpd-notice not-dismissible>Hello</wpd-notice>`;
		await tick();
		const btn = host
			.querySelector( 'wpd-notice' )!
			.shadowRoot!.querySelector( '.wpd-notice__close' ) as HTMLButtonElement;
		expect( btn.hasAttribute( 'hidden' ) ).toBe( true );
	} );

	test( 'icon attribute renders dashicons span', async () => {
		host.innerHTML = `<wpd-notice icon="dashicons-info">x</wpd-notice>`;
		await tick();
		const iconEl = host
			.querySelector( 'wpd-notice' )!
			.shadowRoot!.querySelector( '.wpd-notice__icon' ) as HTMLElement;
		expect( iconEl.hasAttribute( 'hidden' ) ).toBe( false );
		expect( iconEl.classList.contains( 'dashicons-info' ) ).toBe( true );
	} );

	test( 'no icon attribute → icon span hidden', async () => {
		host.innerHTML = `<wpd-notice>x</wpd-notice>`;
		await tick();
		const iconEl = host
			.querySelector( 'wpd-notice' )!
			.shadowRoot!.querySelector( '.wpd-notice__icon' ) as HTMLElement;
		expect( iconEl.hasAttribute( 'hidden' ) ).toBe( true );
	} );

	test( 'clicking close hides host and fires wpd-notice-dismiss', async () => {
		host.innerHTML = `<wpd-notice notice-id="t/click">Hi</wpd-notice>`;
		await tick();
		const el = host.querySelector( 'wpd-notice' )! as HTMLElement;
		let detail: unknown = null;
		el.addEventListener( 'wpd-notice-dismiss', ( e ) => {
			detail = ( e as CustomEvent ).detail;
		} );
		const btn = el.shadowRoot!.querySelector(
			'.wpd-notice__close',
		) as HTMLButtonElement;
		btn.click();
		expect( el.hidden ).toBe( true );
		expect( ( detail as { noticeId?: string } )?.noticeId ).toBe( 't/click' );
	} );

	test( 'dismissal persists per notice-id — second mount stays hidden', async () => {
		host.innerHTML = `<wpd-notice notice-id="t/persist">Hi</wpd-notice>`;
		await tick();
		const el1 = host.querySelector( 'wpd-notice' )! as HTMLElement;
		( el1 as unknown as { dismiss(): void } ).dismiss();
		expect( el1.hidden ).toBe( true );

		// Re-mount a fresh instance with the same id.
		host.innerHTML = '';
		host.innerHTML = `<wpd-notice notice-id="t/persist">Hi again</wpd-notice>`;
		await tick();
		const el2 = host.querySelector( 'wpd-notice' )! as HTMLElement;
		expect( el2.hidden ).toBe( true );
	} );

	test( 'undismiss clears persistence — new mount shows again', async () => {
		host.innerHTML = `<wpd-notice notice-id="t/undismiss">Hi</wpd-notice>`;
		await tick();
		const el1 = host.querySelector( 'wpd-notice' )! as HTMLElement;
		( el1 as unknown as { dismiss(): void } ).dismiss();
		( el1 as unknown as { undismiss(): void } ).undismiss();

		host.innerHTML = '';
		host.innerHTML = `<wpd-notice notice-id="t/undismiss">Hi</wpd-notice>`;
		await tick();
		const el2 = host.querySelector( 'wpd-notice' )! as HTMLElement;
		expect( el2.hidden ).toBe( false );
	} );

	test( 'notice-id absent → dismissal does not write to localStorage', async () => {
		host.innerHTML = `<wpd-notice>No id</wpd-notice>`;
		await tick();
		const el = host.querySelector( 'wpd-notice' )! as HTMLElement;
		( el as unknown as { dismiss(): void } ).dismiss();
		expect( el.hidden ).toBe( true );
		// No record stored; a second instance with no id always shows.
		host.innerHTML = '';
		host.innerHTML = `<wpd-notice>Again</wpd-notice>`;
		await tick();
		const el2 = host.querySelector( 'wpd-notice' )! as HTMLElement;
		expect( el2.hidden ).toBe( false );
	} );

	test( 'slotted HTML (links) is preserved', async () => {
		host.innerHTML =
			`<wpd-notice>Hi <a href="#" id="lnk">link</a></wpd-notice>`;
		await tick();
		const el = host.querySelector( 'wpd-notice' )!;
		expect( el.querySelector( '#lnk' ) ).not.toBeNull();
	} );
} );
