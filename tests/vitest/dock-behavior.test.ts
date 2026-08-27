/**
 * Tests for `src/dock-behavior.ts` — the dynamic dock's JS half.
 *
 * The parked ↔ revealed flip is decided here, not in CSS, so the
 * rules that decide it are pinned: the reveal zone is the whole edge
 * of the viewport (not just the indicator line's width), a revealed
 * rail stays out while the pointer is on it, its flyouts count as
 * "on it", keyboard focus holds it, and a static rail never moves.
 * jsdom has no View Transitions API, which exercises the plain
 * fallback path; the morph itself is a browser matter.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	installDockBehavior,
	pointerInZone,
	REVEAL_ZONE,
	REVEALED_CLASS,
	VIEW_TRANSITION_CLASS,
} from '../../src/dock-behavior';

describe( 'pointerInZone', () => {
	const W = 1600;
	const H = 900;

	test( 'bottom: the band along the bottom edge, full width', () => {
		expect( pointerInZone( 'bottom', 10, H - 1, W, H ) ).toBe( true );
		expect( pointerInZone( 'bottom', W - 10, H - REVEAL_ZONE, W, H ) ).toBe( true );
		expect( pointerInZone( 'bottom', 800, H - REVEAL_ZONE - 1, W, H ) ).toBe( false );
	} );

	test( 'left / right: the band along that side, full height', () => {
		expect( pointerInZone( 'left', REVEAL_ZONE, 450, W, H ) ).toBe( true );
		expect( pointerInZone( 'left', REVEAL_ZONE + 1, 450, W, H ) ).toBe( false );
		expect( pointerInZone( 'right', W - REVEAL_ZONE, 0, W, H ) ).toBe( true );
		expect( pointerInZone( 'right', W - REVEAL_ZONE - 1, 0, W, H ) ).toBe( false );
	} );
} );

/** A DOMRect-shaped object jsdom can't produce from layout. */
function fakeRect( left: number, top: number, width: number, height: number ): DOMRect {
	return {
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		x: left,
		y: top,
		toJSON: () => ( {} ),
	} as DOMRect;
}

describe( 'installDockBehavior', () => {
	let body: HTMLElement;
	let dock: HTMLElement;

	beforeEach( () => {
		body = document.createElement( 'div' );
		body.className = 'os-shell__body';
		dock = document.createElement( 'nav' );
		dock.id = 'os-dock';
		dock.className = 'os-dock';
		dock.setAttribute( 'data-os-dock-placement', 'bottom' );
		body.appendChild( dock );
		document.body.appendChild( body );
		document.body.classList.add( 'os-dock-dynamic' );
		// The revealed pill: 600×64, 12px above the floor.
		dock.getBoundingClientRect = () =>
			fakeRect( 500, window.innerHeight - 12 - 64, 600, 64 );
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		document.body.className = '';
		document.documentElement.className = '';
	} );

	function move( x: number, y: number, target: EventTarget = document ): void {
		target.dispatchEvent(
			new MouseEvent( 'pointermove', { clientX: x, clientY: y, bubbles: true } ),
		);
	}

	const revealed = (): boolean => dock.classList.contains( REVEALED_CLASS );

	test( 'reveals the rail while the pointer is in its edge band, and parks it again', () => {
		const ctl = installDockBehavior( { shellBody: body } );
		expect( revealed() ).toBe( false );
		move( 300, window.innerHeight - 5 );
		expect( revealed() ).toBe( true );
		move( 300, 200 );
		expect( revealed() ).toBe( false );
		ctl.destroy();
	} );

	test( 'a revealed rail stays out while the pointer is on it, past the edge band', () => {
		const ctl = installDockBehavior( { shellBody: body } );
		move( 800, window.innerHeight - 5 );
		expect( revealed() ).toBe( true );
		// Up onto the pill's top row of tiles: outside the 20px band,
		// inside the rail's box.
		move( 800, window.innerHeight - 12 - 60 );
		expect( revealed() ).toBe( true );
		// Off the pill sideways: parks.
		move( 200, window.innerHeight - 12 - 60 );
		expect( revealed() ).toBe( false );
		ctl.destroy();
	} );

	test( 'the rail box does not reveal a parked rail on its own', () => {
		// Parked, the rail is a thin line; only the edge band or the
		// line itself (which sits inside the band) summons it.
		const ctl = installDockBehavior( { shellBody: body } );
		move( 800, window.innerHeight - 12 - 60 );
		expect( revealed() ).toBe( false );
		ctl.destroy();
	} );

	test( 'a pointerdown at the edge reveals too (touch has no move first)', () => {
		const ctl = installDockBehavior( { shellBody: body } );
		document.dispatchEvent(
			new MouseEvent( 'pointerdown', {
				clientX: 40,
				clientY: window.innerHeight - 2,
				bubbles: true,
			} ),
		);
		expect( revealed() ).toBe( true );
		ctl.destroy();
	} );

	test( 'a flyout under the pointer holds the rail out', () => {
		const ctl = installDockBehavior( { shellBody: body } );
		const flyout = document.createElement( 'div' );
		flyout.className = 'os-constellation';
		document.body.appendChild( flyout );
		move( 800, window.innerHeight - 5 );
		expect( revealed() ).toBe( true );
		// Well above the rail, but on the flyout it opened.
		move( 800, 300, flyout );
		expect( revealed() ).toBe( true );
		move( 800, 300 );
		expect( revealed() ).toBe( false );
		ctl.destroy();
	} );

	test( 'keyboard focus on the rail holds it out', () => {
		vi.useFakeTimers( { toFake: [ 'requestAnimationFrame', 'cancelAnimationFrame' ] } );
		const ctl = installDockBehavior( { shellBody: body } );
		const tile = document.createElement( 'button' );
		dock.appendChild( tile );
		tile.focus();
		vi.runOnlyPendingTimers();
		expect( revealed() ).toBe( true );
		tile.blur();
		vi.runOnlyPendingTimers();
		expect( revealed() ).toBe( false );
		ctl.destroy();
		vi.useRealTimers();
	} );

	test( 'a static rail never reveals, and a leftover class is cleared', () => {
		document.body.classList.remove( 'os-dock-dynamic' );
		dock.classList.add( REVEALED_CLASS );
		const ctl = installDockBehavior( { shellBody: body } );
		expect( revealed() ).toBe( false );
		move( 300, window.innerHeight - 5 );
		expect( revealed() ).toBe( false );
		ctl.destroy();
	} );

	test( 'a rail added later is picked up; destroy parks everything', () => {
		const ctl = installDockBehavior( { shellBody: body } );
		const side = document.createElement( 'nav' );
		side.id = 'os-side-dock';
		side.className = 'os-dock';
		side.setAttribute( 'data-os-dock-placement', 'left' );
		side.getBoundingClientRect = () => fakeRect( 0, 0, 56, window.innerHeight );
		body.prepend( side );
		document.dispatchEvent( new CustomEvent( 'os-layout-changed' ) );
		move( 2, 300 );
		expect( side.classList.contains( REVEALED_CLASS ) ).toBe( true );
		expect( revealed() ).toBe( false );
		ctl.destroy();
		expect( side.classList.contains( REVEALED_CLASS ) ).toBe( false );
		expect( document.documentElement.classList.contains( VIEW_TRANSITION_CLASS ) ).toBe( false );
		move( 2, 300 );
		expect( side.classList.contains( REVEALED_CLASS ) ).toBe( false );
	} );

	test( 'flips run through the View Transitions API when it exists, one at a time', async () => {
		let resolveFinished: () => void = () => {};
		const start = vi.fn( ( cb: () => void ) => {
			cb();
			return { finished: new Promise< void >( ( r ) => { resolveFinished = r; } ) };
		} );
		( document as Document & { startViewTransition?: unknown } ).startViewTransition = start;
		try {
			const ctl = installDockBehavior( { shellBody: body } );
			move( 300, window.innerHeight - 5 );
			expect( start ).toHaveBeenCalledTimes( 1 );
			expect( revealed() ).toBe( true );
			expect( dock.style.getPropertyValue( 'view-transition-name' ) ).toBe( 'os-dock-os-dock' );
			expect( document.documentElement.classList.contains( VIEW_TRANSITION_CLASS ) ).toBe( true );

			// Mid-morph, the pointer leaves: remembered, not stacked.
			move( 300, 200 );
			expect( start ).toHaveBeenCalledTimes( 1 );
			expect( revealed() ).toBe( true );

			resolveFinished();
			await Promise.resolve();
			await Promise.resolve();
			// The remembered flip ran as its own transition, so the
			// rail is named again for that one's duration...
			expect( start ).toHaveBeenCalledTimes( 2 );
			expect( revealed() ).toBe( false );
			expect( dock.style.getPropertyValue( 'view-transition-name' ) ).toBe( 'os-dock-os-dock' );
			// ...and unnamed once it settles with nothing left to do.
			resolveFinished();
			await Promise.resolve();
			await Promise.resolve();
			expect( dock.style.getPropertyValue( 'view-transition-name' ) ).toBe( '' );
			expect( document.documentElement.classList.contains( VIEW_TRANSITION_CLASS ) ).toBe( false );
			expect( start ).toHaveBeenCalledTimes( 2 );
			ctl.destroy();
		} finally {
			delete ( document as Document & { startViewTransition?: unknown } ).startViewTransition;
		}
	} );
} );
