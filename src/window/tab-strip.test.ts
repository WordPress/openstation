/**
 * The window tab strip's own behaviour: panel tabs, the roving
 * tabindex, and the keyboard.
 *
 * jsdom lays nothing out, so every offset reads 0. That rules out
 * asserting the plate's geometry here (the browser check covers it)
 * and rules nothing else out: the tablist contract is attributes and
 * focus, both of which jsdom models faithfully.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import {
	activatePanelTab,
	handleTabStripKeydown,
	setPanelTabs,
	syncTabRoving,
} from './tab-strip';

/** A window root with an empty strip and three panes, as `dom.ts` builds it. */
function mountWindow( panes: string[] = [ 'one', 'two', 'three' ] ): HTMLElement {
	const win = document.createElement( 'div' );
	win.className = 'os-window';
	win.id = 'wp-window-test';
	win.innerHTML = `
		<nav class="os-window__tabs" role="tablist">
			<span class="os-window__tab-plate" aria-hidden="true"></span>
		</nav>
		<div class="os-window__body">
			${ panes
				.map( ( p ) => `<os-tabpanel for="${ p }">${ p } pane</os-tabpanel>` )
				.join( '' ) }
		</div>
	`;
	document.body.appendChild( win );
	return win;
}

const ENTRIES = [
	{ value: 'one', label: 'One' },
	{ value: 'two', label: 'Two' },
	{ value: 'three', label: 'Three' },
];

const tabsOf = ( win: HTMLElement ): HTMLElement[] =>
	Array.from( win.querySelectorAll< HTMLElement >( '.os-window__tab' ) );

const stripOf = ( win: HTMLElement ): HTMLElement =>
	win.querySelector< HTMLElement >( '.os-window__tabs' )!;

const press = ( win: HTMLElement, from: HTMLElement, key: string ): void => {
	const event = new KeyboardEvent( 'keydown', { key, bubbles: true } );
	Object.defineProperty( event, 'target', { value: from } );
	handleTabStripKeydown( stripOf( win ), event );
};

describe( 'panel tabs', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'builds one tab per entry, after the plate', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES );

		const tabs = tabsOf( win );
		expect( tabs.map( ( t ) => t.textContent ) ).toEqual( [
			'One',
			'Two',
			'Three',
		] );
		// The plate paints beneath the labels, so it stays first.
		expect(
			stripOf( win ).firstElementChild!.classList.contains(
				'os-window__tab-plate',
			),
		).toBe( true );
		for ( const tab of tabs ) {
			expect( tab.getAttribute( 'role' ) ).toBe( 'tab' );
			expect( tab.dataset.kind ).toBe( 'panel' );
		}
	} );

	test( 'pairs every tab to its pane in both directions', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES );

		const tab = tabsOf( win )[ 1 ];
		const pane = win.querySelector( 'os-tabpanel[for="two"]' )!;
		// A screen reader needs to get from the tab to the pane AND
		// from the pane back to the name of the tab that owns it.
		expect( tab.getAttribute( 'aria-controls' ) ).toBe( pane.id );
		expect( pane.getAttribute( 'aria-labelledby' ) ).toBe( tab.id );
		expect( tab.id ).not.toBe( '' );
		expect( pane.id ).not.toBe( '' );
	} );

	test( 'shows exactly one pane and marks the rest hidden', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES, 'two' );

		const panes = Array.from(
			win.querySelectorAll< HTMLElement >( 'os-tabpanel' ),
		);
		expect(
			panes.filter( ( p ) => ! p.hasAttribute( 'hidden' ) ).map( ( p ) =>
				p.getAttribute( 'for' ),
			),
		).toEqual( [ 'two' ] );
		expect( panes[ 0 ].getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		expect( panes[ 1 ].getAttribute( 'aria-hidden' ) ).toBe( 'false' );
	} );

	test( 'activating fires a bubbling event carrying the value', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES );
		let heard: string | null = null;
		document.addEventListener( 'os-window-tab-change', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );

		activatePanelTab( win, 'three' );

		expect( heard ).toBe( 'three' );
	} );

	test( 'ignores a value that matches no tab rather than blanking the strip', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES, 'two' );

		activatePanelTab( win, 'nope' );

		// Still on two: a bad id is a caller mistake, not a reason to
		// leave the user looking at a window with no pane showing.
		expect(
			win.querySelector( 'os-tabpanel[for="two"]' )!.hasAttribute( 'hidden' ),
		).toBe( false );
	} );
} );

describe( 'panel tabs, re-declared', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'reuses the existing button so focus survives a live re-declare', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES );
		const before = tabsOf( win )[ 1 ];
		before.focus();

		// A plugin registering a tab mid-session re-runs this.
		setPanelTabs( win, [
			...ENTRIES,
			{ value: 'four', label: 'Four' },
		] );

		expect( tabsOf( win )[ 1 ] ).toBe( before );
		expect( win.ownerDocument.activeElement ).toBe( before );
		expect( tabsOf( win ) ).toHaveLength( 4 );
	} );

	test( 'holds the user on their tab when the list changes under them', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES );
		activatePanelTab( win, 'three' );

		setPanelTabs( win, [ { value: 'zero', label: 'Zero' }, ...ENTRIES ] );

		expect(
			win.querySelector( '.os-window__tab--active' )!.textContent,
		).toBe( 'Three' );
	} );

	test( 'an explicit active value overrides where the user was', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES );
		activatePanelTab( win, 'three' );

		setPanelTabs( win, ENTRIES, 'one' );

		expect(
			win.querySelector( '.os-window__tab--active' )!.textContent,
		).toBe( 'One' );
	} );

	test( 'drops tabs the caller stopped declaring', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES );

		setPanelTabs( win, [ ENTRIES[ 0 ] ] );

		expect( tabsOf( win ).map( ( t ) => t.textContent ) ).toEqual( [ 'One' ] );
	} );

	test( 'falls back to the first tab when the active one is removed', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES );
		activatePanelTab( win, 'three' );

		setPanelTabs( win, [ ENTRIES[ 0 ], ENTRIES[ 1 ] ] );

		expect(
			win.querySelector( '.os-window__tab--active' )!.textContent,
		).toBe( 'One' );
	} );
} );

describe( 'the tablist keyboard', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'exactly one tab is in the page tab order', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES, 'two' );
		syncTabRoving( stripOf( win ) );

		// The whole point of the roving tabindex: a strip of tabs is
		// ONE stop on the way to the window's content, not three.
		expect( tabsOf( win ).map( ( t ) => t.tabIndex ) ).toEqual( [
			-1, 0, -1,
		] );
	} );

	test( 'arrows move focus and carry the tab order with them', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES, 'one' );
		const [ one, two ] = tabsOf( win );
		one.focus();

		press( win, one, 'ArrowRight' );

		expect( win.ownerDocument.activeElement ).toBe( two );
		expect( two.tabIndex ).toBe( 0 );
		expect( one.tabIndex ).toBe( -1 );
	} );

	test( 'arrowing does NOT activate — the pane only changes on purpose', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES, 'one' );
		const [ one ] = tabsOf( win );
		one.focus();

		press( win, one, 'ArrowRight' );

		/*
		 * Manual activation. A submenu tab loads an admin page and a
		 * panel tab can mount a canvas, so arrowing past eight tabs
		 * must not fire eight of those on the way.
		 */
		expect( one.getAttribute( 'aria-selected' ) ).toBe( 'true' );
		expect(
			win.querySelector( 'os-tabpanel[for="one"]' )!.hasAttribute( 'hidden' ),
		).toBe( false );
	} );

	test( 'Home and End reach the ends; arrows do not wrap past them', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES );
		const [ one, , three ] = tabsOf( win );

		one.focus();
		press( win, one, 'End' );
		expect( win.ownerDocument.activeElement ).toBe( three );

		// No wrap: the strip scrolls, and wrapping would fling it
		// across its whole width in one keypress.
		press( win, three, 'ArrowRight' );
		expect( win.ownerDocument.activeElement ).toBe( three );

		press( win, three, 'Home' );
		expect( win.ownerDocument.activeElement ).toBe( one );
		press( win, one, 'ArrowLeft' );
		expect( win.ownerDocument.activeElement ).toBe( one );
	} );

	test( 'leaves modified keypresses to the browser', () => {
		const win = mountWindow();
		setPanelTabs( win, ENTRIES );
		const [ one ] = tabsOf( win );
		one.focus();

		const event = new KeyboardEvent( 'keydown', {
			key: 'ArrowRight',
			metaKey: true,
			bubbles: true,
		} );
		Object.defineProperty( event, 'target', { value: one } );
		handleTabStripKeydown( stripOf( win ), event );

		// Cmd+Arrow is the browser's, not ours.
		expect( win.ownerDocument.activeElement ).toBe( one );
	} );
} );

describe( 'panes nested below the body', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
	} );

	/**
	 * A server-registered window wraps its panes in `<os-stack>` for
	 * padding, so depth is not a usable signal for finding them.
	 */
	test( 'finds panes wrapped in a layout element', () => {
		const win = mountWindow( [] );
		win.querySelector( '.os-window__body' )!.innerHTML = `
			<os-stack gap="12" padding="16">
				<os-tabpanel for="main">Main</os-tabpanel>
				<os-tabpanel for="extra">Extra</os-tabpanel>
			</os-stack>
		`;

		setPanelTabs(
			win,
			[
				{ value: 'main', label: 'Main' },
				{ value: 'extra', label: 'Extra' },
			],
			'main',
		);

		expect(
			win.querySelector( 'os-tabpanel[for="main"]' )!.hasAttribute( 'hidden' ),
		).toBe( false );
		expect(
			win.querySelector( 'os-tabpanel[for="extra"]' )!.hasAttribute( 'hidden' ),
		).toBe( true );
	} );

	test( 'leaves a nested tab group alone', () => {
		const win = mountWindow( [] );
		win.querySelector( '.os-window__body' )!.innerHTML = `
			<os-tabpanel for="main">
				<os-tabs value="upload">
					<os-tab value="upload">Upload</os-tab>
					<os-tab value="library">Library</os-tab>
				</os-tabs>
				<os-tabpanel for="upload">Upload pane</os-tabpanel>
				<os-tabpanel for="library">Library pane</os-tabpanel>
			</os-tabpanel>
			<os-tabpanel for="extra">Extra</os-tabpanel>
		`;

		setPanelTabs(
			win,
			[
				{ value: 'main', label: 'Main' },
				{ value: 'extra', label: 'Extra' },
			],
			'main',
		);

		/*
		 * The inner switcher's panes are its own business. Claiming
		 * them would hide half that group on every outer tab change,
		 * and `for="upload"` matching no outer tab would hide it
		 * permanently.
		 */
		const inner = win.querySelector( 'os-tabpanel[for="upload"]' )!;
		expect( inner.hasAttribute( 'hidden' ) ).toBe( false );
		expect( inner.hasAttribute( 'aria-hidden' ) ).toBe( false );
	} );
} );
