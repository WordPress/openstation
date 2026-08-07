import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-icon';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-icon>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders dashicons-<name> when given a bare slug', async () => {
		host.innerHTML = `<os-icon name="calculator"></os-icon>`;
		await tick();
		const icon = host.querySelector( 'os-icon' )!;
		const glyph = icon.shadowRoot!.querySelector( '.os-icon__glyph' )!;
		expect( glyph.className ).toContain( 'dashicons-calculator' );
	} );

	test( 'accepts the full dashicons-* class form without double-prefixing', async () => {
		host.innerHTML = `<os-icon name="dashicons-admin-post"></os-icon>`;
		await tick();
		const glyph = host
			.querySelector( 'os-icon' )!
			.shadowRoot!.querySelector( '.os-icon__glyph' )!;
		expect( glyph.className ).toContain( 'dashicons-admin-post' );
		expect( glyph.className ).not.toContain( 'dashicons-dashicons-' );
	} );

	test( 'writes size as a custom property when given', async () => {
		host.innerHTML = `<os-icon name="smiley" size="32"></os-icon>`;
		await tick();
		const icon = host.querySelector< HTMLElement >( 'os-icon' )!;
		expect( icon.style.getPropertyValue( '--os-ui-icon-size' ) ).toBe( '32px' );
	} );
} );
