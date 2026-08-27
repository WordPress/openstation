/**
 * Window activity, as the title bar reports it.
 *
 * The status ring is the leading mark of the title bar, in the
 * position the app icon used to hold — and the app icon is gone,
 * because it was a copy of the window's own dock tile a few hundred
 * pixels below it.
 *
 * Three things here are easy to break by accident and all three are
 * pinned: the ring is found through the PUBLIC
 * `[data-os-activity-indicator]` attribute (the framework's own
 * indicator claims no private channel, so a plugin's is driven by the
 * same code), every indicator in the title bar is driven rather than
 * the first, and the phase is announced to screen readers because a
 * ring announces nothing.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
const COMPONENT_CSS = readFileSync(
	resolve(
		ROOT,
		'src/ui/components/os-save-status/os-save-status.styles.ts',
	),
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

function ring(): HTMLElement {
	return win.element.querySelector< HTMLElement >(
		'.os-window__status',
	) as HTMLElement;
}

function liveRegion(): HTMLElement {
	return win.element.querySelector< HTMLElement >(
		'.os-window__activity-status',
	) as HTMLElement;
}

describe( 'the title-bar status ring', () => {
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

	test( 'the title bar carries a ring and no app icon', () => {
		expect( ring() ).not.toBeNull();
		expect( ring().tagName.toLowerCase() ).toBe( 'os-save-status' );
		expect( ring().getAttribute( 'variant' ) ).toBe( 'ring' );
		// The icon lives in the dock. Two of the same mark, one above
		// the other, is one mark too many.
		expect( win.element.querySelector( '.os-window__icon' ) ).toBeNull();
	} );

	test( 'the icon slot survives so a plugin can still render into it', () => {
		const host = win.element.querySelector( '.os-window__slot--icon' );
		expect( host ).not.toBeNull();
		expect( host!.children.length ).toBe( 0 );
	} );

	test( 'the ring is reached through the public indicator attribute', () => {
		// Not a private hook: the framework's ring and a plugin's are
		// the same kind of thing, found by the same selector.
		expect( ring().hasAttribute( 'data-os-activity-indicator' ) ).toBe(
			true,
		);
		expect( ring().getAttribute( 'phase' ) ).toBe( 'idle' );
	} );

	test( 'phases drive the ring', () => {
		win.markActivity( 'saving' );
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saving' );

		win.markActivity( 'saved' );
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saved' );

		win.markActivity( 'failed', { error: 'Nope.' } );
		expect( ring().getAttribute( 'phase' ) ).toBe( 'failed' );
		expect( ring().getAttribute( 'error' ) ).toBe( 'Nope.' );

		win.markActivity( 'idle' );
		expect( ring().getAttribute( 'phase' ) ).toBe( 'idle' );
		expect( ring().hasAttribute( 'error' ) ).toBe( false );
	} );

	test( 'a second indicator is driven too, not just the first', () => {
		const plugin = document.createElement( 'os-save-status' );
		plugin.setAttribute( 'data-os-activity-indicator', '' );
		titleBar().appendChild( plugin );

		win.markActivity( 'saving' );
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saving' );
		expect( plugin.getAttribute( 'phase' ) ).toBe( 'saving' );
	} );

	test( 'the phase is mirrored onto the title bar for CSS, absent at idle', () => {
		win.markActivity( 'saving' );
		expect( titleBar().getAttribute( 'data-os-activity' ) ).toBe( 'saving' );
		win.markActivity( 'idle' );
		expect( titleBar().hasAttribute( 'data-os-activity' ) ).toBe( false );
	} );

	test( 'saving is not announced — only the outcome is', () => {
		win.markActivity( 'saving' );
		expect( liveRegion().textContent ).toBe( '' );
		expect( liveRegion().getAttribute( 'aria-live' ) ).toBe( 'polite' );
	} );

	test( 'success is announced politely, failure assertively and with the error', () => {
		win.markActivity( 'saved' );
		expect( liveRegion().textContent ).toBe( 'Saved' );
		expect( liveRegion().getAttribute( 'role' ) ).toBe( 'status' );

		win.markActivity( 'failed', { error: 'Request failed (HTTP 500).' } );
		expect( liveRegion().getAttribute( 'role' ) ).toBe( 'alert' );
		expect( liveRegion().getAttribute( 'aria-live' ) ).toBe( 'assertive' );
		expect( liveRegion().textContent ).toContain( 'HTTP 500' );
	} );

	test( 'a failure with no message still announces the outcome', () => {
		win.markActivity( 'failed' );
		expect( liveRegion().textContent ).toBe( 'Not saved.' );
	} );
} );

describe( 'reference counting and the reset escape hatch', () => {
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

	test( 'concurrent requests settle as one burst', () => {
		win._markActivityStart();
		win._markActivityStart();
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saving' );

		win._markActivitySettled( true );
		// Still one in flight — the ring must not claim success yet.
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saving' );
	} );

	test( 'a reset drops the count so a navigated-away iframe cannot strand the ring', () => {
		// The one case the counter cannot survive: the document that
		// started the requests is gone, so its `end` messages never
		// arrive and the count would never reach zero.
		win._markActivityStart();
		win._markActivityStart();
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saving' );

		win._resetActivity();
		expect( ring().getAttribute( 'phase' ) ).toBe( 'idle' );
		expect( win._activityCount ).toBe( 0 );
		expect( titleBar().hasAttribute( 'data-os-activity' ) ).toBe( false );
	} );
} );

describe( 'a form submit, bracketed across two documents', () => {
	beforeEach( () => {
		vi.useFakeTimers();
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
		vi.useRealTimers();
	} );

	test( 'the answer landing is the end the submit never sent', () => {
		// Settled the moment it lands, with none of the minimum-blink
		// hold a fetch gets — that floor stands in for feedback a 50ms
		// request can't give, and a document arriving IS that
		// feedback. The fade back to idle survives, though.
		win._noteNavigationActivity();
		win._markActivityStart();
		vi.advanceTimersByTime( 500 );

		expect( win._settleNavigationActivity() ).toBe( true );
		expect( win._activityCount ).toBe( 0 );
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saved' );

		vi.advanceTimersByTime( 2200 );
		expect( ring().getAttribute( 'phase' ) ).toBe( 'idle' );
	} );

	test( 'the boot signal behind the head report leaves the outcome alone', () => {
		// Both arrive for every submit, in that order: the head report
		// settles the ring, `os-ready` follows from the footer of the
		// same document, and its usual reset would wipe the check off
		// a ring that had only just earned it. Once — the navigation
		// after this one is an ordinary one again.
		win._noteNavigationActivity();
		win._markActivityStart();
		win._settleNavigationActivity();

		expect( win._settleNavigationActivity( true ) ).toBe( true );
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saved' );
		expect( win._settleNavigationActivity( true ) ).toBe( false );
	} );

	test( 'os-ready settles a document that sent no head report', () => {
		// Not every response carries the head hook, and the ring
		// cannot be left blinking on the ones that don't.
		win._noteNavigationActivity();
		win._markActivityStart();

		expect( win._settleNavigationActivity( true ) ).toBe( true );
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saved' );
	} );

	test( 'a submit that lands nowhere lets go of the ring', () => {
		// A `wp_die()` page (an expired nonce) runs no admin hooks, so
		// nothing on it reports back and the blink would outlive the
		// window.
		win._noteNavigationActivity();
		win._markActivityStart();
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saving' );

		vi.advanceTimersByTime( Window.NAVIGATION_ACTIVITY_TIMEOUT_MS );

		expect( ring().getAttribute( 'phase' ) ).toBe( 'idle' );
		expect( win._settleNavigationActivity() ).toBe( false );
	} );
} );

describe( 'the ring treatment', () => {
	test( 'the ring has no resting fill, whatever the host sets', () => {
		// The bug this pins shipped and was visible on every idle
		// window: `--os-ui-save-status-bg` is the DOT's background on
		// the base rule, and the title bar was setting it to tint the
		// in-flight outline — so idle painted a solid accent disc
		// inside the white ring. One token, two meanings, one rule
		// apart.
		const guard = COMPONENT_CSS.slice(
			COMPONENT_CSS.indexOf(
				":host( [ variant='ring' ] ) .os-save-status__indicator {",
			),
		);
		expect( guard.slice( 0, guard.indexOf( '\n\t}' ) ) ).toContain(
			'background: transparent',
		);

		// …and the title bar asks for the ring by its own name, so the
		// two can never be confused again.
		const host = CHROME_CSS.slice(
			CHROME_CSS.indexOf( '.os-window__status {' ),
		);
		const block = host.slice( 0, host.indexOf( '\n}' ) );
		expect( block ).toContain( '--os-ui-save-status-ring-color:' );
		expect( block ).not.toContain( '--os-ui-save-status-bg:' );
	} );

	test( 'only success fills — the other phases keep the outline open', () => {
		// Colour alone is not a distinction every user can make, so
		// the two outcomes differ in shape as well as hue.
		const savedRule = COMPONENT_CSS.slice(
			COMPONENT_CSS.indexOf(
				":host( [ variant='ring' ][ phase='saved' ] ) .os-save-status__indicator {",
			),
		);
		expect( savedRule.slice( 0, savedRule.indexOf( '\n\t}' ) ) ).toContain(
			'background: var(',
		);

		for ( const phase of [ 'saving', 'failed' ] ) {
			const rule = COMPONENT_CSS.slice(
				COMPONENT_CSS.indexOf(
					`:host( [ variant='ring' ][ phase='${ phase }' ] ) .os-save-status__indicator {`,
				),
			);
			expect( rule.slice( 0, rule.indexOf( '\n\t}' ) ) ).toContain(
				'background: transparent',
			);
		}
	} );

	test( 'each state change has a gesture, and success and failure differ', () => {
		// Landing overshoots and settles; failure swells twice and
		// stops. A heartbeat would say "still going" on a phase that
		// has already ended.
		expect( COMPONENT_CSS ).toContain(
			'@keyframes os-save-status-ring-land',
		);
		expect( COMPONENT_CSS ).toContain(
			'@keyframes os-save-status-ring-alert',
		);
		expect( COMPONENT_CSS ).toContain(
			'@keyframes os-save-status-glyph-in',
		);

		for ( const [ phase, keyframes ] of [
			[ 'saved', 'os-save-status-ring-land' ],
			[ 'failed', 'os-save-status-ring-alert' ],
		] ) {
			const rule = COMPONENT_CSS.slice(
				COMPONENT_CSS.indexOf(
					`:host( [ variant='ring' ][ phase='${ phase }' ] ) .os-save-status__indicator {`,
				),
			);
			expect( rule.slice( 0, rule.indexOf( '\n\t}' ) ) ).toContain(
				keyframes,
			);
		}
	} );

	test( 'the gestures stay small — a 16px ring cannot bounce', () => {
		// Anything past ~1.1 on a mark this size reads as a wobble
		// rather than as weight.
		const scales = [
			...COMPONENT_CSS.matchAll( /scale:\s*([\d.]+)/g ),
		].map( ( m ) => Number( m[ 1 ] ) );
		expect( scales.length ).toBeGreaterThan( 0 );
		expect( Math.max( ...scales ) ).toBeLessThanOrEqual( 1.1 );
	} );

	test( 'reduced motion drops every gesture and keeps every colour', () => {
		const query = COMPONENT_CSS.slice(
			COMPONENT_CSS.lastIndexOf( '@media ( prefers-reduced-motion: reduce )' ),
		);
		const block = query.slice( 0, query.indexOf( '\n\t}\n' ) );
		expect( block ).toContain( "variant='ring'" );
		expect( block ).toContain( 'animation: none' );
		expect( block ).toContain( 'scale: 1' );
		// The glyph is information, not emphasis — it must not be
		// swept up with the animations that carry it in.
		expect( block ).toContain( 'opacity: 1' );
		expect( block ).not.toContain( 'display: none' );
	} );

	test( 'the resting ring is white, in both title-bar states', () => {
		// One value, not two: the ring reports a phase, and dimming it
		// on an unfocused window would make `idle` mean something
		// different depending on which window you last clicked.
		const rule = CHROME_CSS.slice(
			CHROME_CSS.indexOf( '.os-window__status {' ),
		);
		const block = rule.slice( 0, rule.indexOf( '\n}' ) );
		expect( block ).toContain(
			'--os-ui-save-status-idle-color: var(--os-titlebar-activity-idle-color, #fff)',
		);
		expect( CHROME_CSS ).not.toContain(
			'.os-window--focused .os-window__status',
		);
		expect( VARIABLES_CSS ).toMatch(
			/--os-titlebar-activity-idle-color:\s*#fffbff/,
		);
	} );

	test( 'every colour resolves through a themeable title-bar token', () => {
		for ( const token of [
			'--os-titlebar-activity-color',
			'--os-titlebar-activity-saved-color',
			'--os-titlebar-activity-failed-color',
		] ) {
			expect( CHROME_CSS ).toContain( `var(${ token },` );
			expect( VARIABLES_CSS ).toContain( `\t${ token }:` );
		}
		// Failure is the one value that must not be quietened.
		expect( VARIABLES_CSS ).toMatch(
			/--os-titlebar-activity-failed-color:\s*var\(--os-ui-danger/,
		);
	} );
} );
