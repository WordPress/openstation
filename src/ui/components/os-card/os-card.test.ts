import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import './os-card';

const tick = (): Promise< void > =>
	new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

describe( '<os-card>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'non-interactive cards do NOT add role / tabindex', async () => {
		host.innerHTML = `<os-card></os-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'os-card' )!;
		expect( card.hasAttribute( 'role' ) ).toBe( false );
		expect( card.hasAttribute( 'tabindex' ) ).toBe( false );
	} );

	test( 'interactive cards expose role="button" + tabindex="0"', async () => {
		host.innerHTML = `<os-card interactive></os-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'os-card' )!;
		expect( card.getAttribute( 'role' ) ).toBe( 'button' );
		expect( card.getAttribute( 'tabindex' ) ).toBe( '0' );
		expect( card.getAttribute( 'aria-disabled' ) ).toBe( 'false' );
	} );

	test( 'disabled interactive cards are tab-skipped', async () => {
		host.innerHTML = `<os-card interactive disabled></os-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'os-card' )!;
		expect( card.getAttribute( 'tabindex' ) ).toBe( '-1' );
		expect( card.getAttribute( 'aria-disabled' ) ).toBe( 'true' );
	} );

	test( 'click on an interactive card fires os-card-click', async () => {
		host.innerHTML = `<os-card interactive></os-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'os-card' )!;
		const onClick = vi.fn();
		card.addEventListener( 'os-card-click', onClick );
		card.click();
		expect( onClick ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'click on a non-interactive card does NOT fire', async () => {
		host.innerHTML = `<os-card></os-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'os-card' )!;
		const onClick = vi.fn();
		card.addEventListener( 'os-card-click', onClick );
		card.click();
		expect( onClick ).not.toHaveBeenCalled();
	} );

	test( 'click on a [data-noclick] descendant is ignored', async () => {
		host.innerHTML = `
			<os-card interactive>
				<button data-noclick id="btn">Action</button>
			</os-card>
		`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'os-card' )!;
		const btn = host.querySelector< HTMLElement >( '#btn' )!;
		const onClick = vi.fn();
		card.addEventListener( 'os-card-click', onClick );
		btn.click();
		expect( onClick ).not.toHaveBeenCalled();
	} );

	test( 'Enter on an interactive card fires os-card-click', async () => {
		host.innerHTML = `<os-card interactive></os-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'os-card' )!;
		const onClick = vi.fn();
		card.addEventListener( 'os-card-click', onClick );
		card.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ),
		);
		expect( onClick ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'disabled card swallows clicks', async () => {
		host.innerHTML = `<os-card interactive disabled></os-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'os-card' )!;
		const onClick = vi.fn();
		card.addEventListener( 'os-card-click', onClick );
		card.click();
		expect( onClick ).not.toHaveBeenCalled();
	} );
} );
