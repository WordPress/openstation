/**
 * `<os-disclosure>` — the state, and the semantics that make it a
 * disclosure rather than a div that hides things.
 *
 * The bug this component exists to not have: a collapsed panel whose
 * contents are merely invisible. Tab then walks into a region the user
 * cannot see, and a screen reader reads a section that is not there.
 * `hidden` on the body is what prevents both, and it is asserted here
 * because a later "let's animate the collapse" change is exactly the
 * kind of edit that would swap it for `max-height: 0`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import './os-disclosure';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-disclosure>', () => {
	let host: HTMLElement;

	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	async function mount( attrs = '' ): Promise< HTMLElement > {
		host.innerHTML = `
			<os-disclosure ${ attrs }>
				<span class="child">body</span>
			</os-disclosure>
		`;
		await tick();
		return host.querySelector( 'os-disclosure' ) as HTMLElement;
	}

	const summary = ( el: HTMLElement ) =>
		el.shadowRoot!.querySelector( 'button' ) as HTMLButtonElement;
	const body = ( el: HTMLElement ) =>
		el.shadowRoot!.querySelector( '.os-disclosure__body' ) as HTMLElement;

	test( 'starts closed, with the body genuinely hidden', async () => {
		const el = await mount( 'heading="Advanced"' );

		expect( el.hasAttribute( 'open' ) ).toBe( false );
		expect( body( el ).hasAttribute( 'hidden' ) ).toBe( true );
		expect( summary( el ).getAttribute( 'aria-expanded' ) ).toBe( 'false' );
	} );

	test( 'opens when the markup says so', async () => {
		const el = await mount( 'heading="Advanced" open' );

		expect( body( el ).hasAttribute( 'hidden' ) ).toBe( false );
		expect( summary( el ).getAttribute( 'aria-expanded' ) ).toBe( 'true' );
	} );

	test( 'the summary is a real button that toggles', async () => {
		// A real <button> is what gets Tab, Enter and Space for free.
		const el = await mount( 'heading="Advanced"' );
		expect( summary( el ).tagName ).toBe( 'BUTTON' );
		expect( summary( el ).type ).toBe( 'button' );

		summary( el ).click();
		await tick();
		expect( el.hasAttribute( 'open' ) ).toBe( true );
		expect( body( el ).hasAttribute( 'hidden' ) ).toBe( false );

		summary( el ).click();
		await tick();
		expect( el.hasAttribute( 'open' ) ).toBe( false );
		expect( body( el ).hasAttribute( 'hidden' ) ).toBe( true );
	} );

	test( 'aria-controls points at the body it controls', async () => {
		const el = await mount( 'heading="Advanced"' );

		const controls = summary( el ).getAttribute( 'aria-controls' );
		expect( controls ).toBeTruthy();
		expect( body( el ).id ).toBe( controls );
	} );

	test( 'two instances do not share an id', async () => {
		host.innerHTML = `
			<os-disclosure heading="One"></os-disclosure>
			<os-disclosure heading="Two"></os-disclosure>
		`;
		await tick();
		const [ a, b ] = Array.from(
			host.querySelectorAll< HTMLElement >( 'os-disclosure' ),
		);
		expect( body( a ).id ).not.toBe( body( b ).id );
	} );

	test( 'emits os-disclosure-toggle on user action only', async () => {
		const el = await mount( 'heading="Advanced"' );
		const seen: boolean[] = [];
		el.addEventListener( 'os-disclosure-toggle', ( e ) => {
			seen.push( ( e as CustomEvent< { open: boolean } > ).detail.open );
		} );

		summary( el ).click();
		summary( el ).click();
		expect( seen ).toEqual( [ true, false ] );

		// Setting the state from code stays silent, so a listener that
		// persists the state cannot loop.
		el.setAttribute( 'open', '' );
		el.removeAttribute( 'open' );
		await tick();
		expect( seen ).toEqual( [ true, false ] );
	} );

	test( 'renders the heading and the optional hint', async () => {
		const el = await mount( 'heading="Advanced" hint="3 settings"' );

		expect(
			el.shadowRoot!.querySelector( '.os-disclosure__heading' )?.textContent,
		).toBe( 'Advanced' );
		expect(
			el.shadowRoot!.querySelector( '.os-disclosure__hint' )?.textContent,
		).toBe( '3 settings' );
	} );

	test( 'omits the hint node when there is no hint', async () => {
		const el = await mount( 'heading="Advanced"' );
		expect( el.shadowRoot!.querySelector( '.os-disclosure__hint' ) ).toBeNull();
	} );

	test( 'slotted children stay in light DOM', async () => {
		const el = await mount( 'heading="Advanced"' );
		expect( el.querySelector( '.child' ) ).not.toBeNull();
	} );

	test( 'is listed in the component registry', async () => {
		const { OS_COMPONENT_TAGS } = await vi.importActual< {
			OS_COMPONENT_TAGS: readonly string[];
		} >( '../tags' );
		// The Components tab and `loadComponents()` both read this list;
		// a component missing from it is invisible to the docs and
		// cannot be requested by name.
		expect( OS_COMPONENT_TAGS ).toContain( 'os-disclosure' );
	} );
} );
