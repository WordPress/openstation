/**
 * `<os-tooltip>` — placement and the attach/show/hide rules.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { attachTooltip, hideTooltip, placeTooltip } from './os-tooltip';

const rect = ( left: number, top: number, width: number, height: number ): DOMRect =>
	( { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top } as DOMRect );

describe( 'placeTooltip', () => {
	const viewport = { width: 1000, height: 800 };
	const size = { width: 200, height: 40 };

	test( 'centres below the control', () => {
		expect( placeTooltip( rect( 400, 100, 30, 30 ), size, viewport ) ).toEqual( { top: 138, left: 315 } );
	} );

	test( 'flips above when there is no room below', () => {
		expect( placeTooltip( rect( 400, 750, 30, 30 ), size, viewport ).top ).toBe( 702 );
	} );

	test( 'stays inside the viewport near either edge', () => {
		expect( placeTooltip( rect( 0, 100, 30, 30 ), size, viewport ).left ).toBe( 8 );
		expect( placeTooltip( rect( 980, 100, 20, 30 ), size, viewport ).left ).toBe( 792 );
	} );
} );

describe( 'attachTooltip', () => {
	let anchor: HTMLButtonElement;
	let detach: () => void;
	const tooltip = () => document.querySelector( 'os-tooltip' );

	beforeEach( () => {
		vi.useFakeTimers( {
			toFake: [ 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame' ],
		} );
		anchor = document.createElement( 'button' );
		document.body.appendChild( anchor );
	} );

	afterEach( () => {
		detach?.();
		hideTooltip();
		anchor.remove();
		vi.useRealTimers();
	} );

	test( 'shows after the hover delay, with content resolved at show time', () => {
		let rows = 'Reload';
		detach = attachTooltip( anchor, () => ( { heading: 'Window actions', text: rows } ), { delay: 300 } );

		anchor.dispatchEvent( new Event( 'pointerenter' ) );
		rows = 'Reload, Open in classic wp-admin';
		vi.advanceTimersByTime( 299 );
		expect( tooltip()?.hasAttribute( 'open' ) ?? false ).toBe( false );

		vi.advanceTimersByTime( 50 );
		expect( tooltip()!.hasAttribute( 'open' ) ).toBe( true );
		expect( tooltip()!.getAttribute( 'text' ) ).toBe( 'Reload, Open in classic wp-admin' );

		anchor.dispatchEvent( new Event( 'pointerdown' ) );
		expect( tooltip()!.hasAttribute( 'open' ) ).toBe( false );
	} );

	test( 'stays hidden while the control has its menu open', () => {
		detach = attachTooltip( anchor, 'Window actions', { delay: 0 } );
		anchor.setAttribute( 'aria-expanded', 'true' );

		anchor.dispatchEvent( new Event( 'pointerenter' ) );
		vi.advanceTimersByTime( 50 );
		expect( tooltip()?.hasAttribute( 'open' ) ?? false ).toBe( false );
	} );

	test( 'leaving before the delay cancels the show', () => {
		detach = attachTooltip( anchor, 'Window actions', { delay: 300 } );

		anchor.dispatchEvent( new Event( 'pointerenter' ) );
		vi.advanceTimersByTime( 100 );
		anchor.dispatchEvent( new Event( 'pointerleave' ) );
		vi.advanceTimersByTime( 500 );
		expect( tooltip()?.hasAttribute( 'open' ) ?? false ).toBe( false );
	} );
} );
