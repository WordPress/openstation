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

		expect( r.width ).toBe( 900 );
		expect( r.height ).toBe( 640 );
		expect( r.x ).toBe( 40 );
		expect( r.y ).toBe( 0 );
		expect( r.y + r.height ).toBe( 40 + 600 );
	} );

	test( 'SW corner: drags the LEFT edge left, keeps right pinned', () => {
		const r = computeResize(
			'sw', -100, 50, 40, 40, 800, 600, 320, 200, NO_SNAP,
		);
		expect( r.width ).toBe( 840 );
		expect( r.height ).toBe( 650 );
		expect( r.x ).toBe( 0 );
		expect( r.x + r.width ).toBe( 40 + 800 );
		expect( r.y ).toBe( 40 );
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

		const r = computeResize(
			'sw', 10_000, 10_000, 40, 40, 800, 600, 320, 200, NO_SNAP,
		);
		expect( r.width ).toBe( 320 );
		expect( r.height ).toBe( 600 + 10_000 );
		expect( r.x + r.width ).toBe( 40 + 800 );
	} );

	test( 'snap-to-grid quantizes both dimensions to whole cells', () => {
		const r = computeResize(
			'nw', -47, -33, 100, 100, 800, 600, 320, 200,
			{ enabled: true, cellWidth: 50, cellHeight: 50 },
		);

		expect( r.width % 50 ).toBe( 0 );
		expect( r.height % 50 ).toBe( 0 );
	} );
} );
