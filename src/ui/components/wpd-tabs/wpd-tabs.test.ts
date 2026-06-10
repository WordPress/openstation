import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-tabs';

const tick = (): Promise<void> => Promise.resolve();

describe( '<wpd-tabs> + <wpd-tab>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'clicking a tab bubbles wpd-tab-change + updates aria-selected', async () => {
		host.innerHTML = `
			<wpd-tabs value="library" label="Source">
				<wpd-tab value="upload">Upload</wpd-tab>
				<wpd-tab value="library">Library</wpd-tab>
			</wpd-tabs>
		`;
		await tick();
		await tick();
		const strip = host.querySelector( 'wpd-tabs' )!;
		const upload = host.querySelector( 'wpd-tab[value="upload"]' )!;
		const library = host.querySelector( 'wpd-tab[value="library"]' )!;

		expect( library.getAttribute( 'aria-selected' ) ).toBe( 'true' );
		expect( upload.getAttribute( 'aria-selected' ) ).toBe( 'false' );

		let heard: string | null = null;
		strip.addEventListener( 'wpd-tab-change', ( e ) => {
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
			<wpd-tabs value="a" label="Source">
				<wpd-tab value="a">A</wpd-tab>
			</wpd-tabs>
		`;
		await tick();
		const strip = host.querySelector( 'wpd-tabs' )!;
		expect( strip.getAttribute( 'role' ) ).toBe( 'tablist' );
		expect( strip.getAttribute( 'aria-label' ) ).toBe( 'Source' );
		expect(
			host.querySelector( 'wpd-tab' )!.getAttribute( 'role' ),
		).toBe( 'tab' );
	} );

	test( 'sibling <wpd-tabpanel> elements auto-hide based on the active value', async () => {
		host.innerHTML = `
			<div class="scope">
				<wpd-tabs value="calc">
					<wpd-tab value="calc">Calc</wpd-tab>
					<wpd-tab value="convert">Convert</wpd-tab>
				</wpd-tabs>
				<wpd-tabpanel for="calc">CALC PANE</wpd-tabpanel>
				<wpd-tabpanel for="convert">CONV PANE</wpd-tabpanel>
			</div>
		`;
		await tick();
		await tick();

		const calcPane = host.querySelector( 'wpd-tabpanel[for="calc"]' )!;
		const convPane = host.querySelector( 'wpd-tabpanel[for="convert"]' )!;
		expect( calcPane.hasAttribute( 'hidden' ) ).toBe( false );
		expect( convPane.hasAttribute( 'hidden' ) ).toBe( true );

		// Click the Convert tab — the auto-swap should flip hidden
		// without any JS listener on the caller's side.
		host.querySelector( 'wpd-tab[value="convert"]' )!
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
				<wpd-tabs value="b">
					<wpd-tab value="a">A</wpd-tab>
					<wpd-tab value="b">B</wpd-tab>
				</wpd-tabs>
				<wpd-tabpanel for="a">A PANE</wpd-tabpanel>
			</div>
		`;
		await tick();
		await tick();

		const scope = host.querySelector( '.scope' )!;
		const late = document.createElement( 'wpd-tabpanel' );
		late.setAttribute( 'for', 'b' );
		late.textContent = 'B PANE';
		scope.appendChild( late );
		await tick();
		await tick();

		const a = host.querySelector( 'wpd-tabpanel[for="a"]' )!;
		expect( a.hasAttribute( 'hidden' ) ).toBe( true );
		expect( late.hasAttribute( 'hidden' ) ).toBe( false );
		expect( late.getAttribute( 'role' ) ).toBe( 'tabpanel' );
	} );

	test( '.items setter replaces children and preserves value when it still matches', async () => {
		host.innerHTML = `<wpd-tabs value="a"></wpd-tabs>`;
		await tick();

		const tabs = host.querySelector( 'wpd-tabs' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
		};
		tabs.items = [
			{ value: 'a', label: 'First' },
			{ value: 'b', label: 'Second' },
		];
		await tick();
		await tick();

		const tabEls = host.querySelectorAll( 'wpd-tab' );
		expect( tabEls.length ).toBe( 2 );
		expect( tabEls[ 0 ].getAttribute( 'value' ) ).toBe( 'a' );
		expect( tabEls[ 0 ].textContent?.trim() ).toBe( 'First' );
		expect( tabs.getAttribute( 'value' ) ).toBe( 'a' );
		expect( tabEls[ 0 ].getAttribute( 'aria-selected' ) ).toBe( 'true' );
	} );

	test( '.items setter falls back to first item when old value is no longer in the list', async () => {
		host.innerHTML = `<wpd-tabs value="missing"></wpd-tabs>`;
		await tick();

		const tabs = host.querySelector( 'wpd-tabs' ) as HTMLElement & {
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
	test( 'server-rendered children inside <wpd-tabpanel> survive mount', async () => {
		host.innerHTML = `
			<div class="scope">
				<wpd-tabs value="main">
					<wpd-tab value="main">Main</wpd-tab>
					<wpd-tab value="about">About</wpd-tab>
				</wpd-tabs>
				<wpd-tabpanel for="main">
					<p class="probe-main">MAIN CONTENT</p>
					<span data-role="probe-role">ROLE PROBE</span>
				</wpd-tabpanel>
				<wpd-tabpanel for="about">
					<p class="probe-about">ABOUT CONTENT</p>
				</wpd-tabpanel>
			</div>
		`;

		// Multiple microtasks so the connect + render + mutation
		// observer cascade all settles.
		await tick();
		await tick();
		await tick();

		const mainPanel = host.querySelector( 'wpd-tabpanel[for="main"]' )!;
		const aboutPanel = host.querySelector( 'wpd-tabpanel[for="about"]' )!;

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
