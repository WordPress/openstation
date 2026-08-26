import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-tab-chip';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-tab-chip>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders variant-specific icon (detach)', async () => {
		host.innerHTML = `<os-tab-chip variant="detach" aria-label="Open in new tab"></os-tab-chip>`;
		await tick();
		await tick();
		const chip = host.querySelector( 'os-tab-chip' )!;
		const svg = chip.shadowRoot!.querySelector( 'svg' );
		expect( svg!.querySelector( 'path' ) ).not.toBeNull();
	} );

	test( 'click bubbles through the host', async () => {
		host.innerHTML = `<os-tab-chip variant="close"></os-tab-chip>`;
		await tick();
		const chip = host.querySelector( 'os-tab-chip' )!;
		let fired = false;
		chip.addEventListener( 'click', () => {
			fired = true;
		} );
		chip.shadowRoot!.querySelector( 'button' )!.click();
		expect( fired ).toBe( true );
	} );
} );
