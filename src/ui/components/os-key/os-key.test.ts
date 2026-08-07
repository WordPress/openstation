import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import './os-key';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-key>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'click dispatches a os-key event with the matching key/label', async () => {
		host.innerHTML = `<os-key key="7" label="7"></os-key>`;
		await tick();
		const key = host.querySelector( 'os-key' )! as HTMLElement;
		const spy = vi.fn();
		key.addEventListener( 'os-key', spy );
		const btn = key.shadowRoot!.querySelector( 'button' )!;
		btn.click();
		expect( spy ).toHaveBeenCalledTimes( 1 );
		const detail = ( spy.mock.calls[ 0 ][ 0 ] as CustomEvent ).detail;
		expect( detail.key ).toBe( '7' );
		expect( detail.label ).toBe( '7' );
		expect( detail.source ).toBe( 'click' );
	} );

	test( 'keydown with matching key dispatches once; autorepeat ignored', async () => {
		host.innerHTML = `<os-key key="Enter" label="="></os-key>`;
		await tick();
		const key = host.querySelector( 'os-key' )! as HTMLElement;
		const spy = vi.fn();
		key.addEventListener( 'os-key', spy );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter' } ) );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter' } ) );
		expect( spy ).toHaveBeenCalledTimes( 1 );
		// keyup releases the internal hold flag so a subsequent
		// keydown can fire again.
		document.dispatchEvent( new KeyboardEvent( 'keyup', { key: 'Enter' } ) );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter' } ) );
		expect( spy ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'modifier mismatch rejects the keyboard match', async () => {
		host.innerHTML = `<os-key key="7" label="7"></os-key>`;
		await tick();
		const key = host.querySelector( 'os-key' )! as HTMLElement;
		const spy = vi.fn();
		key.addEventListener( 'os-key', spy );
		// Ctrl held but no modifier declared — reject.
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: '7', ctrlKey: true } ),
		);
		expect( spy ).not.toHaveBeenCalled();
	} );

	test( 'declared modifier required — matches only when held', async () => {
		host.innerHTML = `<os-key key="7" label="Ctrl+7" modifier="ctrl"></os-key>`;
		await tick();
		const key = host.querySelector( 'os-key' )! as HTMLElement;
		const spy = vi.fn();
		key.addEventListener( 'os-key', spy );
		// Plain '7' — rejected (modifier required).
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: '7' } ) );
		expect( spy ).not.toHaveBeenCalled();
		// Ctrl+7 — accepted.
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: '7', ctrlKey: true } ),
		);
		expect( spy ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'hold mode splits into keydown + keyup events', async () => {
		host.innerHTML = `<os-key key="a" label="a" hold></os-key>`;
		await tick();
		const key = host.querySelector( 'os-key' )! as HTMLElement;
		const downSpy = vi.fn();
		const upSpy = vi.fn();
		const mainSpy = vi.fn();
		key.addEventListener( 'os-key-down', downSpy );
		key.addEventListener( 'os-key-up', upSpy );
		key.addEventListener( 'os-key', mainSpy );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'a' } ) );
		document.dispatchEvent( new KeyboardEvent( 'keyup', { key: 'a' } ) );
		expect( downSpy ).toHaveBeenCalledTimes( 1 );
		expect( upSpy ).toHaveBeenCalledTimes( 1 );
		expect( mainSpy ).not.toHaveBeenCalled();
	} );

	test( 'code attribute takes priority over key when present', async () => {
		host.innerHTML = `<os-key code="NumpadAdd" key="+" label="+"></os-key>`;
		await tick();
		const key = host.querySelector( 'os-key' )! as HTMLElement;
		const spy = vi.fn();
		key.addEventListener( 'os-key', spy );
		// key: '+' but wrong code — reject.
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: '+', code: 'Equal' } ),
		);
		expect( spy ).not.toHaveBeenCalled();
		// Matching code — accept (key is irrelevant).
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'whatever', code: 'NumpadAdd' } ),
		);
		expect( spy ).toHaveBeenCalledTimes( 1 );
	} );
} );
