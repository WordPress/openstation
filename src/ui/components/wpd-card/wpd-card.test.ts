import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import './wpd-card';

const tick = (): Promise< void > =>
	new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

describe( '<wpd-card>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'non-interactive cards do NOT add role / tabindex', async () => {
		host.innerHTML = `<wpd-card></wpd-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'wpd-card' )!;
		expect( card.hasAttribute( 'role' ) ).toBe( false );
		expect( card.hasAttribute( 'tabindex' ) ).toBe( false );
	} );

	test( 'interactive cards expose role="button" + tabindex="0"', async () => {
		host.innerHTML = `<wpd-card interactive></wpd-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'wpd-card' )!;
		expect( card.getAttribute( 'role' ) ).toBe( 'button' );
		expect( card.getAttribute( 'tabindex' ) ).toBe( '0' );
		expect( card.getAttribute( 'aria-disabled' ) ).toBe( 'false' );
	} );

	test( 'disabled interactive cards are tab-skipped', async () => {
		host.innerHTML = `<wpd-card interactive disabled></wpd-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'wpd-card' )!;
		expect( card.getAttribute( 'tabindex' ) ).toBe( '-1' );
		expect( card.getAttribute( 'aria-disabled' ) ).toBe( 'true' );
	} );

	test( 'click on an interactive card fires wpd-card-click', async () => {
		host.innerHTML = `<wpd-card interactive></wpd-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'wpd-card' )!;
		const onClick = vi.fn();
		card.addEventListener( 'wpd-card-click', onClick );
		card.click();
		expect( onClick ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'click on a non-interactive card does NOT fire', async () => {
		host.innerHTML = `<wpd-card></wpd-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'wpd-card' )!;
		const onClick = vi.fn();
		card.addEventListener( 'wpd-card-click', onClick );
		card.click();
		expect( onClick ).not.toHaveBeenCalled();
	} );

	test( 'click on a [data-noclick] descendant is ignored', async () => {
		host.innerHTML = `
			<wpd-card interactive>
				<button data-noclick id="btn">Action</button>
			</wpd-card>
		`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'wpd-card' )!;
		const btn = host.querySelector< HTMLElement >( '#btn' )!;
		const onClick = vi.fn();
		card.addEventListener( 'wpd-card-click', onClick );
		btn.click();
		expect( onClick ).not.toHaveBeenCalled();
	} );

	test( 'Enter on an interactive card fires wpd-card-click', async () => {
		host.innerHTML = `<wpd-card interactive></wpd-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'wpd-card' )!;
		const onClick = vi.fn();
		card.addEventListener( 'wpd-card-click', onClick );
		card.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ),
		);
		expect( onClick ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'disabled card swallows clicks', async () => {
		host.innerHTML = `<wpd-card interactive disabled></wpd-card>`;
		await tick();
		const card = host.querySelector< HTMLElement >( 'wpd-card' )!;
		const onClick = vi.fn();
		card.addEventListener( 'wpd-card-click', onClick );
		card.click();
		expect( onClick ).not.toHaveBeenCalled();
	} );
} );
