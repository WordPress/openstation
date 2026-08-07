import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-swatch';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-swatch>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'reflects `selected` via aria-pressed + emits os-pick on click', async () => {
		host.innerHTML = `<os-swatch value="aurora" label="Aurora" preview="#2271b1"></os-swatch>`;
		await tick();
		const swatch = host.querySelector( 'os-swatch' )!;
		const inner = swatch.shadowRoot!.querySelector( 'button' )!;

		expect( inner.getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		swatch.setAttribute( 'selected', '' );
		await tick();
		expect( inner.getAttribute( 'aria-pressed' ) ).toBe( 'true' );

		let heard: string | null = null;
		swatch.addEventListener( 'os-pick', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );
		inner.click();
		expect( heard ).toBe( 'aurora' );
	} );
} );
