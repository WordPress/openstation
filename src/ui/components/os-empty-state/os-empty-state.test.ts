import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-empty-state';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-empty-state>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders heading + description + icon + slotted CTA', async () => {
		host.innerHTML = `
			<os-empty-state
				icon="admin-plugins"
				heading="No plugins"
				description="Install something."
			>
				<button slot="cta" class="go">Browse</button>
			</os-empty-state>
		`;
		await tick();
		const empty = host.querySelector( 'os-empty-state' )!;
		const sr = empty.shadowRoot!;
		expect( sr.querySelector( 'h3' )?.textContent ).toBe( 'No plugins' );
		expect( sr.querySelector( 'p' )?.textContent ).toBe( 'Install something.' );
		expect( sr.querySelector( 'os-icon' ) ).not.toBeNull();
		// CTA slot picks up the slotted button in light DOM.
		expect( empty.querySelector( '.go' ) ).not.toBeNull();
	} );

	test( 'omits icon when attribute absent', async () => {
		host.innerHTML = `<os-empty-state heading="Nope"></os-empty-state>`;
		await tick();
		const empty = host.querySelector( 'os-empty-state' )!;
		expect( empty.shadowRoot!.querySelector( 'os-icon' ) ).toBeNull();
	} );
} );
