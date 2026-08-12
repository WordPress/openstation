/**
 * Window activity, as the title bar reports it.
 *
 * The phase is painted three ways and this pins all three: the
 * `data-os-activity` attribute the glow behind the icon is drawn
 * from, the visually-hidden live region that says the same thing to
 * a screen reader, and the opt-in `[data-os-activity-indicator]`
 * element for anything that still wants a literal dot.
 *
 * The two structural facts worth pinning are easy to break by
 * accident: idle REMOVES the attribute (an idle window has to cost
 * nothing — no pseudo-element, no animation), and the glow hangs off
 * the icon SLOT HOST rather than the icon, because the icon can be an
 * `<img>` and because a plugin owning the `icon` slot replaces the
 * host's children.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from '../../src/window';
import type { WindowConfig } from '../../src/types';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const ROOT = resolve( __dirname, '../..' );
const CHROME_CSS = readFileSync(
	resolve( ROOT, 'assets/css/window-chrome.css' ),
	'utf8',
);
const VARIABLES_CSS = readFileSync(
	resolve( ROOT, 'assets/css/variables.css' ),
	'utf8',
);

function baseConfig( overrides: Partial< WindowConfig > = {} ): WindowConfig {
	return {
		id: 'activity-probe',
		url: 'http://example.test/wp-admin/edit.php',
		title: 'Posts',
		icon: 'dashicons-admin-post',
		x: 40,
		y: 40,
		width: 800,
		height: 600,
		...overrides,
	};
}

let win: Window;
let parent: HTMLElement;

function titleBar(): HTMLElement {
	return win.element.querySelector< HTMLElement >(
		'.os-window__titlebar',
	) as HTMLElement;
}

function liveRegion(): HTMLElement {
	return win.element.querySelector< HTMLElement >(
		'.os-window__activity-status',
	) as HTMLElement;
}

describe( 'window activity — title bar painting', () => {
	beforeEach( () => {
		installHooksStub();
		parent = document.createElement( 'div' );
		document.body.appendChild( parent );
		win = new Window( baseConfig() );
		parent.appendChild( win.element );
	} );

	afterEach( () => {
		parent.remove();
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'an idle window carries no activity attribute at all', () => {
		expect( titleBar().hasAttribute( 'data-os-activity' ) ).toBe( false );
		expect( liveRegion().textContent ).toBe( '' );
	} );

	test( 'in-flight phases set the attribute the glow is drawn from', () => {
		win.markActivity( 'saving' );
		expect( titleBar().getAttribute( 'data-os-activity' ) ).toBe( 'saving' );

		win.markActivity( 'pending' );
		expect( titleBar().getAttribute( 'data-os-activity' ) ).toBe( 'pending' );
	} );

	test( 'returning to idle removes the attribute rather than setting "idle"', () => {
		win.markActivity( 'saving' );
		win.markActivity( 'idle' );
		expect( titleBar().hasAttribute( 'data-os-activity' ) ).toBe( false );
	} );

	test( 'the colour outlives the phase, so the glow fades out mint', () => {
		// The exit begins the instant `data-os-activity` goes. If the
		// tint went with it, the glow would revert to the accent as it
		// started fading — a colour change, which reads as a blink and
		// not as a dissolve.
		win.markActivity( 'saved' );
		win.markActivity( 'idle' );
		expect( titleBar().hasAttribute( 'data-os-activity' ) ).toBe( false );
		expect( titleBar().getAttribute( 'data-os-activity-last' ) ).toBe(
			'saved',
		);
	} );

	test( 'the sticky phase follows the last non-idle phase, never idle', () => {
		win.markActivity( 'saving' );
		expect( titleBar().getAttribute( 'data-os-activity-last' ) ).toBe(
			'saving',
		);

		win.markActivity( 'failed', { error: 'Nope.' } );
		expect( titleBar().getAttribute( 'data-os-activity-last' ) ).toBe(
			'failed',
		);

		win.markActivity( 'idle' );
		expect( titleBar().getAttribute( 'data-os-activity-last' ) ).toBe(
			'failed',
		);
	} );

	test( 'the glow anchors on the icon slot host, which survives a slot repaint', () => {
		const host = win.element.querySelector( '.os-window__slot--icon' );
		expect( host ).not.toBeNull();
		expect( host!.querySelector( '.os-window__icon' ) ).not.toBeNull();

		win.repaintWindowSlots();

		// Same host element — a plugin owning the slot replaces its
		// children, so a pseudo-element on the host cannot be lost.
		expect(
			win.element.querySelector( '.os-window__slot--icon' ),
		).toBe( host );
	} );

	test( 'saving is not announced — only the outcome is', () => {
		win.markActivity( 'saving' );
		expect( liveRegion().textContent ).toBe( '' );
		expect( liveRegion().getAttribute( 'aria-live' ) ).toBe( 'polite' );
	} );

	test( 'success is announced politely', () => {
		win.markActivity( 'saved' );
		expect( titleBar().getAttribute( 'data-os-activity' ) ).toBe( 'saved' );
		expect( liveRegion().textContent ).toBe( 'Saved' );
		expect( liveRegion().getAttribute( 'role' ) ).toBe( 'status' );
		expect( liveRegion().getAttribute( 'aria-live' ) ).toBe( 'polite' );
	} );

	test( 'failure is announced assertively and carries the error', () => {
		win.markActivity( 'failed', {
			error: 'Request failed (HTTP 500 Internal Server Error).',
		} );
		expect( titleBar().getAttribute( 'data-os-activity' ) ).toBe( 'failed' );
		expect( liveRegion().getAttribute( 'role' ) ).toBe( 'alert' );
		expect( liveRegion().getAttribute( 'aria-live' ) ).toBe( 'assertive' );
		expect( liveRegion().textContent ).toContain( 'HTTP 500' );
	} );

	test( 'a failure with no message still announces the outcome', () => {
		win.markActivity( 'failed' );
		expect( liveRegion().textContent ).toBe( 'Not saved.' );
	} );

	test( 'going back to idle clears the announcement', () => {
		win.markActivity( 'saved' );
		win.markActivity( 'idle' );
		expect( liveRegion().textContent ).toBe( '' );
	} );

	test( 'an opt-in [data-os-activity-indicator] is still driven', () => {
		const dot = document.createElement( 'os-save-status' );
		dot.setAttribute( 'data-os-activity-indicator', '' );
		titleBar().appendChild( dot );

		win.markActivity( 'failed', { error: 'Nope.' } );
		expect( dot.getAttribute( 'phase' ) ).toBe( 'failed' );
		expect( dot.getAttribute( 'error' ) ).toBe( 'Nope.' );

		win.markActivity( 'saved' );
		expect( dot.getAttribute( 'phase' ) ).toBe( 'saved' );
		expect( dot.hasAttribute( 'error' ) ).toBe( false );
	} );
} );

describe( 'window activity — the glow itself', () => {
	test( 'the halo hangs off the icon slot host, not the icon', () => {
		// `.os-window__icon` can be an `<img>`, and replaced elements
		// generate no pseudo-elements — an `::before` there is
		// invisible for every remote / data-URI icon in the shell.
		expect( CHROME_CSS ).toContain( '.os-window__slot--icon::before' );
		expect( CHROME_CSS ).not.toContain( '.os-window__icon::before' );
	} );

	test( 'the icon slot keeps a box while every other in-titlebar slot is display: contents', () => {
		const contentsRule = CHROME_CSS.slice(
			CHROME_CSS.indexOf( '.os-window__slot--before-icon,' ),
		).slice( 0, 200 );
		expect( contentsRule ).not.toContain( '.os-window__slot--icon,' );
	} );

	test( 'idle is never a selector — an idle window matches nothing', () => {
		expect( CHROME_CSS ).not.toContain( "data-os-activity='idle'" );
	} );

	test( 'reduced motion stops the movement and keeps the glow', () => {
		const query = CHROME_CSS.slice(
			CHROME_CSS.indexOf( '@media (prefers-reduced-motion: reduce)' ),
		);
		const block = query.slice( 0, query.indexOf( '\n}\n' ) );
		expect( block ).toContain( '[data-os-activity]' );
		expect( block ).toContain( 'animation: none' );
		// Both movements go — the breath and the shrink.
		expect( block ).toContain( 'scale: 1' );
		// The dissolve stays, and nothing here may hide the glow:
		// the user asked for less movement, not less information.
		expect( block ).toContain( 'transition: opacity' );
		expect( block ).not.toMatch( /opacity:\s*0\b/ );
		expect( block ).not.toContain( 'display: none' );
	} );

	test( 'the exit is declared on the resting state, and differs from the entry', () => {
		// Two directions, two curves — and the exit has to live on the
		// base rule, because "no attribute" IS the exit state. Both
		// properties are compositor-only.
		const base = CHROME_CSS.slice(
			CHROME_CSS.indexOf( '.os-window__slot--icon::before {' ),
		);
		const block = base.slice( 0, base.indexOf( '\n}' ) );
		expect( block ).toContain( 'opacity: 0;' );
		expect( block ).toContain( 'scale: 0.72;' );
		expect( block ).toContain( 'var(--os-ui-ease-in' );
		expect( block ).not.toContain( 'width 0' );
		expect( block ).not.toContain( 'filter' );

		const entry = CHROME_CSS.slice(
			CHROME_CSS.indexOf(
				'.os-window__titlebar[data-os-activity] .os-window__slot--icon::before {',
			),
		);
		expect( entry.slice( 0, entry.indexOf( '\n}' ) ) ).toContain(
			'var(--os-ui-ease-out',
		);
	} );

	test( 'the tint is keyed on the sticky phase, not the live one', () => {
		expect( CHROME_CSS ).toContain(
			"[data-os-activity-last='saved'] .os-window__slot--icon::before",
		);
		expect( CHROME_CSS ).toContain(
			"[data-os-activity-last='failed'] .os-window__slot--icon::before",
		);
		// The live-phase rules move opacity only. A background there
		// would snap back to the accent the moment the phase cleared.
		const saved = CHROME_CSS.slice(
			CHROME_CSS.indexOf(
				".os-window__titlebar[data-os-activity='saved'] .os-window__slot--icon::before {",
			),
		);
		expect( saved.slice( 0, saved.indexOf( '\n}' ) ) ).not.toContain(
			'background',
		);
	} );

	test( 'every colour in the glow resolves through a palette token', () => {
		for ( const token of [
			'--os-titlebar-activity-color',
			'--os-titlebar-activity-saved-color',
			'--os-titlebar-activity-failed-color',
		] ) {
			expect( CHROME_CSS ).toContain( `var(${ token },` );
			expect( VARIABLES_CSS ).toContain( `\t${ token }:` );
		}
	} );

	test( 'the three phases are a traffic light, and in-flight is not the accent', () => {
		// Amber working, green through, red stopped. In-flight is a
		// colour of its own precisely so it belongs to that sequence:
		// glowing brand-magenta while a window saves is decoration,
		// and decoration is not a phase the user can read.
		expect( VARIABLES_CSS ).toMatch(
			/--os-titlebar-activity-color:\s*#ff9d3c/,
		);
		expect( VARIABLES_CSS ).not.toMatch(
			/--os-titlebar-activity-color:\s*var\(--os-ui-accent/,
		);
		expect( VARIABLES_CSS ).toMatch(
			/--os-titlebar-activity-saved-color:\s*var\(--os-ui-success/,
		);
		expect( VARIABLES_CSS ).toMatch(
			/--os-titlebar-activity-failed-color:\s*var\(--os-ui-danger/,
		);
	} );

	test( 'the fallback literals are a traffic light too', () => {
		// The floor if `variables.css` never loads: the WordPress-admin
		// yellow / green / red, in that order. A blue in-flight
		// fallback would break the sequence exactly where it matters.
		expect( CHROME_CSS ).toContain( '--os-titlebar-activity-color, #dba617' );
		expect( CHROME_CSS ).toContain(
			'--os-titlebar-activity-saved-color, #00a32a',
		);
		expect( CHROME_CSS ).toContain(
			'--os-titlebar-activity-failed-color, #d63638',
		);
	} );
} );
