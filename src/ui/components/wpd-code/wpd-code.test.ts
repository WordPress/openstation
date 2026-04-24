/**
 * `<wpd-code>` — smoke test. Verifies the shadow-DOM `<code>` host
 * renders, slotted text reaches light DOM, and the `block` attribute
 * toggles the block variant (CSS is the source of truth for the
 * visual; here we just verify the attribute plumbs through).
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-code';

const tick = (): Promise< void > => Promise.resolve();

describe( '<wpd-code>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a <code> host with slotted content', async () => {
		host.innerHTML = `<wpd-code>chrome://flags</wpd-code>`;
		await tick();
		const code = host.querySelector( 'wpd-code' )!;
		expect( code.shadowRoot!.querySelector( 'code' ) ).not.toBeNull();
		expect( code.textContent ).toBe( 'chrome://flags' );
	} );

	test( 'block attribute survives on the host for CSS to target', async () => {
		host.innerHTML = `<wpd-code block>foo\nbar</wpd-code>`;
		await tick();
		const code = host.querySelector( 'wpd-code' )!;
		expect( code.hasAttribute( 'block' ) ).toBe( true );
	} );

	test( 'does not install global keypress listeners', async () => {
		// The whole point vs <wpd-key>: `<wpd-code>c</wpd-code>` must
		// not swallow the `c` key. We verify by watching whether the
		// host emits or cancels a synthetic keydown — it should
		// absolutely do neither.
		host.innerHTML = `<wpd-code>c</wpd-code>`;
		await tick();
		const ev = new KeyboardEvent( 'keydown', {
			key: 'c',
			bubbles: true,
			cancelable: true,
		} );
		let sawCancel = false;
		document.addEventListener(
			'keydown',
			( e ) => {
				sawCancel = e.defaultPrevented;
			},
			{ once: true, capture: false },
		);
		document.dispatchEvent( ev );
		expect( sawCancel ).toBe( false );
	} );
} );
