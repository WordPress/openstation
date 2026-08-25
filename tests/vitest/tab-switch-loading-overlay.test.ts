/**
 * The loading overlay has to belong to the tab you are looking at.
 *
 * A window's overlay is a single element on the body, armed when the
 * PRIMARY iframe starts a navigation. But the body hosts every tab's
 * iframe, and switching tabs only toggles their `display`. Nothing
 * reconciled the two, so this happened in real use:
 *
 *   1. Click a submenu tab — the primary iframe starts loading, the
 *      spinner paints.
 *   2. Switch to a kept-alive external tab whose content has been
 *      ready for minutes.
 *   3. Sit under a spinner that belongs to a different tab until a
 *      fade timer happens to end.
 *
 * Observed live before the fix: body `--loading` already cleared, the
 * overlay still carrying its visible class, on top of a finished page.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { syncLoadingOverlayToTab } from '../../src/window/loading';
import {
	LOADING_OVERLAY_CLASS,
	LOADING_OVERLAY_VISIBLE_CLASS,
} from '../../src/window/constants';
import { LOADING_BODY_CLASS, LOADING_STARTED_ATTR } from '../../src/window/dom';

/**
 * A window element shaped the way `createWindowElement` builds one.
 *
 * `startedAgoMs` matters: the overlay has a 120 ms grace period so a
 * fast load never paints a spinner, and the schedule re-reads the
 * stamp rather than restarting the clock. A load already past that
 * window paints immediately; a fresh one still waits.
 */
function makeWindow( {
	loading,
	startedAgoMs = 5_000,
}: {
	loading: boolean;
	startedAgoMs?: number;
} ): HTMLElement {
	const el = document.createElement( 'div' );
	el.className = 'os-window';
	const body = document.createElement( 'div' );
	body.className = 'os-window__body';
	if ( loading ) {
		body.classList.add( LOADING_BODY_CLASS );
		body.setAttribute(
			LOADING_STARTED_ATTR,
			String( Date.now() - startedAgoMs ),
		);
	}
	const overlay = document.createElement( 'div' );
	overlay.className = LOADING_OVERLAY_CLASS;
	body.appendChild( overlay );
	el.appendChild( body );
	document.body.appendChild( el );
	return el;
}

const overlayOf = ( el: HTMLElement ) =>
	el.querySelector< HTMLElement >( `.${ LOADING_OVERLAY_CLASS }` )!;

describe( 'syncLoadingOverlayToTab', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'hides a painted spinner when a non-primary tab takes the screen', () => {
		const el = makeWindow( { loading: true } );
		overlayOf( el ).classList.add( LOADING_OVERLAY_VISIBLE_CLASS );

		// The user switches to a kept-alive external tab.
		syncLoadingOverlayToTab( el, false );

		expect(
			overlayOf( el ).classList.contains( LOADING_OVERLAY_VISIBLE_CLASS ),
		).toBe( false );
	} );

	test( 'leaves the primary iframe’s own loading state alone', () => {
		// The body class is the primary's truth, and the handler that
		// clears it has to still find it. Suppressing the spinner must
		// not fake "finished loading".
		const el = makeWindow( { loading: true } );
		overlayOf( el ).classList.add( LOADING_OVERLAY_VISIBLE_CLASS );

		syncLoadingOverlayToTab( el, false );

		const body = el.querySelector( '.os-window__body' )!;
		expect( body.classList.contains( LOADING_BODY_CLASS ) ).toBe( true );
	} );

	test( 'restores the spinner when returning to a still-loading primary', () => {
		const el = makeWindow( { loading: true } );
		const overlay = overlayOf( el );
		overlay.classList.add( LOADING_OVERLAY_VISIBLE_CLASS );
		syncLoadingOverlayToTab( el, false );
		expect(
			overlay.classList.contains( LOADING_OVERLAY_VISIBLE_CLASS ),
		).toBe( false );

		// Back to the primary tab, which never finished.
		syncLoadingOverlayToTab( el, true );

		expect( overlay.classList.contains( LOADING_OVERLAY_VISIBLE_CLASS ) )
			.toBe( true );
	} );

	test( 'does not conjure a spinner for a primary that has settled', () => {
		const el = makeWindow( { loading: false } );

		syncLoadingOverlayToTab( el, true );

		expect(
			overlayOf( el ).classList.contains( LOADING_OVERLAY_VISIBLE_CLASS ),
		).toBe( false );
	} );

	test( 'returning during a just-started load still respects the grace period', () => {
		// The 120 ms delay exists so a fast navigation never flashes a
		// spinner. Coming back to the primary must not skip it.
		const el = makeWindow( { loading: true, startedAgoMs: 0 } );

		syncLoadingOverlayToTab( el, true );

		expect(
			overlayOf( el ).classList.contains( LOADING_OVERLAY_VISIBLE_CLASS ),
		).toBe( false );
	} );

	test( 'is a no-op on a window with no overlay yet', () => {
		const el = document.createElement( 'div' );
		const body = document.createElement( 'div' );
		body.className = 'os-window__body';
		el.appendChild( body );
		document.body.appendChild( el );

		expect( () => syncLoadingOverlayToTab( el, false ) ).not.toThrow();
		expect( () => syncLoadingOverlayToTab( el, true ) ).not.toThrow();
	} );
} );
