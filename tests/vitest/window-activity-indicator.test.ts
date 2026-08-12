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

describe( 'the ring treatment', () => {
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

	test( 'reduced motion holds the ring lit instead of breathing it', () => {
		const query = COMPONENT_CSS.slice(
			COMPONENT_CSS.lastIndexOf( '@media ( prefers-reduced-motion: reduce )' ),
		);
		const block = query.slice( 0, query.indexOf( '\n\t}\n' ) );
		expect( block ).toContain( "variant='ring'" );
		expect( block ).toContain( 'animation: none' );
		expect( block ).toContain( 'opacity: 1' );
	} );

	test( 'the resting ring is chrome, not signal', () => {
		// An idle window is most windows, most of the time. The ring
		// takes the title bar's own muted glyph colour there and only
		// becomes accent when something is actually happening.
		const rule = CHROME_CSS.slice(
			CHROME_CSS.indexOf( '.os-window__status {' ),
		);
		const block = rule.slice( 0, rule.indexOf( '\n}' ) );
		expect( block ).toContain( '--os-titlebar-btn-color' );
		expect( CHROME_CSS ).toContain( '.os-window--focused .os-window__status' );
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
