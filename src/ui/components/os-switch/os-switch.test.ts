import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-switch';
import { styles } from './os-switch.styles';

const tick = (): Promise< void > => Promise.resolve();

/**
 * jsdom implements neither pointer capture nor `PointerEvent`, so the
 * gesture tests below drive the handlers with `MouseEvent`s carrying the
 * two fields the component reads (`pointerId`, `clientX`) and stub the
 * capture call. That is enough to exercise every branch of the drag
 * logic — the arithmetic is the part worth pinning, and it is pure.
 */
function pointer( type: string, clientX: number, pointerId = 1 ): Event {
	const e = new MouseEvent( type, { bubbles: true, clientX } );
	Object.defineProperty( e, 'pointerId', { value: pointerId } );
	return e;
}

/**
 * Give the track real geometry. jsdom lays everything out at zero, and
 * a drag over zero travel is correctly ignored — a control with no
 * width cannot be dragged.
 *
 * Only the track is measured: travel is `clientWidth - clientHeight`,
 * which is the stylesheet's own `w - knob - 2·pad` with the pads
 * cancelled out. Deliberately independent of the knob, which widens to
 * 1.28× under `:active` — see the note in `_onPointerDown`.
 */
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
		// The compatibility alias is what lets a switch drop into a
		// listener already bound to <os-checkbox>. Same detail, same tick.
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

		// Idempotent: pressing it again on an already-on switch is not a
		// toggle, which is the whole point of an absolute key.
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
		// The live offset is handed back to CSS on release — the settled
		// position comes from `--_travel`, not from the leftover drag.
		expect( el.style.getPropertyValue( '--_drag' ) ).toBe( '' );
		expect( el.hasAttribute( 'data-dragging' ) ).toBe( false );
	} );

	test( 'travel is read from the track alone, not from the knob', async () => {
		// The knob widens to 1.28x under :active, and whether :active
		// has landed by the time pointerdown is dispatched is not
		// something the spec pins down. Measuring the knob would
		// therefore shorten the travel by a quarter on some presses and
		// not others, and the switch would flip early — intermittently.
		//
		// Travel is clientWidth - clientHeight, which is the
		// stylesheet's w - knob - 2*pad with the pads cancelled. A knob
		// laid out at any width at all must not move the midpoint.
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
		// 11 of a 20px travel: past the midpoint, and only past it if
		// the midpoint is still 10.
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
		// The browser fires this immediately after `pointerup`. Without
		// the swallow flag it would flip the switch straight back off.
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
		// `pointerup` deferred to the click, which the browser fires next.
		expect( el.hasAttribute( 'checked' ) ).toBe( false );
		button.click();

		expect( el.hasAttribute( 'checked' ) ).toBe( true );
	} );

	test( 'an on switch can be dragged back off, and cannot be dragged further on', async () => {
		const { el, button } = await mount( `<os-switch checked></os-switch>` );
		layOut( button, 20 );

		button.dispatchEvent( pointer( 'pointerdown', 0 ) );
		// Pushing further to the right is a no-op: the knob is already at
		// the end of the track, so the clamp holds it at 0.
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
		// Dropped rather than emptied: an aria-describedby pointing at an
		// empty node is a described element with nothing to say, and
		// screen readers announce the pause.
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
		// The design direction: form controls wear the accent, and the
		// meshes stay reserved for hero surfaces. The .os-holo-fill
		// class stays on the element so a caller can re-enable a mesh
		// through its own tokens, which is exactly why the checked rule
		// must take the image back off: if that override stops landing,
		// every switch goes iridescent at once.
		expect( styles.cssText ).toContain( '.os-holo-fill' );
		expect( styles.cssText ).toMatch(
			/:host\(\s*\[\s*checked\s*\]\s*\)\s*button\s*{[^}]*background-image:\s*none/,
		);
		expect( styles.cssText ).toMatch(
			/:host\(\s*\[\s*checked\s*\]\s*\)\s*button\s*{[^}]*background-color:\s*var\(\s*--os-ui-accent/,
		);
	} );

	test( 'the track has no border, so the pill cannot change size with state', () => {
		// The bug this replaced: a 1px border plus the default
		// border-box background clip meant the off state drew a grey
		// ring OVER the fill's outer edge while the on state
		// (border-color: transparent) let the mesh through it. The
		// visible pill grew a pixel on each side as it turned on, and
		// the switch looked like it resized when it changed state.
		//
		// The off edge is an inset shadow instead: no layout, so both
		// states occupy exactly the same box.
		expect( styles.cssText ).toMatch( /button\s*{[^}]*border:\s*0;/ );
		expect( styles.cssText ).toMatch(
			/button\s*{[^}]*box-shadow:\s*inset 0 0 0 1px var\( --_holo-track-edge \)/,
		);
		expect( styles.cssText ).not.toContain( 'border-color: transparent' );
	} );

	test( 'both states carry a boundary, and neither is a bare wash', () => {
		// WCAG 1.4.11 wants 3:1 on the boundary of a control. Off gets
		// the Pewter inset edge; on is an OPAQUE accent fill, which is
		// its own boundary against the surface, so the edge is dropped
		// with nothing needed in its place.
		expect( styles.cssText ).toMatch(
			/:host\(\s*\[\s*checked\s*\]\s*\)\s*button\s*{[^}]*background-color:\s*var\(\s*--os-ui-accent/,
		);
		// Focused-and-off keeps BOTH: the ring says where the keyboard
		// is, the edge still says where the control is.
		expect( styles.cssText ).toMatch(
			/button:focus-visible\s*{[^}]*var\( --_holo-focus \),\s*inset 0 0 0 1px var\( --_holo-track-edge \)/,
		);
	} );

	test( 'the knob has a hairline strong enough to survive the lit mesh', () => {
		// Starlight on Holomesh's white glow (#fffdff) is 1.01:1 — the
		// knob is not dim there, it is absent. The ring is what carries
		// it: Void at 55% composites to ~#7d7c7f over that glow, which
		// holds the knob at 3.5:1. The previous 0.12 alpha did nothing.
		expect( styles.cssText ).toMatch(
			/0 0 0 1px var\( --os-ui-switch-knob-edge, rgba\( 12, 11, 15, 0\.55 \) \)/,
		);
		expect( styles.cssText ).not.toContain( '0 0 0 0.5px' );
	} );

	test( 'the palette reaches the component — no themed token is pinned on :host', () => {
		// The kit-wide rule, asserted here too because this component
		// declares an unusually large private block and the temptation to
		// put `--os-ui-holo-fill` in it is real. Guarded globally by
		// tests/vitest/component-token-reachability.test.ts.
		const hostBlock = styles.cssText.slice(
			styles.cssText.indexOf( ':host {' ),
			styles.cssText.indexOf( ':host( [ size=' ),
		);
		expect( hostBlock ).not.toMatch( /\n\t\t--os-ui-[a-z-]+:/ );
	} );
} );
