/**
 * Tests for `src/dock-behavior.ts` — the dynamic dock's JS half.
 *
 * Pins the two things CSS can't do on its own: the parked inset needs
 * the rail's own extent, and the reveal zone is the whole edge of the
 * viewport, not just the width of a centred pill.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	installDockBehavior,
	pointerInZone,
	REVEAL_ZONE,
	REVEALED_CLASS,
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

describe( 'installDockBehavior', () => {
	let body: HTMLElement;
	let dock: HTMLElement;

	beforeEach( () => {
		body = document.createElement( 'div' );
		body.className = 'os-shell__body';
		dock = document.createElement( 'nav' );
		dock.className = 'os-dock';
		dock.setAttribute( 'data-os-dock-placement', 'bottom' );
		body.appendChild( dock );
		document.body.appendChild( body );
		document.body.classList.add( 'os-dock-dynamic' );
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		document.body.className = '';
	} );

	function move( x: number, y: number ): void {
		document.dispatchEvent(
			new MouseEvent( 'pointermove', { clientX: x, clientY: y, bubbles: true } ),
		);
	}

	test( 'reveals the rail while the pointer is in its edge band, and only then', () => {
		const ctl = installDockBehavior( { shellBody: body } );
		move( 300, window.innerHeight - 5 );
		expect( dock.classList.contains( REVEALED_CLASS ) ).toBe( true );
		move( 300, window.innerHeight - REVEAL_ZONE - 50 );
		expect( dock.classList.contains( REVEALED_CLASS ) ).toBe( false );
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
		expect( dock.classList.contains( REVEALED_CLASS ) ).toBe( true );
		ctl.destroy();
	} );

	test( 'does nothing while the behavior is static', () => {
		document.body.classList.remove( 'os-dock-dynamic' );
		const ctl = installDockBehavior( { shellBody: body } );
		move( 300, window.innerHeight - 5 );
		expect( dock.classList.contains( REVEALED_CLASS ) ).toBe( false );
		ctl.destroy();
	} );

	test( 'a rail added later is picked up; destroy clears the class', () => {
		const ctl = installDockBehavior( { shellBody: body } );
		const side = document.createElement( 'nav' );
		side.className = 'os-dock';
		side.setAttribute( 'data-os-dock-placement', 'left' );
		body.prepend( side );
		document.dispatchEvent( new CustomEvent( 'os-layout-changed' ) );
		move( 2, 300 );
		expect( side.classList.contains( REVEALED_CLASS ) ).toBe( true );
		expect( dock.classList.contains( REVEALED_CLASS ) ).toBe( false );
		ctl.destroy();
		expect( side.classList.contains( REVEALED_CLASS ) ).toBe( false );
		move( 2, 300 );
		expect( side.classList.contains( REVEALED_CLASS ) ).toBe( false );
	} );
} );
