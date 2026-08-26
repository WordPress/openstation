import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-tabs';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-tabs> + <os-tab>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'clicking a tab bubbles os-tab-change + updates aria-selected', async () => {
		host.innerHTML = `
			<os-tabs value="library" label="Source">
				<os-tab value="upload">Upload</os-tab>
				<os-tab value="library">Library</os-tab>
			</os-tabs>
		`;
		await tick();
		await tick();
		const strip = host.querySelector( 'os-tabs' )!;
		const upload = host.querySelector( 'os-tab[value="upload"]' )!;
		const library = host.querySelector( 'os-tab[value="library"]' )!;

		expect( library.getAttribute( 'aria-selected' ) ).toBe( 'true' );
		expect( upload.getAttribute( 'aria-selected' ) ).toBe( 'false' );

		let heard: string | null = null;
		strip.addEventListener( 'os-tab-change', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );
		upload.shadowRoot!.querySelector( 'button' )!.click();
		await tick();
		await tick();

		expect( heard ).toBe( 'upload' );
		expect( strip.getAttribute( 'value' ) ).toBe( 'upload' );
		expect( upload.getAttribute( 'aria-selected' ) ).toBe( 'true' );
		expect( library.getAttribute( 'aria-selected' ) ).toBe( 'false' );
	} );

	test( 'each tab gets role=tab + the strip gets role=tablist + aria-label', async () => {
		host.innerHTML = `
			<os-tabs value="a" label="Source">
				<os-tab value="a">A</os-tab>
			</os-tabs>
		`;
		await tick();
		const strip = host.querySelector( 'os-tabs' )!;
		expect( strip.getAttribute( 'role' ) ).toBe( 'tablist' );
		expect( strip.getAttribute( 'aria-label' ) ).toBe( 'Source' );
		expect(
			host.querySelector( 'os-tab' )!.getAttribute( 'role' ),
		).toBe( 'tab' );
	} );

	test( 'defaults to a horizontal strip', async () => {
		host.innerHTML = `
			<os-tabs value="a">
				<os-tab value="a">A</os-tab>
			</os-tabs>
		`;
		await tick();
		expect(
			host.querySelector( 'os-tabs' )!.getAttribute( 'aria-orientation' ),
		).toBe( 'horizontal' );
		expect(
			host.querySelector( 'os-tab' )!.hasAttribute( 'data-orientation' ),
		).toBe( false );
	} );

	test( 'orientation=vertical is announced and mirrored onto every tab', async () => {
		host.innerHTML = `
			<os-tabs value="a" orientation="vertical">
				<os-tab value="a">A</os-tab>
				<os-tab value="b">B</os-tab>
			</os-tabs>
		`;
		await tick();
		expect(
			host.querySelector( 'os-tabs' )!.getAttribute( 'aria-orientation' ),
		).toBe( 'vertical' );
		// Mirrored down rather than read upward, because the tabs style
		// themselves and Firefox has no :host-context().
		for ( const tab of Array.from( host.querySelectorAll( 'os-tab' ) ) ) {
			expect( tab.getAttribute( 'data-orientation' ) ).toBe( 'vertical' );
		}
	} );

	test( 'arrows rove along the strip, on the axis the orientation names', async () => {
		// One tab stop, so without this the other rows cannot be reached
		// from the keyboard at all. The chrome tab strip has always had
		// it; the sidebar in OpenStation Preferences is a tablist too.
		host.innerHTML = `
			<os-tabs value="a" orientation="vertical">
				<os-tab value="a">A</os-tab>
				<os-tab value="b">B</os-tab>
				<os-tab value="c">C</os-tab>
			</os-tabs>
		`;
		await tick();
		const tabs = host.querySelector( 'os-tabs' )!;
		const key = ( k: string ): void => {
			tabs.dispatchEvent(
				new KeyboardEvent( 'keydown', { key: k, bubbles: true } ),
			);
		};
		const value = (): string | null => tabs.getAttribute( 'value' );

		key( 'ArrowDown' );
		expect( value() ).toBe( 'b' );
		key( 'ArrowUp' );
		expect( value() ).toBe( 'a' );
		// Wraps rather than stopping, and Home / End reach both ends.
		key( 'ArrowUp' );
		expect( value() ).toBe( 'c' );
		key( 'Home' );
		expect( value() ).toBe( 'a' );
		key( 'End' );
		expect( value() ).toBe( 'c' );
		// The cross axis belongs to the page: a vertical strip must not
		// eat Left and Right.
		key( 'ArrowRight' );
		expect( value() ).toBe( 'c' );
	} );

	test( 'a tab added after mount is stamped like the others', async () => {
		// A settings tab registered live re-renders the list around this
		// element without changing a prop of its own, so nothing would
		// re-run the stamping and the new row arrived as a horizontal
		// chip no keyboard could reach.
		host.innerHTML = `
			<os-tabs value="a" orientation="vertical">
				<os-tab value="a">A</os-tab>
			</os-tabs>
		`;
		await tick();
		const late = document.createElement( 'os-tab' );
		late.setAttribute( 'value', 'b' );
		host.querySelector( 'os-tabs' )!.appendChild( late );
		// A MutationObserver callback, then the update it schedules, then
		// the microtask the aria mirror runs in: three turns, not one.
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		await tick();
		expect( late.getAttribute( 'data-orientation' ) ).toBe( 'vertical' );
		expect( late.getAttribute( 'aria-selected' ) ).toBe( 'false' );
		expect( late.getAttribute( 'tabindex' ) ).toBe( '-1' );
	} );

	test( 'an unknown orientation degrades to horizontal rather than to nothing', async () => {
		host.innerHTML = `
			<os-tabs value="a" orientation="sideways">
				<os-tab value="a">A</os-tab>
			</os-tabs>
		`;
		await tick();
		expect(
			host.querySelector( 'os-tabs' )!.getAttribute( 'aria-orientation' ),
		).toBe( 'horizontal' );
		expect(
			host.querySelector( 'os-tab' )!.hasAttribute( 'data-orientation' ),
		).toBe( false );
	} );

	test( 'sibling <os-tabpanel> elements auto-hide based on the active value', async () => {
		host.innerHTML = `
			<div class="scope">
				<os-tabs value="calc">
					<os-tab value="calc">Calc</os-tab>
					<os-tab value="convert">Convert</os-tab>
				</os-tabs>
				<os-tabpanel for="calc">CALC PANE</os-tabpanel>
				<os-tabpanel for="convert">CONV PANE</os-tabpanel>
			</div>
		`;
		await tick();
		await tick();

		const calcPane = host.querySelector( 'os-tabpanel[for="calc"]' )!;
		const convPane = host.querySelector( 'os-tabpanel[for="convert"]' )!;
		expect( calcPane.hasAttribute( 'hidden' ) ).toBe( false );
		expect( convPane.hasAttribute( 'hidden' ) ).toBe( true );

		// Click the Convert tab — the auto-swap should flip hidden
		// without any JS listener on the caller's side.
		host.querySelector( 'os-tab[value="convert"]' )!
			.shadowRoot!.querySelector( 'button' )!
			.click();
		await tick();
		await tick();

		expect( calcPane.hasAttribute( 'hidden' ) ).toBe( true );
		expect( convPane.hasAttribute( 'hidden' ) ).toBe( false );
	} );

	test( 'a panel added after mount picks up the current active tab', async () => {
		host.innerHTML = `
			<div class="scope">
				<os-tabs value="b">
					<os-tab value="a">A</os-tab>
					<os-tab value="b">B</os-tab>
				</os-tabs>
				<os-tabpanel for="a">A PANE</os-tabpanel>
			</div>
		`;
		await tick();
		await tick();

		const scope = host.querySelector( '.scope' )!;
		const late = document.createElement( 'os-tabpanel' );
		late.setAttribute( 'for', 'b' );
		late.textContent = 'B PANE';
		scope.appendChild( late );
		await tick();
		await tick();

		const a = host.querySelector( 'os-tabpanel[for="a"]' )!;
		expect( a.hasAttribute( 'hidden' ) ).toBe( true );
		expect( late.hasAttribute( 'hidden' ) ).toBe( false );
		expect( late.getAttribute( 'role' ) ).toBe( 'tabpanel' );
	} );

	test( '.items setter replaces children and preserves value when it still matches', async () => {
		host.innerHTML = `<os-tabs value="a"></os-tabs>`;
		await tick();

		const tabs = host.querySelector( 'os-tabs' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
		};
		tabs.items = [
			{ value: 'a', label: 'First' },
			{ value: 'b', label: 'Second' },
		];
		await tick();
		await tick();

		const tabEls = host.querySelectorAll( 'os-tab' );
		expect( tabEls.length ).toBe( 2 );
		expect( tabEls[ 0 ].getAttribute( 'value' ) ).toBe( 'a' );
		expect( tabEls[ 0 ].textContent?.trim() ).toBe( 'First' );
		expect( tabs.getAttribute( 'value' ) ).toBe( 'a' );
		expect( tabEls[ 0 ].getAttribute( 'aria-selected' ) ).toBe( 'true' );
	} );

	test( '.items setter falls back to first item when old value is no longer in the list', async () => {
		host.innerHTML = `<os-tabs value="missing"></os-tabs>`;
		await tick();

		const tabs = host.querySelector( 'os-tabs' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
		};
		tabs.items = [
			{ value: 'x', label: 'X' },
			{ value: 'y', label: 'Y' },
		];
		await tick();
		await tick();

		expect( tabs.getAttribute( 'value' ) ).toBe( 'x' );
	} );

	// Regression guard: an earlier 0.5.0 build declared the panel
	// as light DOM with a `<slot>` render, which wrote `<slot></slot>`
	// into the panel itself on first mount — wiping every
	// server-rendered child. The fix moves the slot into a shadow
	// root; slotted nodes stay as light-DOM descendants so plugin
	// render callbacks keep finding them.
	test( 'server-rendered children inside <os-tabpanel> survive mount', async () => {
		host.innerHTML = `
			<div class="scope">
				<os-tabs value="main">
					<os-tab value="main">Main</os-tab>
					<os-tab value="about">About</os-tab>
				</os-tabs>
				<os-tabpanel for="main">
					<p class="probe-main">MAIN CONTENT</p>
					<span data-role="probe-role">ROLE PROBE</span>
				</os-tabpanel>
				<os-tabpanel for="about">
					<p class="probe-about">ABOUT CONTENT</p>
				</os-tabpanel>
			</div>
		`;

		// Multiple microtasks so the connect + render + mutation
		// observer cascade all settles.
		await tick();
		await tick();
		await tick();

		const mainPanel = host.querySelector( 'os-tabpanel[for="main"]' )!;
		const aboutPanel = host.querySelector( 'os-tabpanel[for="about"]' )!;

		// The critical assertion: the server-rendered <p> element is
		// still a light-DOM descendant of the panel. In the old
		// light-DOM build this would be null because the render
		// replaced the panel's children with a bare <slot>.
		expect( mainPanel.querySelector( '.probe-main' ) ).not.toBeNull();
		expect(
			mainPanel.querySelector( '[data-role="probe-role"]' ),
		).not.toBeNull();
		expect( aboutPanel.querySelector( '.probe-about' ) ).not.toBeNull();

		// No stray <slot> leaked into light DOM (it should live in
		// the panel's shadow root, not the light-DOM child list).
		expect( mainPanel.querySelector( 'slot' ) ).toBeNull();
	} );
} );
