import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-menu';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-menu> + <os-menu-item>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'menu has role=menu, item defaults to role=menuitem', async () => {
		host.innerHTML = `
			<os-menu>
				<os-menu-item value="a">A</os-menu-item>
			</os-menu>
		`;
		await tick();
		const menu = host.querySelector( 'os-menu' )!;
		const item = host.querySelector( 'os-menu-item' )!;
		expect( menu.getAttribute( 'role' ) ).toBe( 'menu' );
		expect( item.getAttribute( 'role' ) ).toBe( 'menuitem' );
	} );

	test( 'checkbox variant paints the check + reflects aria-checked', async () => {
		host.innerHTML = `
			<os-menu-item role="menuitemcheckbox" value="startup" checked>
				Open on startup
			</os-menu-item>
		`;
		await tick();
		const item = host.querySelector( 'os-menu-item' )!;
		expect( item.getAttribute( 'aria-checked' ) ).toBe( 'true' );
		const check = item.shadowRoot!.querySelector(
			'.os-menu-item__check',
		) as HTMLElement;
		expect( check.hidden ).toBe( false );
		// Uncheck: aria-checked flips, check indicator stays (the
		// component doesn't remove the DOM, just the `checked` attr
		// drives the visual).
		item.removeAttribute( 'checked' );
		await tick();
		expect( item.getAttribute( 'aria-checked' ) ).toBe( 'false' );
	} );

	test( 'click emits os-menu-item-click with value', async () => {
		host.innerHTML = `
			<os-menu-item value="open-another">Open another</os-menu-item>
		`;
		await tick();
		const item = host.querySelector( 'os-menu-item' )!;
		let heard: string | null = null;
		item.addEventListener( 'os-menu-item-click', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );
		item.shadowRoot!.querySelector( 'button' )!.click();
		expect( heard ).toBe( 'open-another' );
	} );

	test( 'icon attribute surfaces a dashicon span', async () => {
		host.innerHTML = `
			<os-menu-item icon="dashicons-plus-alt2" value="x">Add</os-menu-item>
		`;
		await tick();
		const item = host.querySelector( 'os-menu-item' )!;
		const icon = item.shadowRoot!.querySelector(
			'.os-menu-item__icon',
		) as HTMLElement;
		expect( icon.classList.contains( 'dashicons-plus-alt2' ) ).toBe( true );
		expect( icon.hidden ).toBe( false );
	} );
} );
