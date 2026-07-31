/**
 * Unit tests for the occlusion-aware anchor math
 * (`src/window-links/geometry.ts`):
 *
 *   - interval subtraction (the core sweep)
 *   - point visibility against higher-z occluders
 *   - visible-border anchoring: picks the midpoint of the closest
 *     visible stretch, ignores lower/self windows, respects the
 *     minimum-segment threshold, and returns null when fully covered
 */
import { describe, expect, test } from 'vitest';
import {
	anchorOnBorder,
	closestBorderAnchors,
	isPointVisible,
	MIN_VISIBLE_SEGMENT,
	subtractIntervals,
	visibleBorderAnchor,
	type LinkObstacle,
} from '../../src/window-links/geometry';

const RECT = { x: 100, y: 100, width: 200, height: 100 }; // 100..300 × 100..200

function obstacle(
	windowId: string,
	x: number,
	y: number,
	width: number,
	height: number,
	zIndex: number,
): LinkObstacle {
	return { windowId, rect: { x, y, width, height }, zIndex };
}

describe( 'subtractIntervals', () => {
	test( 'no holes returns the base', () => {
		expect( subtractIntervals( { start: 0, end: 10 }, [] ) ).toEqual( [
			{ start: 0, end: 10 },
		] );
	} );

	test( 'middle hole splits the base', () => {
		expect(
			subtractIntervals( { start: 0, end: 10 }, [ { start: 4, end: 6 } ] ),
		).toEqual( [
			{ start: 0, end: 4 },
			{ start: 6, end: 10 },
		] );
	} );

	test( 'overlapping + out-of-range holes clamp and merge', () => {
		expect(
			subtractIntervals( { start: 0, end: 10 }, [
				{ start: -5, end: 3 },
				{ start: 2, end: 5 },
				{ start: 20, end: 30 },
			] ),
		).toEqual( [ { start: 5, end: 10 } ] );
	} );

	test( 'full coverage returns nothing', () => {
		expect(
			subtractIntervals( { start: 0, end: 10 }, [ { start: 0, end: 10 } ] ),
		).toEqual( [] );
	} );
} );

describe( 'isPointVisible', () => {
	const covering = [ obstacle( 'top-win', 150, 50, 100, 100, 5 ) ];

	test( 'covered by a higher window → not visible', () => {
		expect(
			isPointVisible( { x: 200, y: 100 }, 1, covering, 'me' ),
		).toBe( false );
	} );

	test( 'the same rect BELOW the point wins visibility', () => {
		expect(
			isPointVisible( { x: 200, y: 100 }, 9, covering, 'me' ),
		).toBe( true );
	} );

	test( 'self never occludes', () => {
		expect(
			isPointVisible( { x: 200, y: 100 }, 1, covering, 'top-win' ),
		).toBe( true );
	} );
} );

describe( 'visibleBorderAnchor', () => {
	test( 'unoccluded window anchors at the facing side midpoint', () => {
		const anchor = visibleBorderAnchor( RECT, 1, [], 'me', {
			x: 500,
			y: 150,
		} );
		// Target is due right — the right border midpoint is closest.
		expect( anchor ).toEqual( { x: 300, y: 150, side: 'right' } );
	} );

	test( 'a sibling covering part of the right edge shifts the anchor to the visible stretch', () => {
		// Occluder covers the right border from y=100 to y=160 — the
		// visible remainder is y∈[160, 200], midpoint 180.
		const obstacles = [ obstacle( 'sibling', 250, 80, 100, 80, 5 ) ];
		const anchor = visibleBorderAnchor( RECT, 1, obstacles, 'me', {
			x: 500,
			y: 150,
		} );
		expect( anchor ).toEqual( { x: 300, y: 180, side: 'right' } );
	} );

	test( 'stretches shorter than the minimum are skipped', () => {
		// Occluder leaves only 10px visible at the bottom of the right
		// edge (< MIN_VISIBLE_SEGMENT) — the anchor moves to another
		// side entirely.
		const obstacles = [
			obstacle( 'sibling', 250, 80, 100, 200 - 80 - 10, 5 ),
		];
		const anchor = visibleBorderAnchor( RECT, 1, obstacles, 'me', {
			x: 500,
			y: 150,
		} );
		expect( 200 - 190 ).toBeLessThan( MIN_VISIBLE_SEGMENT );
		expect( anchor ).not.toBeNull();
		expect( anchor!.side ).not.toBe( 'right' );
	} );

	test( 'a fully covered window returns null', () => {
		const obstacles = [ obstacle( 'blanket', 0, 0, 1000, 1000, 5 ) ];
		expect(
			visibleBorderAnchor( RECT, 1, obstacles, 'me', { x: 500, y: 150 } ),
		).toBeNull();
	} );

	test( 'lower-z and self windows never occlude', () => {
		const obstacles = [
			obstacle( 'below', 0, 0, 1000, 1000, 0 ),
			obstacle( 'me', 0, 0, 1000, 1000, 99 ),
		];
		const anchor = visibleBorderAnchor( RECT, 1, obstacles, 'me', {
			x: 500,
			y: 150,
		} );
		expect( anchor ).toEqual( { x: 300, y: 150, side: 'right' } );
	} );
} );

describe( 'closestBorderAnchors', () => {
	test( 'vertical spans overlapping → straight horizontal connector at the overlap midpoint', () => {
		const a = { x: 0, y: 0, width: 100, height: 100 };
		const b = { x: 300, y: 40, width: 100, height: 100 }; // y overlap [40,100] → mid 70
		expect( closestBorderAnchors( a, b ) ).toEqual( {
			from: { x: 100, y: 70, side: 'right' },
			to: { x: 300, y: 70, side: 'left' },
		} );
	} );

	test( 'horizontal spans overlapping → straight vertical connector', () => {
		const a = { x: 0, y: 0, width: 100, height: 100 };
		const b = { x: 40, y: 300, width: 100, height: 100 }; // x overlap [40,100] → mid 70
		expect( closestBorderAnchors( a, b ) ).toEqual( {
			from: { x: 70, y: 100, side: 'bottom' },
			to: { x: 70, y: 300, side: 'top' },
		} );
	} );

	test( 'no overlap on either axis → facing corners, exit along the larger gap', () => {
		const a = { x: 0, y: 0, width: 100, height: 100 };
		const b = { x: 400, y: 200, width: 100, height: 100 }; // gapX 300 > gapY 100
		expect( closestBorderAnchors( a, b ) ).toEqual( {
			from: { x: 100, y: 100, side: 'right' },
			to: { x: 400, y: 200, side: 'left' },
		} );
	} );

	test( 'overlapping rects return null (no gap to cross)', () => {
		const a = { x: 0, y: 0, width: 200, height: 200 };
		const b = { x: 100, y: 100, width: 50, height: 50 };
		expect( closestBorderAnchors( a, b ) ).toBeNull();
	} );
} );

describe( 'anchorOnBorder', () => {
	test( 'intersects the border toward the target', () => {
		const anchor = anchorOnBorder( RECT, { x: 500, y: 150 } );
		expect( anchor ).toEqual( { x: 300, y: 150, side: 'right' } );
	} );

	test( 'degenerate concentric target falls back to the center', () => {
		const anchor = anchorOnBorder( RECT, { x: 200, y: 150 } );
		expect( anchor.x ).toBe( 200 );
		expect( anchor.y ).toBe( 150 );
	} );
} );
