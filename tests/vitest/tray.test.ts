/**
 * The tray — the shell's top-right surface.
 *
 * What is pinned here is the contract that makes it safe to put
 * something back at the top edge at all:
 *
 * - It never reserves work area. A 32px full-width bar that stole
 *   height is what OpenStation removed; an element that reserved
 *   space would be the same mistake in a nicer shape. This is the one
 *   test that would fail loudly if someone "fixed" an overlap by
 *   padding the desk.
 * - It loses to the windows. The pills hang over the strip a title bar
 *   occupies, so they stack below the window band rather than over it.
 * - It opens the assistant, through the same document event any
 *   plugin would use, without importing the lazy assistant bundle.
 */

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountTray, type TrayApi } from '../../src/tray';

const ROOT = resolve( __dirname, '../..' );

/** The number `variables.css` declares for a z-index token. */
function zToken( token: string ): number {
	const css = readFileSync(
		resolve( ROOT, 'assets/css/variables.css' ),
		'utf8'
	);
	const match = new RegExp( `\\n\\t${ token }:\\s*([^;]+);` ).exec( css );
	return Number( match?.[ 1 ].trim() );
}

describe( 'the tray', () => {
	let shell: HTMLElement;
	let tray: TrayApi | null = null;
	let opened: number;

	beforeEach( () => {
		vi.useFakeTimers();
		opened = 0;
		shell = document.createElement( 'div' );
		shell.className = 'os-shell';
		document.body.appendChild( shell );
	} );

	afterEach( () => {
		tray?.destroy();
		tray = null;
		vi.useRealTimers();
		document.body.innerHTML = '';
	} );

	const mount = (): HTMLElement => {
		tray = mountTray( shell, {
			openAssistant: () => {
				opened += 1;
			},
		} );
		return shell.querySelector< HTMLElement >( '.os-tray' )!;
	};

	test( 'mounts one pill of two sections on the shell', () => {
		const el = mount();
		expect( el ).not.toBeNull();
		expect( el.querySelectorAll( '.os-tray__group' ) ).toHaveLength( 2 );
	} );

	/*
	 * The way out of the shell. It moved here off the dock, and the
	 * thing to keep true is that it stays reachable without a pointer:
	 * the tooltip is decoration, `aria-label` is the label.
	 */
	test( 'the exit section is a labelled button carrying a tooltip', () => {
		const el = mount();
		const button = el.querySelector< HTMLButtonElement >(
			'.os-tray__exit'
		)!;

		expect( button ).not.toBeNull();
		expect( button.tagName ).toBe( 'BUTTON' );
		expect( button.getAttribute( 'aria-label' ) ).toBe(
			'Exit OpenStation'
		);
		expect( button.tabIndex ).toBe( 0 );

		// The same glyph it wore on the dock.
		expect(
			button.querySelector( '.dashicons-exit' )
		).not.toBeNull();

		// The tooltip repeats the label for the eye only — announced
		// twice would read the control twice.
		const tip = button.querySelector( '.os-tray__tip' )!;
		expect( tip.textContent ).toBe( 'Exit OpenStation' );
		expect( tip.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
	} );

	/*
	 * The tooltip has to escape the pill to be readable, so the pill
	 * cannot clip — and `position: fixed` is no escape either, since
	 * the backdrop-filter makes the tray a containing block. The caps
	 * are therefore the outer sections' own radii rather than an
	 * `overflow: hidden` on the parent, and that swap is what this
	 * pins: put the clip back and the tooltip silently disappears.
	 */
	test( 'the pill does not clip, and the outer sections carry the caps', () => {
		const trayCss = readFileSync(
			resolve( ROOT, 'assets/css/tray.css' ),
			'utf8'
		);
		const root =
			/\n\.os-tray \{([^}]*)\}/.exec( trayCss )?.[ 1 ] ?? '';

		expect( root ).toMatch( /overflow:\s*visible/ );
		expect( trayCss ).toMatch(
			/\.os-tray__group:first-child \{\s*border-start-start-radius:/
		);
		expect( trayCss ).toMatch(
			/\.os-tray__group:last-child \{\s*border-start-end-radius:/
		);
		// Above the section: below is where the dock is, and in shelf
		// mode the pill rests directly on it.
		expect( trayCss ).toMatch(
			/\.os-tray__tip \{[^}]*bottom:\s*calc\( 100% \+/
		);
	} );

	/*
	 * The pill is one surface with dividers, not three capsules in a
	 * row: the element draws the background, hairline and rounded
	 * caps, and the sections draw only a leading-edge divider. Three
	 * separately-bordered children sharing an edge would double the
	 * hairline at every seam, and each would need to know which end of
	 * the row it was on to round the correct two corners.
	 *
	 * The divider being a LEADING-edge border is what keeps it off the
	 * outer caps — `:first-child` has nothing to its leading side — so
	 * this pins that it is never re-expressed as a trailing one.
	 */
	test( 'the pill is one surface, divided rather than repeated', () => {
		const trayCss = readFileSync(
			resolve( ROOT, 'assets/css/tray.css' ),
			'utf8'
		);

		const root = /\n\.os-tray \{([^}]*)\}/.exec( trayCss )?.[ 1 ] ?? '';
		const section = /\n\.os-tray__group \{([^}]*)\}/.exec( trayCss )?.[ 1 ] ?? '';

		// The element carries the capsule…
		expect( root ).toMatch( /border-radius:/ );
		expect( root ).toMatch( /background:/ );

		// …and the sections carry no surface of their own, only the
		// divider, on the leading edge. (The outer two also carry the
		// cap radii — see the clipping test — but no fill, border or
		// shadow of their own.)
		expect( section ).toMatch( /border:\s*0/ );
		expect( section ).toMatch( /border-inline-start:/ );
		expect( section ).not.toMatch( /border-inline-end:/ );
		expect( section ).toMatch( /background:\s*none/ );
		expect( trayCss ).toMatch(
			/\.os-tray__group:first-child \{\s*border-inline-start:\s*0;/
		);
	} );

	test( 'the assistant pill is a labelled button that opens the assistant', () => {
		const button = mount().querySelector< HTMLElement >(
			'.os-tray__assistant'
		)!;
		expect( button.tagName ).toBe( 'BUTTON' );
		expect( button.getAttribute( 'aria-label' ) ).toBeTruthy();

		button.click();
		expect( opened ).toBe( 1 );
	} );

	/*
	 * The load-bearing one. The tray overlaps the top edge on purpose
	 * and gets out of the way (CSS stacks it under the windows) rather
	 * than pushing the desk down — so it must not touch the work area,
	 * in either direction.
	 */
	test( 'reserves no work area', () => {
		const area = document.createElement( 'div' );
		area.className = 'os-area';
		shell.appendChild( area );
		const before = area.getAttribute( 'style' );

		mount();

		expect( area.getAttribute( 'style' ) ).toBe( before );
		expect( area.style.paddingTop ).toBe( '' );
		expect( document.documentElement.style.paddingTop ).toBe( '' );
		expect( document.body.style.paddingTop ).toBe( '' );
	} );

	/*
	 * The other half of "gets out of the way": the tray hangs over the
	 * strip a window's title bar occupies, so it has to lose to that
	 * window. Above the window band it reads as the shell talking over
	 * whatever the user is working in — and the pills would also eat
	 * the clicks meant for the title bar underneath them.
	 */
	test( 'stacks under the window band, above the window-link wires', () => {
		const trayZ = zToken( '--os-z-tray' );

		expect( trayZ ).toBeLessThan( zToken( '--os-z-base' ) );
		expect( trayZ ).toBeGreaterThan( zToken( '--os-z-window-links' ) );

		// The fallback literal in the consuming rule is the floor if
		// `variables.css` never loads, so it has to say the same thing.
		const trayCss = readFileSync(
			resolve( ROOT, 'assets/css/tray.css' ),
			'utf8'
		);
		expect( trayCss ).toContain( `var( --os-z-tray, ${ trayZ } )` );
	} );

	/*
	 * In PILL mode the widgets column starts in the same corner, so it
	 * yields — and it has to yield past the BOTTOM of the pill, its
	 * inset plus its height, not merely past its height. A smaller
	 * number puts a widget card under the tray, and reading the two
	 * files against each other is the only way to catch that, since
	 * nothing at runtime measures the overlap.
	 *
	 * Scoped to pill mode, and that scoping is the other half: in
	 * shelf mode the tray is at the bottom of the screen and the
	 * column would be paying 34px of clearance for an empty corner.
	 */
	test( 'the widgets column clears the pill, and only in pill mode', () => {
		const trayCss = readFileSync(
			resolve( ROOT, 'assets/css/tray.css' ),
			'utf8'
		);
		const desktopCss = readFileSync(
			resolve( ROOT, 'assets/css/desktop.css' ),
			'utf8'
		);

		const inset = Number(
			/--os-tray-inset,\s*(\d+)px/.exec( trayCss )?.[ 1 ]
		);
		const pillHeight = Number(
			/--os-tray-height,\s*(\d+)px/.exec( trayCss )?.[ 1 ]
		);
		const scoped =
			/:has\( \.os-tray\[ data-os-tray-mode="pill" \] \) \.os-widgets \{\s*top:\s*(\d+)px/.exec(
				desktopCss
			);
		const columnTop = Number( scoped?.[ 1 ] );

		expect( inset ).toBeGreaterThan( 0 );
		expect( pillHeight ).toBeGreaterThan( 0 );
		expect( scoped ).not.toBeNull();
		expect( columnTop ).toBeGreaterThanOrEqual( inset + pillHeight );
	} );

	/*
	 * Which of the two placements is live is decided from whether
	 * there is a bottom dock to tuck behind. A left- or right-placed
	 * dock leaves no bottom rail, and a tray that stayed in shelf mode
	 * would be anchored to an element that no longer exists — parked
	 * over the bottom edge of the desk with nothing behind it.
	 */
	test( 'it shelves behind a bottom dock and falls back to a pill without one', () => {
		mount();
		expect(
			shell.querySelector< HTMLElement >( '.os-tray' )!.dataset
				.osTrayMode
		).toBe( 'pill' );

		tray!.destroy();
		tray = null;

		const dock = document.createElement( 'div' );
		dock.className = 'os-dock';
		dock.setAttribute( 'data-os-dock-placement', 'bottom' );
		shell.appendChild( dock );

		expect( mount().dataset.osTrayMode ).toBe( 'shelf' );
	} );

	/*
	 * The dispatcher tears rails down and builds fresh ones on every
	 * layout or placement change, so the element the tray measured is
	 * gone afterwards. Re-evaluating on `os-layout-changed` is what
	 * keeps a tray that was shelved from staying anchored to a dock
	 * that has been replaced by a side rail.
	 */
	test( 'it re-evaluates its placement when the layout is rebuilt', () => {
		const dock = document.createElement( 'div' );
		dock.className = 'os-dock';
		dock.setAttribute( 'data-os-dock-placement', 'bottom' );
		shell.appendChild( dock );

		const el = mount();
		expect( el.dataset.osTrayMode ).toBe( 'shelf' );

		// The user moves their single rail to the left edge.
		dock.setAttribute( 'data-os-dock-placement', 'left' );
		document.dispatchEvent( new CustomEvent( 'os-layout-changed' ) );

		expect( el.dataset.osTrayMode ).toBe( 'pill' );
	} );

	/*
	 * The shelf's measurements have to land in an environment with no
	 * `ResizeObserver`. This runs during shell boot, so an unguarded
	 * constructor would throw there and take the desktop with it —
	 * and the degraded path is not merely "does not crash": the
	 * shelf still has to be positioned, which means the direct
	 * measure has to run whether or not anything is observing.
	 */
	test( 'it still measures where ResizeObserver is unavailable', () => {
		const real = window.ResizeObserver;
		// @ts-expect-error — deleting a lib.dom global for the test.
		delete window.ResizeObserver;

		try {
			const dock = document.createElement( 'div' );
			dock.className = 'os-dock';
			dock.setAttribute( 'data-os-dock-placement', 'bottom' );
			// jsdom gives every element a zero box, and the measure
			// declines to publish one. A stub box is what lets the
			// write path be asserted at all.
			dock.getBoundingClientRect = () =>
				( { width: 480, height: 56, left: 100, bottom: 700 } as DOMRect );
			shell.appendChild( dock );

			const el = mount();

			expect( el.dataset.osTrayMode ).toBe( 'shelf' );
			expect(
				el.style.getPropertyValue( '--os-tray-dock-width' )
			).toBe( '480px' );
			expect(
				el.style.getPropertyValue( '--os-tray-dock-height' )
			).toBe( '56px' );
		} finally {
			window.ResizeObserver = real;
		}
	} );

	/*
	 * A dock with no box yet says nothing. Publishing its zero would
	 * park the shelf at the shell's leading edge for a frame, which
	 * is worse than the centre the stylesheet falls back to while the
	 * properties are unset.
	 */
	test( 'a dock with no layout yet is not published', () => {
		const dock = document.createElement( 'div' );
		dock.className = 'os-dock';
		dock.setAttribute( 'data-os-dock-placement', 'bottom' );
		shell.appendChild( dock );

		const el = mount();

		expect( el.dataset.osTrayMode ).toBe( 'shelf' );
		expect( el.style.getPropertyValue( '--os-tray-dock-width' ) ).toBe(
			''
		);
	} );

	test( 'destroy drops the layout listener', () => {
		const el = mount();
		tray!.destroy();
		tray = null;

		const dock = document.createElement( 'div' );
		dock.className = 'os-dock';
		dock.setAttribute( 'data-os-dock-placement', 'bottom' );
		shell.appendChild( dock );
		document.dispatchEvent( new CustomEvent( 'os-layout-changed' ) );

		// Still whatever it was at teardown — a detached tray that
		// kept answering layout events would be writing to an element
		// nothing can see, and holding the shell alive to do it.
		expect( el.dataset.osTrayMode ).toBe( 'pill' );
	} );

	/*
	 * Surface and text have to come from the SAME token family.
	 *
	 * The tray's background is the dock's glass, so its foreground
	 * must be the dock's foreground. Split across two families, a
	 * theme that moves one cannot move the other — Legacy declares
	 * `--os-dock-floating-bg` dark and `--os-ui-fg` as #1d2327
	 * (its palette foreground is for light surfaces like cards and
	 * windows), which rendered near-black text on a dark shelf.
	 *
	 * Asserted against the declarations rather than the comments,
	 * because the reasoning above names the very tokens it forbids.
	 */
	test( 'text and surface are read from one token family', () => {
		const declarations = readFileSync(
			resolve( ROOT, 'assets/css/tray.css' ),
			'utf8'
		)
			// Strip block comments; prose here discusses the palette
			// tokens by name and would otherwise fail its own rule.
			.replace( /\/\*[\s\S]*?\*\//g, '' )
			// …and the tooltip, which is not on the pill's surface at
			// all. It is a self-contained lozenge carrying its own
			// matched `--os-tooltip-bg` / `--os-tooltip-fg` pair, so it
			// satisfies this rule through a different family; the
			// palette names appear only as its second-level fallbacks,
			// copied from `dock.css` so the two tooltips agree.
			.replace( /\.os-tray__tip \{[^}]*\}/g, '' );

		expect( declarations ).not.toMatch( /--os-ui-fg/ );
		expect( declarations ).not.toMatch( /--os-ui-surface/ );
		// …and the pair it should be reading instead is present.
		expect( declarations ).toMatch( /--os-dock-icon-color-hover/ );
		expect( declarations ).toMatch( /--os-dock-icon-color,/ );
		expect( declarations ).toMatch( /--os-dock-floating-bg/ );
	} );

	test( 'destroy removes it', () => {
		mount();
		tray!.destroy();
		tray = null;
		expect( shell.querySelector( '.os-tray' ) ).toBeNull();
	} );

	test( 'mounting twice leaves one tray', () => {
		mount();
		const second = mountTray( shell, { openAssistant: () => {} } );
		expect( document.querySelectorAll( '.os-tray' ) ).toHaveLength( 1 );
		second.destroy();
	} );
} );
