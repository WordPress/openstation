import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-window-button';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-window-button>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders a button + SVG for built-in icons', async () => {
		host.innerHTML = `<os-window-button icon="minimize" aria-label="Minimize"></os-window-button>`;
		await tick();
		await tick();
		const el = host.querySelector( 'os-window-button' )!;
		const btn = el.shadowRoot!.querySelector( 'button' );
		expect( btn ).not.toBeNull();
		const svg = el.shadowRoot!.querySelector( 'svg' );
		expect( svg ).not.toBeNull();
		// Minimize icon is a horizontal line via <path>.
		expect( svg!.querySelector( 'path' ) ).not.toBeNull();
	} );

	test( 'unknown icon key renders an empty svg (slot fallback available)', async () => {
		host.innerHTML = `<os-window-button icon="nope">🎯</os-window-button>`;
		await tick();
		await tick();
		const el = host.querySelector( 'os-window-button' )!;
		const svg = el.shadowRoot!.querySelector( 'svg' );
		expect( svg!.innerHTML ).toBe( '' );
		// Slotted content stays in light DOM.
		expect( el.textContent?.trim() ).toBe( '🎯' );
	} );

	test( 'click bubbles through the host element', async () => {
		host.innerHTML = `<os-window-button icon="close"></os-window-button>`;
		await tick();
		const el = host.querySelector( 'os-window-button' )!;
		let fired = false;
		el.addEventListener( 'click', () => {
			fired = true;
		} );
		el.shadowRoot!.querySelector( 'button' )!.click();
		expect( fired ).toBe( true );
	} );

	test( 'fires `os-button-activate` once per click', async () => {
		host.innerHTML = `<os-window-button icon="close"></os-window-button>`;
		await tick();
		const el = host.querySelector( 'os-window-button' )!;

		let fires = 0;
		el.addEventListener( 'os-button-activate', () => {
			fires++;
		} );

		// Three real clicks → three activations. No doubles.
		el.shadowRoot!.querySelector( 'button' )!.click();
		el.shadowRoot!.querySelector( 'button' )!.click();
		el.shadowRoot!.querySelector( 'button' )!.click();
		expect( fires ).toBe( 3 );
	} );

	test( '`os-button-activate` bubbles + composes (parent listeners receive it)', async () => {
		host.innerHTML = `<os-window-button icon="close"></os-window-button>`;
		await tick();
		const el = host.querySelector( 'os-window-button' )!;

		let saw = false;
		host.addEventListener( 'os-button-activate', () => {
			saw = true;
		} );
		el.shadowRoot!.querySelector( 'button' )!.click();
		expect( saw ).toBe( true );
	} );

	test( 'forwards the host aria-label onto the shadow button', async () => {
		host.innerHTML = `<os-window-button icon="minimize" aria-label="Minimize"></os-window-button>`;
		await tick();
		await tick();
		const el = host.querySelector( 'os-window-button' )!;
		const btn = el.shadowRoot!.querySelector( 'button' )!;
		// The focusable element is the shadow button; a label only on
		// the (role-less) host is invisible to assistive tech.
		expect( btn.getAttribute( 'aria-label' ) ).toBe( 'Minimize' );
	} );

	test( 'forwards the label for themed (icon-src) buttons too', async () => {
		host.innerHTML =
			`<os-window-button icon-src="https://example.com/x.png" aria-label="Close"></os-window-button>`;
		await tick();
		await tick();
		const el = host.querySelector( 'os-window-button' )!;
		const btn = el.shadowRoot!.querySelector( 'button' )!;
		expect( btn.getAttribute( 'aria-label' ) ).toBe( 'Close' );
	} );

	test( 'relabelling the host relabels the shadow button', async () => {
		host.innerHTML = `<os-window-button icon="maximize" aria-label="Maximize"></os-window-button>`;
		await tick();
		await tick();
		const el = host.querySelector( 'os-window-button' )!;
		el.setAttribute( 'aria-label', 'Restore' );
		await tick();
		await tick();
		const btn = el.shadowRoot!.querySelector( 'button' )!;
		expect( btn.getAttribute( 'aria-label' ) ).toBe( 'Restore' );
	} );

	test( 'no aria-label on the host leaves the button unlabelled, not empty-labelled', async () => {
		host.innerHTML = `<os-window-button icon="close"></os-window-button>`;
		await tick();
		await tick();
		const el = host.querySelector( 'os-window-button' )!;
		const btn = el.shadowRoot!.querySelector( 'button' )!;
		expect( btn.hasAttribute( 'aria-label' ) ).toBe( false );
	} );

	test( 'switching the icon attribute repaints the svg', async () => {
		host.innerHTML = `<os-window-button icon="minimize"></os-window-button>`;
		await tick();
		await tick();
		const el = host.querySelector( 'os-window-button' )!;
		const svg = el.shadowRoot!.querySelector( 'svg' )!;
		const before = svg.innerHTML;
		el.setAttribute( 'icon', 'close' );
		await tick();
		await tick();
		const after = svg.innerHTML;
		expect( after ).not.toBe( before );
		expect( after.length ).toBeGreaterThan( 0 );
	} );
} );
