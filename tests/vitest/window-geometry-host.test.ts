/**
 * Tests for `geometryHostOf` — the one seam that keeps window geometry
 * (drag clamping, maximize, snap halves) sized against the desktop
 * area even while the canvas stage has promoted the window element to
 * a direct child of the stage `<canvas>`, which is dock-width wider.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { geometryHostOf } from '../../src/window/geometry-host';

afterEach( () => {
	document.body.innerHTML = '';
} );

describe( 'geometryHostOf', () => {
	test( 'answers the plain parent for a nested window', () => {
		const area = document.createElement( 'div' );
		const win = document.createElement( 'div' );
		area.append( win );
		document.body.append( area );

		expect( geometryHostOf( win ) ).toBe( area );
	} );

	test( 'answers null for a detached window', () => {
		expect( geometryHostOf( document.createElement( 'div' ) ) ).toBeNull();
	} );

	test( 'answers the desktop area while promoted into a canvas', () => {
		const area = document.createElement( 'div' );
		area.id = 'desktop-mode-area';
		const canvas = document.createElement( 'canvas' );
		const win = document.createElement( 'div' );
		canvas.append( win );
		document.body.append( area, canvas );

		expect( geometryHostOf( win ) ).toBe( area );
	} );

	test( 'falls back to the canvas when no area exists', () => {
		// Degenerate, but a wrong-sized answer beats a null one — the
		// callers treat null as "cannot size at all".
		const canvas = document.createElement( 'canvas' );
		const win = document.createElement( 'div' );
		canvas.append( win );
		document.body.append( canvas );

		expect( geometryHostOf( win ) ).toBe( canvas );
	} );
} );
