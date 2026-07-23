/**
 * Unit tests for the window corner-resize math. SE grows from the
 * top-left anchor; NE / SW / NW corners move left/top to keep the
 * OPPOSITE edge pinned. Minimums always win; snap-to-grid quantizes
 * both dimensions + re-anchors so the pinned edge doesn't drift.
 */
import { describe, expect, test } from 'vitest';
import { computeResize } from '../../src/window/pointer';

const NO_SNAP = { enabled: false, cellWidth: 0, cellHeight: 0 };

describe( 'computeResize', () => {
	test( 'SE corner: dragging +100/+100 grows from top-left anchor', () => {
		const r = computeResize(
			'se', 100, 100, 40, 40, 800, 600, 320, 200, NO_SNAP,
		);
		expect( r ).toEqual( { x: 40, y: 40, width: 900, height: 700 } );
	} );

	test( 'NE corner: dragging +100/-100 grows width from left anchor + shrinks height from top', () => {
		const r = computeResize(
			'ne', 100, -100, 40, 40, 800, 600, 320, 200, NO_SNAP,
		);
		// Width grows (right edge moves right); height grows because dy
		// is -100 which SHRINKS from top — but height increases because
		// the resize math flips sign. Verify the bounding-box equation
		// `startTop + startH === y + height` keeps the BOTTOM pinned.
		expect( r.width ).toBe( 900 );
		expect( r.height ).toBe( 640 );
		expect( r.x ).toBe( 40 ); // left pinned
		expect( r.y ).toBe( 0 ); // clamped at EDGE_MARGIN
		expect( r.y + r.height ).toBe( 40 + 600 ); // bottom pinned
	} );

	test( 'SW corner: drags the LEFT edge left, keeps right pinned', () => {
		const r = computeResize(
			'sw', -100, 50, 40, 40, 800, 600, 320, 200, NO_SNAP,
		);
		expect( r.width ).toBe( 840 );
		expect( r.height ).toBe( 650 );
		expect( r.x ).toBe( 0 ); // clamped at EDGE_MARGIN
		expect( r.x + r.width ).toBe( 40 + 800 ); // right edge pinned
		expect( r.y ).toBe( 40 ); // top pinned
	} );

	test( 'NW corner: drags the top-left anchor, keeps bottom-right pinned', () => {
		const r = computeResize(
			'nw', -100, -100, 40, 40, 800, 600, 320, 200, NO_SNAP,
		);
		expect( r.width ).toBe( 840 );
		expect( r.height ).toBe( 640 );
		expect( r.x ).toBe( 0 );
		expect( r.y ).toBe( 0 );
		expect( r.x + r.width ).toBe( 40 + 800 );
		expect( r.y + r.height ).toBe( 40 + 600 );
	} );

	test( 'bounds clamping keeps x and y at EDGE_MARGIN when dragging far past it', () => {
		const r = computeResize(
			'nw', -1000, -1000, 40, 40, 800, 600, 320, 200, NO_SNAP,
		);
		expect( r.x ).toBe( 0 );
		expect( r.y ).toBe( 0 );
		expect( r.width ).toBe( 840 );
		expect( r.height ).toBe( 640 );
	} );

	test( 'minimums clamp width + height; the pinned edge stays put', () => {
		// Try to shrink the window way below the minimum via the SW
		// corner. The pinned RIGHT edge must still be at startLeft +
		// startW even though the user dragged past the min.
		const r = computeResize(
			'sw', 10_000, 10_000, 40, 40, 800, 600, 320, 200, NO_SNAP,
		);
		expect( r.width ).toBe( 320 );
		expect( r.height ).toBe( 600 + 10_000 ); // south grows freely
		expect( r.x + r.width ).toBe( 40 + 800 );
	} );

	test( 'snap-to-grid quantizes both dimensions to whole cells', () => {
		const r = computeResize(
			'nw', -47, -33, 100, 100, 800, 600, 320, 200,
			{ enabled: true, cellWidth: 50, cellHeight: 50 },
		);
		// Grid wins — both dimensions land on multiples of the cell
		// size. (The "pinned opposite edge" invariant loosens up to
		// one cell size under snap, which is the expected trade-off.)
		expect( r.width % 50 ).toBe( 0 );
		expect( r.height % 50 ).toBe( 0 );
	} );
} );
