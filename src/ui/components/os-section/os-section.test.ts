/**
 * `<os-section>` — smoke test. Verifies that heading +
 * description drive the shadow-DOM text nodes and that slotted
 * children survive into light DOM.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-section';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-section>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders heading + description + slotted content', async () => {
		host.innerHTML = `
			<os-section heading="Wallpaper" description="Backdrop">
				<span class="child">body</span>
			</os-section>
		`;
		await tick();
		const section = host.querySelector( 'os-section' )!;
		expect( section.shadowRoot!.querySelector( 'h3' )?.textContent ).toBe(
			'Wallpaper',
		);
		expect( section.shadowRoot!.querySelector( 'p' )?.textContent ).toBe(
			'Backdrop',
		);
		// Slotted children live in light DOM on the host.
		expect( section.querySelector( '.child' ) ).not.toBeNull();
	} );
} );
