import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-switch';
import { styles } from './os-switch.styles';

const tick = (): Promise< void > => Promise.resolve();

function pointer( type: string, clientX: number, pointerId = 1 ): Event {
	const e = new MouseEvent( type, { bubbles: true, clientX } );
	Object.defineProperty( e, 'pointerId', { value: pointerId } );
	return e;
}

function layOut( track: HTMLElement, travel: number ): void {
	Object.defineProperty( track, 'clientWidth', {
		value: travel + 20,
		configurable: true,
	} );
	Object.defineProperty( track, 'clientHeight', {
		value: 20,
		configurable: true,
	} );
}

describe( '<os-switch>', () => {
	let host: HTMLElement;

	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	async function mount( markup: string ) {
		host.innerHTML = markup;
		await tick();
		const el = host.querySelector( 'os-switch' ) as HTMLElement;
		const button = el.shadowRoot!.querySelector( 'button' ) as HTMLButtonElement;
		button.setPointerCapture = () => undefined;
		return { el, button };
	}

	test( 'renders a role="switch" button reflecting aria-checked', async () => {
		const { el, button } = await mount( `<os-switch label="Reduce motion"></os-switch>` );

		expect( button.getAttribute( 'role' ) ).toBe( 'switch' );
		expect( button.getAttribute( 'aria-checked' ) ).toBe( 'false' );

		el.setAttribute( 'checked', '' );
		await tick();
		expect( button.getAttribute( 'aria-checked' ) ).toBe( 'true' );
	} );

	test( 'a click toggles and emits both event names with the same detail', async () => {
		const { el, button } = await mount(
			`<os-switch label="Dock" value="dock"></os-switch>`,
		);

		const heard: Record< string, unknown > = {};
		el.addEventListener( 'os-switch-change', ( e ) => {
			heard.own = ( e as CustomEvent ).detail;
		} );
		el.addEventListener( 'os-checkbox-change', ( e ) => {
			heard.alias = ( e as CustomEvent ).detail;
		} );

		button.click();

		expect( el.hasAttribute( 'checked' ) ).toBe( true );
		expect( heard.own ).toEqual( { checked: true, value: 'dock' } );

		expect( heard.alias ).toEqual( heard.own );
	} );

	test( 'clicking an on switch turns it off', async () => {
		const { el, button } = await mount( `<os-switch checked></os-switch>` );

		button.click();

		expect( el.hasAttribute( 'checked' ) ).toBe( false );
	} );

	test( 'a disabled switch does not toggle', async () => {
		const { el, button } = await mount( `<os-switch disabled></os-switch>` );

		button.click();

		expect( el.hasAttribute( 'checked' ) ).toBe( false );
		expect( button.disabled ).toBe( true );
	} );

	test( 'ArrowRight/End force on, ArrowLeft/Home force off', async () => {
		const { el, button } = await mount( `<os-switch></os-switch>` );

		button.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'ArrowRight', bubbles: true } ) );
		expect( el.hasAttribute( 'checked' ) ).toBe( true );

		let changes = 0;
		el.addEventListener( 'os-switch-change', () => changes++ );
		button.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'End', bubbles: true } ) );
		expect( el.hasAttribute( 'checked' ) ).toBe( true );
		expect( changes ).toBe( 0 );

		button.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'ArrowLeft', bubbles: true } ) );
		expect( el.hasAttribute( 'checked' ) ).toBe( false );

		button.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Home', bubbles: true } ) );
		expect( el.hasAttribute( 'checked' ) ).toBe( false );
	} );

	test( 'dragging past the midpoint turns the switch on', async () => {
		const { el, button } = await mount( `<os-switch></os-switch>` );
		layOut( button, 20 );

		button.dispatchEvent( pointer( 'pointerdown', 0 ) );
		button.dispatchEvent( pointer( 'pointermove', 16 ) );
		expect( el.getAttribute( 'data-dragging' ) ).toBe( '' );
		expect( el.style.getPropertyValue( '--_drag' ) ).toBe( '16px' );

		button.dispatchEvent( pointer( 'pointerup', 16 ) );

		expect( el.hasAttribute( 'checked' ) ).toBe( true );

		expect( el.style.getPropertyValue( '--_drag' ) ).toBe( '' );
		expect( el.hasAttribute( 'data-dragging' ) ).toBe( false );
	} );

	test( 'travel is read from the track alone, not from the knob', async () => {
		const { el, button } = await mount( `<os-switch></os-switch>` );
		layOut( button, 20 );
		const knob = el.shadowRoot!.querySelector(
			'.os-switch__knob',
		) as HTMLElement;
		Object.defineProperty( knob, 'offsetWidth', {
			value: 999,
			configurable: true,
		} );

		button.dispatchEvent( pointer( 'pointerdown', 0 ) );

		button.dispatchEvent( pointer( 'pointermove', 11 ) );
		button.dispatchEvent( pointer( 'pointerup', 11 ) );

		expect( el.hasAttribute( 'checked' ) ).toBe( true );
	} );

	test( 'a drag released short of the midpoint snaps back', async () => {
		const { el, button } = await mount( `<os-switch></os-switch>` );
		layOut( button, 20 );

		button.dispatchEvent( pointer( 'pointerdown', 0 ) );
		button.dispatchEvent( pointer( 'pointermove', 8 ) );
		button.dispatchEvent( pointer( 'pointerup', 8 ) );

		expect( el.hasAttribute( 'checked' ) ).toBe( false );
	} );

	test( 'the click that follows a drag does not toggle a second time', async () => {
		const { el, button } = await mount( `<os-switch></os-switch>` );
		layOut( button, 20 );

		button.dispatchEvent( pointer( 'pointerdown', 0 ) );
		button.dispatchEvent( pointer( 'pointermove', 18 ) );
		button.dispatchEvent( pointer( 'pointerup', 18 ) );

		button.click();

		expect( el.hasAttribute( 'checked' ) ).toBe( true );
	} );

	test( 'movement under the tap threshold is still a tap', async () => {
		const { el, button } = await mount( `<os-switch></os-switch>` );
		layOut( button, 20 );

		button.dispatchEvent( pointer( 'pointerdown', 0 ) );
		button.dispatchEvent( pointer( 'pointermove', 2 ) );
		expect( el.hasAttribute( 'data-dragging' ) ).toBe( false );
		button.dispatchEvent( pointer( 'pointerup', 2 ) );

		expect( el.hasAttribute( 'checked' ) ).toBe( false );
		button.click();

		expect( el.hasAttribute( 'checked' ) ).toBe( true );
	} );

	test( 'an on switch can be dragged back off, and cannot be dragged further on', async () => {
		const { el, button } = await mount( `<os-switch checked></os-switch>` );
		layOut( button, 20 );

		button.dispatchEvent( pointer( 'pointerdown', 0 ) );

		button.dispatchEvent( pointer( 'pointermove', 30 ) );
		expect( el.style.getPropertyValue( '--_drag' ) ).toBe( '0px' );

		button.dispatchEvent( pointer( 'pointermove', -16 ) );
		expect( el.style.getPropertyValue( '--_drag' ) ).toBe( '-16px' );
		button.dispatchEvent( pointer( 'pointerup', -16 ) );

		expect( el.hasAttribute( 'checked' ) ).toBe( false );
	} );

	test( 'pointercancel abandons the gesture without toggling', async () => {
		const { el, button } = await mount( `<os-switch></os-switch>` );
		layOut( button, 20 );

		button.dispatchEvent( pointer( 'pointerdown', 0 ) );
		button.dispatchEvent( pointer( 'pointermove', 18 ) );
		button.dispatchEvent( pointer( 'pointercancel', 18 ) );

		expect( el.hasAttribute( 'checked' ) ).toBe( false );
		expect( el.style.getPropertyValue( '--_drag' ) ).toBe( '' );
	} );

	test( 'a disabled switch ignores the drag gesture entirely', async () => {
		const { el, button } = await mount( `<os-switch disabled></os-switch>` );
		layOut( button, 20 );

		button.dispatchEvent( pointer( 'pointerdown', 0 ) );
		button.dispatchEvent( pointer( 'pointermove', 18 ) );
		button.dispatchEvent( pointer( 'pointerup', 18 ) );

		expect( el.hasAttribute( 'checked' ) ).toBe( false );
		expect( el.hasAttribute( 'data-dragging' ) ).toBe( false );
	} );

	test( 'the description renders and is wired to aria-describedby only when present', async () => {
		const { button } = await mount( `<os-switch label="Dock"></os-switch>` );

		expect( button.hasAttribute( 'aria-describedby' ) ).toBe( false );

		const { el: el2, button: button2 } = await mount(
			`<os-switch label="Dock" description="Slides away until you point at the edge."></os-switch>`,
		);
		expect( button2.getAttribute( 'aria-describedby' ) ).toBe( 'os-switch-desc' );
		expect(
			el2.shadowRoot!.querySelector( '#os-switch-desc' )!.textContent,
		).toContain( 'Slides away' );
	} );

	test( 'the on state is the flat accent, and the mesh stays off', () => {
		expect( styles.cssText ).toMatch(
			/:host\(\s*\[\s*checked\s*\]\s*\)\s*button\s*{[^}]*background-image:\s*none/,
		);
		expect( styles.cssText ).toMatch(
			/:host\(\s*\[\s*checked\s*\]\s*\)\s*button\s*{[^}]*background-color:\s*var\(\s*--os-ui-accent/,
		);
	} );

	test( 'the OFF state is the plain track — no mesh, in markup or in CSS', async () => {
		host.innerHTML = `<os-switch label="Live"></os-switch>`;
		await tick();
		const button = host
			.querySelector( 'os-switch' )!
			.shadowRoot!.querySelector( 'button' )!;

		expect( button.className ).not.toContain( 'os-holo-fill' );

		expect( styles.cssText ).not.toContain( '.os-holo-fill' );
		expect( styles.cssText ).not.toContain( '.os-holo-edge' );

		expect( styles.cssText ).toMatch(
			/button\s*{[^}]*background-color:\s*var\(\s*--_holo-track\s*\)/,
		);
	} );

	test( 'the switch still reads the holo aliases it does use', () => {
		for ( const alias of [
			'--_holo-track',
			'--_holo-track-edge',
			'--_holo-focus',
			'--_holo-t',
		] ) {
			expect( styles.cssText ).toContain( `${ alias }:` );
		}
	} );

	test( 'the track has no border, so the pill cannot change size with state', () => {
		expect( styles.cssText ).toMatch( /button\s*{[^}]*border:\s*0;/ );
		expect( styles.cssText ).toMatch(
			/button\s*{[^}]*box-shadow:\s*inset 0 0 0 1px var\( --_holo-track-edge \)/,
		);
		expect( styles.cssText ).not.toContain( 'border-color: transparent' );
	} );

	test( 'both states carry a boundary, and neither is a bare wash', () => {
		expect( styles.cssText ).toMatch(
			/:host\(\s*\[\s*checked\s*\]\s*\)\s*button\s*{[^}]*background-color:\s*var\(\s*--os-ui-accent/,
		);

		expect( styles.cssText ).toMatch(
			/button:focus-visible\s*{[^}]*var\( --_holo-focus \),\s*inset 0 0 0 1px var\( --_holo-track-edge \)/,
		);
	} );

	test( 'the knob has a hairline strong enough to survive the lit mesh', () => {
		expect( styles.cssText ).toMatch(
			/0 0 0 1px var\( --os-ui-switch-knob-edge, rgba\( 12, 11, 15, 0\.55 \) \)/,
		);
		expect( styles.cssText ).not.toContain( '0 0 0 0.5px' );
	} );

	test( 'the palette reaches the component — no themed token is pinned on :host', () => {
		const hostBlock = styles.cssText.slice(
			styles.cssText.indexOf( ':host {' ),
			styles.cssText.indexOf( ':host( [ size=' ),
		);
		expect( hostBlock ).not.toMatch( /\n\t\t--os-ui-[a-z-]+:/ );
	} );
} );
