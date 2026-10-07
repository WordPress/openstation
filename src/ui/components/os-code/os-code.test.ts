import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { OsCode } from './os-code';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-code>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a <code> host with slotted content', async () => {
		host.innerHTML = `<os-code>chrome://flags</os-code>`;
		await tick();
		const code = host.querySelector( 'os-code' )!;
		expect( code.shadowRoot!.querySelector( 'code' ) ).not.toBeNull();
		expect( code.textContent ).toBe( 'chrome://flags' );
	} );

	test( 'block attribute survives on the host for CSS to target', async () => {
		host.innerHTML = `<os-code block>foo\nbar</os-code>`;
		await tick();
		const code = host.querySelector( 'os-code' )!;
		expect( code.hasAttribute( 'block' ) ).toBe( true );
	} );

	test( 'wrap attribute survives on the host for CSS to target', async () => {
		host.innerHTML = `<os-code block wrap>foo bar</os-code>`;
		await tick();
		const code = host.querySelector( 'os-code' )!;
		expect( code.hasAttribute( 'wrap' ) ).toBe( true );
		expect( OsCode.props ).toContain( 'wrap' );
	} );

	test( 'does not install global keypress listeners', async () => {
		host.innerHTML = `<os-code>c</os-code>`;
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
