import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-checkbox-label';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-checkbox-label>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'toggles `checked` + emits os-checkbox-change', async () => {
		host.innerHTML = `<os-checkbox-label label="Only HD"></os-checkbox-label>`;
		await tick();
		const el = host.querySelector( 'os-checkbox-label' )!;
		const input = el.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let heard: boolean | null = null;
		el.addEventListener( 'os-checkbox-change', ( e ) => {
			heard = ( e as CustomEvent ).detail.checked;
		} );
		input.checked = true;
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		expect( heard ).toBe( true );
		expect( el.hasAttribute( 'checked' ) ).toBe( true );
	} );
} );
