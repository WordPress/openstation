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

		expect( win.element.querySelector( '.os-window__icon' ) ).toBeNull();
	} );

	test( 'the icon slot survives so a plugin can still render into it', () => {
		const host = win.element.querySelector( '.os-window__slot--icon' );
		expect( host ).not.toBeNull();
		expect( host!.children.length ).toBe( 0 );
	} );

	test( 'the ring is reached through the public indicator attribute', () => {

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

		expect( ring().getAttribute( 'phase' ) ).toBe( 'saving' );
	} );

	test( 'a reset drops the count so a navigated-away iframe cannot strand the ring', () => {

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

		win._noteNavigationActivity();
		win._markActivityStart();
		win._settleNavigationActivity();

		expect( win._settleNavigationActivity( true ) ).toBe( true );
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saved' );
		expect( win._settleNavigationActivity( true ) ).toBe( false );
	} );

	test( 'os-ready settles a document that sent no head report', () => {

		win._noteNavigationActivity();
		win._markActivityStart();

		expect( win._settleNavigationActivity( true ) ).toBe( true );
		expect( ring().getAttribute( 'phase' ) ).toBe( 'saved' );
	} );

	test( 'a submit that lands nowhere lets go of the ring', () => {

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

		const guard = COMPONENT_CSS.slice(
			COMPONENT_CSS.indexOf(
				":host( [ variant='ring' ] ) .os-save-status__indicator {",
			),
		);
		expect( guard.slice( 0, guard.indexOf( '\n\t}' ) ) ).toContain(
			'background: transparent',
		);

		const host = CHROME_CSS.slice(
			CHROME_CSS.indexOf( '.os-window__status {' ),
		);
		const block = host.slice( 0, host.indexOf( '\n}' ) );
		expect( block ).toContain( '--os-ui-save-status-ring-color:' );
		expect( block ).not.toContain( '--os-ui-save-status-bg:' );
	} );

	test( 'only success fills — the other phases keep the outline open', () => {

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

		expect( block ).toContain( 'opacity: 1' );
		expect( block ).not.toContain( 'display: none' );
	} );

	test( 'the resting ring is white, in both title-bar states', () => {

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

		expect( VARIABLES_CSS ).toMatch(
			/--os-titlebar-activity-failed-color:\s*var\(--os-ui-danger/,
		);
	} );
} );
