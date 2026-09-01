/**
 * The tray — the shell's controls strip on the dock's edge.
 *
 * What is pinned here is the handful of things that have actually
 * broken: the tray existing only where a bottom dock does, the label
 * living outside a strip that clips, the measurements surviving a
 * missing `ResizeObserver`, and surface and text coming from one token
 * family. The rest of the strip's look is left to the stylesheet.
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
import { findBottomDock, mountTray, type TrayApi } from '../../src/tray';

const ROOT = resolve( __dirname, '../..' );
const trayCss = (): string =>
	readFileSync( resolve( ROOT, 'assets/css/tray.css' ), 'utf8' );

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
		// The tray only exists to sit on a bottom dock, so every test
		// that expects one starts with one.
		addBottomDock();
	} );

	afterEach( () => {
		tray?.destroy();
		tray = null;
		vi.useRealTimers();
		document.body.innerHTML = '';
	} );

	function addBottomDock(): HTMLElement {
		const dock = document.createElement( 'div' );
		dock.className = 'os-dock';
		dock.setAttribute( 'data-os-dock-placement', 'bottom' );
		shell.appendChild( dock );
		return dock;
	}

	const mount = (): HTMLElement => {
		tray = mountTray( shell, { openAssistant: () => ( opened += 1 ) } );
		return shell.querySelector< HTMLElement >( '.os-tray' )!;
	};

	test( 'mounts one strip of two controls', () => {
		expect( mount().querySelectorAll( '.os-tray__group' ) ).toHaveLength(
			2
		);
	} );

	test( 'the assistant control opens the assistant', () => {
		const button = mount().querySelector< HTMLButtonElement >(
			'.os-tray__assistant'
		)!;
		expect( button.tabIndex ).toBe( 0 );
		button.click();
		expect( opened ).toBe( 1 );
	} );

	test( 'the exit control carries the glyph it wore on the dock', () => {
		expect(
			mount().querySelector( '.os-tray__exit .dashicons-exit' )
		).not.toBeNull();
	} );

	/*
	 * `⌘K`, but `Ctrl+K`. `⌘` is a symbol and reads as its own key with
	 * nothing between it and the `K`; `Ctrl` is letters, and set against
	 * another letter it comes out as "CtrlK".
	 */
	test( 'the chord is spelled the way each platform spells it', () => {
		const platform = Object.getOwnPropertyDescriptor(
			window.navigator,
			'platform'
		);
		const setPlatform = ( value: string ): void =>
			Object.defineProperty( window.navigator, 'platform', {
				value,
				configurable: true,
			} );

		try {
			setPlatform( 'MacIntel' );
			expect( mount().querySelector( '.os-chord' )!.textContent ).toBe(
				'⌘K'
			);
			tray!.destroy();
			tray = null;

			setPlatform( 'Win32' );
			expect( mount().querySelector( '.os-chord' )!.textContent ).toBe(
				'Ctrl+K'
			);
		} finally {
			if ( platform ) {
				Object.defineProperty(
					window.navigator,
					'platform',
					platform
				);
			}
		}
	} );

	/*
	 * Both controls are a bare glyph in 16px of the dock's edge, so both
	 * name themselves on hover. The label repeats the `aria-label` for
	 * the eye only, which is what keeps neither hover-only for anyone
	 * not using a pointer.
	 *
	 * It is hosted in `document.body` because the strip clips
	 * (`overflow: hidden`, which keeps a hover fill inside the rounded
	 * corners) and the label opens above the strip.
	 */
	test( 'every control names itself, on hover and to assistive tech', () => {
		const el = mount();
		const tip = document.querySelector( '.os-tray__tip' )!;
		expect( tip.parentElement ).toBe( document.body );
		expect( tip.getAttribute( 'aria-hidden' ) ).toBe( 'true' );

		for ( const [ selector, label ] of [
			[ '.os-tray__assistant', 'Open site assistant' ],
			[ '.os-tray__exit', 'Exit OpenStation' ],
		] as const ) {
			const button = el.querySelector< HTMLElement >( selector )!;
			expect( button.getAttribute( 'aria-label' ) ).toBe( label );

			button.dispatchEvent( new Event( 'pointerenter' ) );
			expect( tip.textContent ).toBe( label );
			expect( tip.classList.contains( 'os-tray__tip--on' ) ).toBe( true );
			button.dispatchEvent( new Event( 'pointerleave' ) );
			expect( tip.classList.contains( 'os-tray__tip--on' ) ).toBe(
				false
			);
		}

		// Put the label back inside the strip and it silently vanishes.
		expect(
			/\n\.os-tray \{([\s\S]*?)\n\}/.exec( trayCss() )?.[ 1 ]
		).toMatch( /overflow: hidden/ );
	} );

	/*
	 * Body-hosted means it outlives its own strip unless something takes
	 * it away — otherwise a tray torn down on a layout change leaves one
	 * orphaned label per rebuild.
	 */
	test( 'destroy takes the label with it', () => {
		mount();
		tray!.destroy();
		tray = null;
		expect( document.querySelector( '.os-tray__tip' ) ).toBeNull();
	} );

	/*
	 * No bottom dock, no tray: a side-placed rail takes the same two
	 * controls as dock tiles instead. Detached rather than hidden,
	 * because the work area measures `.os-tray` — a tray left in the DOM
	 * would go on reserving a band nothing occupies.
	 */
	test( 'it exists only where a bottom dock does', () => {
		shell.querySelector( '.os-dock' )!.remove();
		mount();
		expect( shell.querySelector( '.os-tray' ) ).toBeNull();

		addBottomDock();
		document.dispatchEvent( new CustomEvent( 'os-layout-changed' ) );
		expect( shell.querySelector( '.os-tray' ) ).not.toBeNull();
	} );

	test( 'it detaches when the rail moves off the bottom', () => {
		const el = mount();
		shell
			.querySelector( '.os-dock' )!
			.setAttribute( 'data-os-dock-placement', 'left' );
		document.dispatchEvent( new CustomEvent( 'os-layout-changed' ) );
		expect( el.isConnected ).toBe( false );
	} );

	/*
	 * The rail tiles are the ELSE branch of the tray, so both hang off
	 * the same question. The Split layout is where a lookalike goes
	 * wrong: it has a sidebar AND a bottom dock, and stores the user's
	 * placement pick without acting on it, so `getDockPlacement()`
	 * answers `'left'` while the tray is on screen. Keying the tiles off
	 * that put the assistant in Split twice.
	 */
	test( 'a bottom dock rules out the rail tiles', () => {
		const sidebar = document.createElement( 'div' );
		sidebar.className = 'os-dock';
		sidebar.setAttribute( 'data-os-dock-placement', 'left' );
		shell.appendChild( sidebar );
		expect( findBottomDock() ).not.toBeNull();

		shell
			.querySelector( '[ data-os-dock-placement="bottom" ]' )!
			.remove();
		expect( findBottomDock() ).toBeNull();
	} );

	/*
	 * This runs during shell boot, so an unguarded `ResizeObserver`
	 * constructor would take the desktop with it. And the degraded path
	 * is not merely "does not crash": the tray still has to be
	 * positioned, so the direct measure runs whether or not anything is
	 * observing.
	 */
	test( 'it still measures where ResizeObserver is unavailable', () => {
		const real = window.ResizeObserver;
		// @ts-expect-error — deleting a lib.dom global for the test.
		delete window.ResizeObserver;

		try {
			// jsdom gives every element a zero box, and the measure
			// declines to publish one.
			shell.querySelector( '.os-dock' )!.getBoundingClientRect = () =>
				( {
					width: 480,
					height: 56,
					left: 100,
					bottom: 700,
				} as DOMRect );

			const el = mount();
			expect( el.style.getPropertyValue( '--os-tray-dock-width' ) ).toBe(
				'480px'
			);
			expect(
				el.style.getPropertyValue( '--os-tray-dock-height' )
			).toBe( '56px' );
		} finally {
			window.ResizeObserver = real;
		}
	} );

	/*
	 * Surface and text have to come from the SAME token family, and this
	 * has bitten three times. The tray's background is the dock's glass,
	 * so its foreground must be the dock's too: Legacy declares
	 * `--os-dock-floating-bg` dark and `--os-ui-fg` as #1d2327, which
	 * rendered near-black text on a dark strip.
	 */
	test( 'text and surface are read from one token family', () => {
		const declarations = trayCss()
			// The prose below names the very tokens it forbids, and the
			// label is a self-contained lozenge with its own pair.
			.replace( /\/\*[\s\S]*?\*\//g, '' )
			.replace( /\.os-tray__tip \{[^}]*\}/g, '' );

		expect( declarations ).not.toMatch( /--os-ui-fg/ );
		expect( declarations ).not.toMatch( /--os-ui-surface/ );
		expect( declarations ).toMatch( /--os-dock-icon-color/ );
		expect( declarations ).toMatch( /--os-dock-floating-bg/ );
	} );

	/*
	 * Two rules that only make sense together: the rail gives up its top
	 * padding for the assistant band, and takes it back where there is
	 * no band. Split needs the second half.
	 */
	test( 'a vertical rail keeps its top padding without the band', () => {
		const dockCss = readFileSync(
			resolve( ROOT, 'assets/css/dock.css' ),
			'utf8'
		);
		expect( dockCss ).toMatch( /padding: 0 0 12px/ );
		expect( dockCss ).toMatch(
			/:not\(\s*:has\( \.os-dock__item--assistant \)\s*\)[\s\S]*?padding-block-start: 16px/
		);
	} );

	test( 'destroy removes it, and mounting twice leaves one', () => {
		mount();
		tray!.destroy();
		tray = null;
		expect( shell.querySelector( '.os-tray' ) ).toBeNull();

		mount();
		const second = mountTray( shell, { openAssistant: () => {} } );
		expect( document.querySelectorAll( '.os-tray' ) ).toHaveLength( 1 );
		second.destroy();
	} );

	/*
	 * A destroyed tray that kept answering layout events would re-attach
	 * itself to a shell nobody asked, and hold the listener alive to do
	 * it.
	 */
	test( 'destroy drops the layout listener', () => {
		const el = mount();
		tray!.destroy();
		tray = null;

		document.dispatchEvent( new CustomEvent( 'os-layout-changed' ) );
		expect( el.isConnected ).toBe( false );
	} );
} );
