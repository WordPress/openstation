/**
 * `<wpd-flyout>` tests — pin the 14-point window-scoped spec:
 * containment, focus capture-and-restore (with preventScroll),
 * focus trap on Tab / Shift+Tab, click-outside-via-pointerdown,
 * Escape, `[data-flyout-close]` button, imperative `open`-removal,
 * each firing one unified `wpd-flyout-dismiss` event with a
 * `reason` discriminator. Cleanup on disconnect.
 *
 * @since 0.8.2
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

interface DismissDetail {
	reason: 'escape' | 'pointer' | 'close-button' | 'api';
}

async function load() {
	return await import( './wpd-flyout' );
}

/**
 * Build a fake "window body" container the flyout can scope into.
 * Mimics a real window's `position: relative; overflow: hidden`
 * shell so the flyout has a valid containing block. Returns the
 * scope root so tests can dispatch pointerdown events on it.
 */
function mountWindow(): HTMLElement {
	const win = document.createElement( 'div' );
	win.className = 'desktop-mode-window__body';
	win.style.position = 'relative';
	win.style.overflow = 'hidden';
	win.style.height = '400px';
	win.style.width = '600px';
	document.body.appendChild( win );
	return win;
}

describe( 'wpd-flyout', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
	} );
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'mounts inert until the open attribute is set', async () => {
		await load();
		const win = mountWindow();
		const flyout = document.createElement( 'wpd-flyout' );
		win.appendChild( flyout );
		expect( flyout.hasAttribute( 'open' ) ).toBe( false );
		expect( flyout.hasAttribute( 'inert' ) ).toBe( true );

		flyout.setAttribute( 'open', '' );
		expect( flyout.hasAttribute( 'inert' ) ).toBe( false );
	} );

	test( 'role defaults to dialog', async () => {
		await load();
		const flyout = document.createElement( 'wpd-flyout' );
		mountWindow().appendChild( flyout );
		expect( flyout.getAttribute( 'role' ) ).toBe( 'dialog' );
	} );

	test( 'Escape on document dismisses with reason "escape"', async () => {
		await load();
		const win = mountWindow();
		const flyout = document.createElement( 'wpd-flyout' );
		flyout.innerHTML = '<button>focusable</button>';
		win.appendChild( flyout );
		flyout.setAttribute( 'open', '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const events: DismissDetail[] = [];
		flyout.addEventListener( 'wpd-flyout-dismiss', ( e ) => {
			events.push( ( e as CustomEvent< DismissDetail > ).detail );
		} );

		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
		);
		expect( events.map( ( e ) => e.reason ) ).toEqual( [ 'escape' ] );
		expect( flyout.hasAttribute( 'open' ) ).toBe( false );
	} );

	test( 'pointerdown OUTSIDE the panel but inside the window dismisses with reason "pointer"', async () => {
		await load();
		const win = mountWindow();
		const flyout = document.createElement( 'wpd-flyout' );
		flyout.innerHTML = '<button>inside</button>';
		win.appendChild( flyout );
		const stranger = document.createElement( 'div' );
		stranger.id = 'stranger';
		win.appendChild( stranger );

		flyout.setAttribute( 'open', '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const events: DismissDetail[] = [];
		flyout.addEventListener( 'wpd-flyout-dismiss', ( e ) => {
			events.push( ( e as CustomEvent< DismissDetail > ).detail );
		} );

		// Click on a sibling inside the same window scope — must dismiss.
		stranger.dispatchEvent(
			new Event( 'pointerdown', { bubbles: true, composed: true } ),
		);
		expect( events.map( ( e ) => e.reason ) ).toEqual( [ 'pointer' ] );
		expect( flyout.hasAttribute( 'open' ) ).toBe( false );
	} );

	test( 'pointerdown INSIDE the panel does NOT dismiss', async () => {
		await load();
		const win = mountWindow();
		const flyout = document.createElement( 'wpd-flyout' );
		const innerBtn = document.createElement( 'button' );
		innerBtn.textContent = 'inside';
		flyout.appendChild( innerBtn );
		win.appendChild( flyout );

		flyout.setAttribute( 'open', '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const events: DismissDetail[] = [];
		flyout.addEventListener( 'wpd-flyout-dismiss', ( e ) => {
			events.push( ( e as CustomEvent< DismissDetail > ).detail );
		} );

		innerBtn.dispatchEvent(
			new Event( 'pointerdown', { bubbles: true, composed: true } ),
		);
		expect( events.length ).toBe( 0 );
		expect( flyout.hasAttribute( 'open' ) ).toBe( true );
	} );

	test( 'pointerdown on the captured trigger is ignored — its own click handler decides', async () => {
		await load();
		const win = mountWindow();
		const trigger = document.createElement( 'button' );
		trigger.textContent = 'trigger';
		win.appendChild( trigger );
		const flyout = document.createElement( 'wpd-flyout' );
		flyout.innerHTML = '<button>focusable</button>';
		win.appendChild( flyout );

		// Simulate the trigger having been the focused element when
		// `open` was added — this is what the component captures.
		trigger.focus();
		flyout.setAttribute( 'open', '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const events: DismissDetail[] = [];
		flyout.addEventListener( 'wpd-flyout-dismiss', ( e ) => {
			events.push( ( e as CustomEvent< DismissDetail > ).detail );
		} );

		// pointerdown on the trigger — must NOT auto-dismiss.
		trigger.dispatchEvent(
			new Event( 'pointerdown', { bubbles: true, composed: true } ),
		);
		expect( events.length ).toBe( 0 );
		expect( flyout.hasAttribute( 'open' ) ).toBe( true );
	} );

	test( 'data-flyout-close button inside the panel dismisses with reason "close-button"', async () => {
		await load();
		const win = mountWindow();
		const flyout = document.createElement( 'wpd-flyout' );
		flyout.innerHTML = '<button data-flyout-close>Close</button>';
		win.appendChild( flyout );

		flyout.setAttribute( 'open', '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const events: DismissDetail[] = [];
		flyout.addEventListener( 'wpd-flyout-dismiss', ( e ) => {
			events.push( ( e as CustomEvent< DismissDetail > ).detail );
		} );

		const closeBtn = flyout.querySelector< HTMLButtonElement >(
			'[data-flyout-close]',
		);
		closeBtn!.click();
		expect( events.map( ( e ) => e.reason ) ).toEqual( [ 'close-button' ] );
		expect( flyout.hasAttribute( 'open' ) ).toBe( false );
	} );

	test( 'imperatively removing the open attribute fires reason "api"', async () => {
		await load();
		const flyout = document.createElement( 'wpd-flyout' );
		flyout.innerHTML = '<button>focusable</button>';
		mountWindow().appendChild( flyout );
		flyout.setAttribute( 'open', '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const events: DismissDetail[] = [];
		flyout.addEventListener( 'wpd-flyout-dismiss', ( e ) => {
			events.push( ( e as CustomEvent< DismissDetail > ).detail );
		} );

		flyout.removeAttribute( 'open' );
		expect( events.map( ( e ) => e.reason ) ).toEqual( [ 'api' ] );
	} );

	test( 'self-driven Escape removal fires "escape" exactly once (not also "api")', async () => {
		await load();
		const flyout = document.createElement( 'wpd-flyout' );
		flyout.innerHTML = '<button>focusable</button>';
		mountWindow().appendChild( flyout );
		flyout.setAttribute( 'open', '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const events: DismissDetail[] = [];
		flyout.addEventListener( 'wpd-flyout-dismiss', ( e ) => {
			events.push( ( e as CustomEvent< DismissDetail > ).detail );
		} );

		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
		);
		expect( events.map( ( e ) => e.reason ) ).toEqual( [ 'escape' ] );
	} );

	test( 'restores focus to the trigger on dismiss', async () => {
		await load();
		const win = mountWindow();
		const trigger = document.createElement( 'button' );
		trigger.textContent = 'trigger';
		win.appendChild( trigger );
		const flyout = document.createElement( 'wpd-flyout' );
		flyout.innerHTML = '<button>inside</button>';
		win.appendChild( flyout );

		trigger.focus();
		expect( flyout.ownerDocument?.activeElement ).toBe( trigger );

		flyout.setAttribute( 'open', '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		// While open, focus is in the panel.
		expect( flyout.ownerDocument?.activeElement ).not.toBe( trigger );

		flyout.removeAttribute( 'open' );
		// After dismiss, focus returns to the trigger.
		expect( flyout.ownerDocument?.activeElement ).toBe( trigger );
	} );

	test( 'Escape on a closed flyout is a no-op', async () => {
		await load();
		const flyout = document.createElement( 'wpd-flyout' );
		mountWindow().appendChild( flyout );

		const events: DismissDetail[] = [];
		flyout.addEventListener( 'wpd-flyout-dismiss', ( e ) => {
			events.push( ( e as CustomEvent< DismissDetail > ).detail );
		} );

		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
		);
		expect( events ).toEqual( [] );
	} );

	test( 'placement attribute round-trips', async () => {
		await load();
		const flyout = document.createElement( 'wpd-flyout' );
		mountWindow().appendChild( flyout );
		flyout.setAttribute( 'placement', 'top' );
		expect( flyout.getAttribute( 'placement' ) ).toBe( 'top' );
		flyout.setAttribute( 'placement', 'start' );
		expect( flyout.getAttribute( 'placement' ) ).toBe( 'start' );
	} );

	test( 'cleans up listeners on disconnect — Escape after removal does not throw or fire', async () => {
		await load();
		const flyout = document.createElement( 'wpd-flyout' );
		flyout.innerHTML = '<button>x</button>';
		const win = mountWindow();
		win.appendChild( flyout );
		flyout.setAttribute( 'open', '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const events: DismissDetail[] = [];
		flyout.addEventListener( 'wpd-flyout-dismiss', ( e ) => {
			events.push( ( e as CustomEvent< DismissDetail > ).detail );
		} );

		// Remove the flyout from the DOM — listeners must detach.
		flyout.remove();

		// Subsequent Escape on document — must NOT fire on the
		// detached flyout (its listener should have been removed).
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
		);
		expect( events.length ).toBe( 0 );
	} );

	test( 'focus trap — Tab from the last focusable wraps to the first', async () => {
		await load();
		const flyout = document.createElement( 'wpd-flyout' );
		flyout.innerHTML = `
			<button id="a">a</button>
			<button id="b">b</button>
			<button id="c">c</button>
		`;
		mountWindow().appendChild( flyout );
		flyout.setAttribute( 'open', '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const last = flyout.querySelector< HTMLButtonElement >( '#c' )!;
		last.focus();
		expect( flyout.ownerDocument?.activeElement ).toBe( last );

		// Tab from the last focusable — wraps to first.
		flyout.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Tab',
				bubbles: true,
			} ),
		);
		const first = flyout.querySelector< HTMLButtonElement >( '#a' )!;
		expect( flyout.ownerDocument?.activeElement ).toBe( first );
	} );

	test( 'focus trap — Shift+Tab from the first focusable wraps to the last', async () => {
		await load();
		const flyout = document.createElement( 'wpd-flyout' );
		flyout.innerHTML = `
			<button id="a">a</button>
			<button id="b">b</button>
			<button id="c">c</button>
		`;
		mountWindow().appendChild( flyout );
		flyout.setAttribute( 'open', '' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const first = flyout.querySelector< HTMLButtonElement >( '#a' )!;
		first.focus();

		flyout.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Tab',
				bubbles: true,
				shiftKey: true,
			} ),
		);
		const last = flyout.querySelector< HTMLButtonElement >( '#c' )!;
		expect( flyout.ownerDocument?.activeElement ).toBe( last );
	} );

	test( 'static help block carries the documented surface', async () => {
		const { WpdFlyout } = await load();
		expect( WpdFlyout.help?.title ).toBe( 'Flyout' );
		expect( WpdFlyout.help?.status ).toBe( 'experimental' );
		const propNames = ( WpdFlyout.help?.props ?? [] ).map( ( p ) => p.name );
		expect( propNames ).toEqual(
			expect.arrayContaining( [ 'open', 'placement', 'scope' ] ),
		);
		const eventNames = ( WpdFlyout.help?.events ?? [] ).map( ( e ) => e.name );
		expect( eventNames ).toContain( 'wpd-flyout-dismiss' );
	} );
} );
